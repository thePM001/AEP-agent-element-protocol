import { describe, expect, it } from "vitest";
import { UcmClient, UcmError, type Receipt } from "../ucm-client.js";

interface Seen {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
  hasBody: boolean;
}

function fakeFetch(reply: (seen: Seen) => Response): { fetchImpl: typeof fetch; calls: Seen[] } {
  const calls: Seen[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = init?.body;
    const seen: Seen = {
      url: String(input),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
      hasBody: init !== undefined && "body" in init,
    };
    calls.push(seen);
    return reply(seen);
  };
  return { fetchImpl, calls };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const receipt: Receipt = {
  ucm: "ucm-receipt-v1",
  receipt_id: "r-1",
  program: { op: "add" },
  program_hash: "h",
  inputs: {},
  input_digest: "d",
  library_digests: [],
  engine_build: "b",
  budget_limits: {},
  budget_used: {},
  float_used: "false",
  program_source: "agent",
  result: { type: "int", value: "3" },
  result_digest: "rd",
  node_id: "n-1",
  public_key: "pk",
  issued_at: "2026-01-01T00:00:00Z",
  signature: "sig",
};

describe("UcmClient requests", () => {
  it("posts lookup queries with k as a string and strips a trailing slash", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ ucm: "ucm-lookup-reply-v1", query: "area", tier: "tier1", library_digest: "x", note: "", entries: [] }),
    );
    const client = new UcmClient({ baseUrl: "http://ucm.example:8414/", fetchImpl });
    const reply = await client.lookup("area of a circle", 3);
    expect(reply.tier).toBe("tier1");
    expect(calls).toEqual([
      {
        url: "http://ucm.example:8414/ucm/v1/lookup",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { query: "area of a circle", k: "3" },
        hasBody: true,
      },
    ]);
  });

  it("uses k = 5 by default and sends the API key as a bearer token", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ entries: [] }));
    const apiKey = ["ucm", "test", "key"].join("-");
    const client = new UcmClient({ baseUrl: "http://ucm.example", apiKey, fetchImpl });
    await client.lookup("x");
    expect(calls[0]?.body).toEqual({ query: "x", k: "5" });
    expect(calls[0]?.headers["authorization"]).toBe(`Bearer ${apiKey}`);
  });

  it("evaluates a program and maps the library formula option", async () => {
    const reply = { ok: true, result: { type: "money", currency: "EUR", value: "12.50" }, result_type: "money", receipt_id: "r-1", receipt, ledger: {} };
    const { fetchImpl, calls } = fakeFetch(() => json(reply));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    const out = await client.evaluate("(mul price qty)", { price: "6.25 EUR", qty: "2" }, {
      libraryFormula: "f.total",
      budget: { steps: "100" },
    });
    expect(out.result).toEqual({ type: "money", currency: "EUR", value: "12.50" });
    expect(calls[0]?.url).toBe("http://ucm.example/ucm/v1/eval");
    expect(calls[0]?.body).toEqual({
      program: "(mul price qty)",
      inputs: { price: "6.25 EUR", qty: "2" },
      library_formula: "f.total",
      budget: { steps: "100" },
    });
  });

  it("leaves unset evaluate options out of the body", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ ok: true }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await client.evaluate("(add 1 2)");
    expect(calls[0]?.body).toEqual({ program: "(add 1 2)", inputs: {} });
  });

  it("verifies receipts in signature mode by default", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ ok: true, mode: "signature", receipt_id: "r-1", node_id: "n-1", trusted: "true" }),
    );
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    const out = await client.verify(receipt);
    expect(out.trusted).toBe("true");
    expect(calls[0]?.body).toEqual({ receipt, mode: "signature" });
    await client.verify("raw-receipt-json", "replay");
    expect(calls[1]?.body).toEqual({ receipt: "raw-receipt-json", mode: "replay" });
  });

  it("explain posts the program and capabilities is a GET without a body", async () => {
    const { fetchImpl, calls } = fakeFetch((seen) => json({ ok: true, path: seen.url }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    expect(await client.explain("(add 1 2)")).toEqual({ ok: true, path: "http://ucm.example/ucm/v1/explain" });
    expect(calls[0]?.body).toEqual({ program: "(add 1 2)" });
    expect(await client.capabilities()).toEqual({ ok: true, path: "http://ucm.example/ucm/v1/capabilities" });
    expect(calls[1]?.method).toBe("GET");
    expect(calls[1]?.hasBody).toBe(false);
  });

  it("calls the fetch function without binding it to the client", async () => {
    let calledUnbound: boolean | null = null;
    const fetchImpl = function (this: unknown): Promise<Response> {
      calledUnbound = this === undefined;
      return Promise.resolve(json({ ok: true }));
    } as typeof fetch;
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await client.capabilities();
    expect(calledUnbound).toBe(true);
  });
});

describe("UcmClient errors", () => {
  it("throws UcmError with the service error code on an HTTP error", async () => {
    const { fetchImpl } = fakeFetch(() => json({ ok: false, error: { code: "parse_error", message: "bad program" } }, 400));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    const err = await client.evaluate("(").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UcmError);
    expect(err).toMatchObject({ code: "parse_error", status: 400, message: "parse_error: bad program" });
  });

  it("throws when the body says ok false even with HTTP 200", async () => {
    const { fetchImpl } = fakeFetch(() => json({ ok: false, error: { code: "budget_exceeded", message: "steps" } }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await expect(client.evaluate("(loop)")).rejects.toMatchObject({ code: "budget_exceeded", status: 200 });
  });

  it("falls back to http_error and the status text when the error body has no error", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("{}", { status: 503, statusText: "Service Unavailable" }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await expect(client.capabilities()).rejects.toMatchObject({
      code: "http_error",
      status: 503,
      message: "http_error: Service Unavailable",
    });
  });

  it("reports a non-JSON error page as http_error instead of a parse error", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await expect(client.capabilities()).rejects.toMatchObject({ code: "http_error", status: 502 });
  });

  it("reports a non-JSON success body as bad_response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("plain text", { status: 200 }));
    const client = new UcmClient({ baseUrl: "http://ucm.example", fetchImpl });
    await expect(client.capabilities()).rejects.toMatchObject({
      code: "bad_response",
      message: "bad_response: response body is not JSON",
    });
  });
});

describe("UcmClient.attachReceipts", () => {
  it("adds receipts under payload.ucm.receipts without dropping existing ones", () => {
    const payload = { total: "12.50", ucm: { version: "1", receipts: { "/old": receipt } } };
    const out = UcmClient.attachReceipts(payload, { "/total": receipt });
    expect(out).toEqual({
      total: "12.50",
      ucm: { version: "1", receipts: { "/old": receipt, "/total": receipt } },
    });
    expect(payload.ucm.receipts).toEqual({ "/old": receipt });
  });

  it("creates the ucm section when missing", () => {
    expect(UcmClient.attachReceipts({ a: 1 }, { "/a": receipt })).toEqual({ a: 1, ucm: { receipts: { "/a": receipt } } });
  });
});
