import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PaymentScheme,
  SignatureFormat,
  X402Gateway,
  createX402Gateway,
  type X402VerifyRequest,
} from "../lib/x402.js";

const SERVICE_KEY = ["svc", "key", "for", "tests"].join("-") + "z".repeat(16);
const FACILITATOR = "https://facilitator.example/";

interface SeenCall {
  url: string;
  init: RequestInit | undefined;
}

const realFetch = globalThis.fetch;
let calls: SeenCall[] = [];

function useFetch(reply: (call: SeenCall) => Response | Promise<Response>): void {
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), init };
    calls.push(call);
    return reply(call);
  };
}

function sign(req: Omit<X402VerifyRequest, "signature" | "signature_format">, key = SERVICE_KEY): string {
  const payload = [req.session_id, req.agent_id, String(req.amount_micro_usd), String(req.scheme)].join("|");
  return createHmac("sha256", key).update(payload).digest("hex");
}

function gateway(max = 10_000): X402Gateway {
  return new X402Gateway({
    enabled: true,
    service_key: SERVICE_KEY,
    facilitator_url: FACILITATOR,
    max_unsettled_micro_usd: max,
  });
}

function signedRequest(gw: X402Gateway, agentId: string, amount: number): X402VerifyRequest {
  const session = gw.createSession(agentId);
  const base = { session_id: session.session_id, agent_id: agentId, amount_micro_usd: amount, scheme: session.scheme };
  return { ...base, signature: sign(base), signature_format: SignatureFormat.HmacSha256 };
}

beforeEach(() => {
  calls = [];
  useFetch(() => {
    throw new Error("unexpected network call");
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("X402Gateway sessions", () => {
  it("creates one session per sanitized agent id", () => {
    const gw = gateway();
    const s1 = gw.createSession("agent-1");
    const s2 = gw.createSession("  agent-1 ");
    expect(s2).toBe(s1);
    expect(s1.session_id).toMatch(/^x402-agent-1-[0-9a-f-]{36}$/);
    expect(s1.scheme).toBe(PaymentScheme.Exact);
    expect(gw.createSession("agent-2", PaymentScheme.UpTo).scheme).toBe(PaymentScheme.UpTo);
    expect(gw.activeSessionCount).toBe(2);
    expect(gw.getMetrics().total_sessions).toBe(2);
    expect(gw.getSession("agent-1")).toBe(s1);
    expect(gw.getSession("nobody")).toBeNull();
  });

  it("sanitizeAgentId rejects ids with path or control characters", () => {
    expect(X402Gateway.sanitizeAgentId("a.b:c_d-e")).toBe("a.b:c_d-e");
    expect(() => X402Gateway.sanitizeAgentId("../etc")).toThrow("Invalid agentId for X402 session");
    expect(() => X402Gateway.sanitizeAgentId("")).toThrow();
    expect(() => X402Gateway.sanitizeAgentId("a b")).toThrow();
    expect(() => X402Gateway.sanitizeAgentId("x".repeat(129))).toThrow();
  });
});

describe("X402Gateway.verify", () => {
  it("fails closed when disabled", async () => {
    const gw = createX402Gateway();
    expect(gw.isEnabled).toBe(false);
    const res = await gw.verify({ session_id: "s", agent_id: "a", amount_micro_usd: 1, scheme: PaymentScheme.Exact });
    expect(res).toEqual({ authorized: false, reason: "X402 disabled (fail-closed)" });
  });

  it("authorizes a correctly signed payment and tracks unsettled spend", async () => {
    const gw = gateway(10_000);
    const res = await gw.verify(signedRequest(gw, "agent-1", 2_500));
    expect(res.authorized).toBe(true);
    expect(res.payment_id).toMatch(/^pay-/);
    expect(res.max_authorized_micro_usd).toBe(7_500);
    expect(gw.getSession("agent-1")?.unsettled_micro_usd).toBe(2_500);
    expect(gw.getMetrics()).toMatchObject({ total_verified_micro_usd: 2_500, pending_settlements: 1 });
    expect(calls).toEqual([]);
  });

  it("accepts the hmac format aliases", async () => {
    const gw = gateway();
    const aliases: string[] = ["hmac", "HMAC_SHA256"];
    for (const fmt of aliases) {
      const req = signedRequest(gw, "agent-f", 10);
      const res = await gw.verify({ ...req, signature_format: fmt as SignatureFormat });
      expect(res.authorized).toBe(true);
    }
  });

  it("denies and counts invalid requests", async () => {
    const gw = gateway();
    const good = signedRequest(gw, "agent-1", 100);
    const rsa: string = "rsa";
    const cases: Array<[X402VerifyRequest, string]> = [
      [{ ...good, agent_id: "bad id" }, "Invalid agent_id"],
      [{ ...good, agent_id: "agent-unknown" }, "No active session"],
      [{ ...good, session_id: "x402-agent-1-other" }, "Session mismatch"],
      [{ ...good, amount_micro_usd: 0 }, "amount_micro_usd must be positive"],
      [{ ...good, amount_micro_usd: Number.NaN }, "amount_micro_usd must be positive"],
      [{ ...good, signature: "" }, "Payment signature required"],
      [{ session_id: good.session_id, agent_id: "agent-1", amount_micro_usd: 100, scheme: good.scheme, signature: good.signature ?? "" }, "Payment signature required"],
      [{ ...good, signature_format: SignatureFormat.Ed25519 }, "Payment signature invalid"],
      [{ ...good, signature_format: SignatureFormat.Secp256k1 }, "Payment signature invalid"],
      [{ ...good, signature_format: rsa as SignatureFormat }, "Payment signature invalid"],
      [{ ...good, amount_micro_usd: 101 }, "Payment signature invalid"],
      [{ ...good, signature: "zz" + (good.signature ?? "").slice(2) }, "Payment signature invalid"],
      [{ ...good, signature: (good.signature ?? "").slice(0, 10) }, "Payment signature invalid"],
    ];
    for (const [req, reason] of cases) {
      expect(await gw.verify(req)).toEqual({ authorized: false, reason });
    }
    expect(gw.getMetrics().failed_verifications).toBe(cases.length);
    expect(gw.getSession("agent-1")?.unsettled_micro_usd).toBe(0);
  });

  it("rejects a signature made with a different key", async () => {
    const gw = gateway();
    const session = gw.createSession("agent-k");
    const base = { session_id: session.session_id, agent_id: "agent-k", amount_micro_usd: 5, scheme: session.scheme };
    const res = await gw.verify({ ...base, signature: sign(base, "other" + SERVICE_KEY), signature_format: SignatureFormat.HmacSha256 });
    expect(res).toEqual({ authorized: false, reason: "Payment signature invalid" });
  });

  it("refuses to verify without a service key", async () => {
    const gw = new X402Gateway({ enabled: true, facilitator_url: FACILITATOR });
    const session = gw.createSession("agent-n");
    const base = { session_id: session.session_id, agent_id: "agent-n", amount_micro_usd: 5, scheme: session.scheme };
    const res = await gw.verify({ ...base, signature: sign(base, ""), signature_format: SignatureFormat.HmacSha256 });
    expect(res.reason).toBe("Payment signature invalid");
  });

  it("settles through the facilitator when the unsettled cap would be passed", async () => {
    useFetch(() => new Response(JSON.stringify({ settlement_id: "st-1" }), { status: 200 }));
    const gw = gateway(1_000);
    expect((await gw.verify(signedRequest(gw, "agent-s", 800))).authorized).toBe(true);
    const res = await gw.verify(signedRequest(gw, "agent-s", 300));
    expect(res.authorized).toBe(true);
    expect(res.max_authorized_micro_usd).toBe(700);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://facilitator.example/v1/settle");
    expect(call?.init?.method).toBe("POST");
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${SERVICE_KEY}`);
    const sent = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ agent_id: "agent-s", amount_micro_usd: 800, payment_ids: [] });

    const session = gw.getSession("agent-s");
    expect(session?.settled_micro_usd).toBe(800);
    expect(session?.unsettled_micro_usd).toBe(300);
    expect(gw.getMetrics().total_settled_micro_usd).toBe(800);
  });

  it("denies when the facilitator refuses the settlement", async () => {
    useFetch(() => new Response("nope", { status: 503 }));
    const gw = gateway(1_000);
    await gw.verify(signedRequest(gw, "agent-r", 900));
    const res = await gw.verify(signedRequest(gw, "agent-r", 200));
    expect(res).toEqual({ authorized: false, reason: "Settlement required" });
    expect(gw.getMetrics().failed_settlements).toBe(1);
    expect(gw.getSession("agent-r")?.unsettled_micro_usd).toBe(900);
  });

  it("denies an amount larger than the cap even after settling", async () => {
    useFetch(() => new Response("{}", { status: 200 }));
    const gw = gateway(1_000);
    const res = await gw.verify(signedRequest(gw, "agent-big", 1_500));
    expect(res).toEqual({ authorized: false, reason: "Exceeds max unsettled after settlement" });
    expect(calls).toHaveLength(0);
  });
});

describe("X402Gateway.settle and closeSession", () => {
  it("is a no-op settlement when nothing is unsettled", async () => {
    const gw = gateway();
    const s = gw.createSession("agent-0");
    expect(await gw.settle({ session_id: s.session_id, agent_id: "agent-0", payment_ids: [] })).toEqual({
      settled: true,
      total_settled_micro_usd: 0,
      settlement_id: `noop-${s.session_id}`,
    });
    expect(calls).toEqual([]);
  });

  it("reports an unknown session", async () => {
    const gw = gateway();
    expect(await gw.settle({ session_id: "s", agent_id: "ghost", payment_ids: [] })).toEqual({
      settled: false,
      total_settled_micro_usd: 0,
      error: "No active session",
    });
  });

  it("reports facilitator HTTP errors and network failures", async () => {
    const gw = gateway();
    await gw.verify(signedRequest(gw, "agent-e", 50));
    const session = gw.getSession("agent-e");
    if (!session) throw new Error("session missing");

    useFetch(() => new Response("bad gateway body", { status: 502 }));
    const httpErr = await gw.settle({ session_id: session.session_id, agent_id: "agent-e", payment_ids: ["p"] });
    expect(httpErr).toEqual({
      settled: false,
      total_settled_micro_usd: 0,
      error: "Facilitator returned HTTP 502: bad gateway body",
    });

    useFetch(() => {
      throw new Error("connection refused");
    });
    const netErr = await gw.settle({ session_id: session.session_id, agent_id: "agent-e", payment_ids: [] });
    expect(netErr.error).toBe("connection refused");
    expect(gw.getMetrics().failed_settlements).toBe(2);
  });

  it("uses a generated settlement id when the facilitator returns none", async () => {
    useFetch(() => new Response("not json", { status: 200 }));
    const gw = gateway();
    await gw.verify(signedRequest(gw, "agent-g", 50));
    const session = gw.getSession("agent-g");
    if (!session) throw new Error("session missing");
    const res = await gw.settle({ session_id: session.session_id, agent_id: "agent-g", payment_ids: [] });
    expect(res.settled).toBe(true);
    expect(res.total_settled_micro_usd).toBe(50);
    expect(res.settlement_id).toMatch(new RegExp(`^facilitator-${session.session_id}-\\d+$`));
  });

  it("closeSession settles and removes the session", async () => {
    useFetch(() => new Response(JSON.stringify({ id: "st-9" }), { status: 200 }));
    const gw = gateway();
    await gw.verify(signedRequest(gw, "agent-c", 70));
    const res = await gw.closeSession("agent-c");
    expect(res).toEqual({ settled: true, total_settled_micro_usd: 70, settlement_id: "st-9" });
    expect(gw.getSession("agent-c")).toBeNull();
    expect(gw.getMetrics().active_sessions).toBe(0);
    expect(await gw.closeSession("agent-c")).toEqual({ settled: true, total_settled_micro_usd: 0 });
  });

  it("settle on a disabled gateway settles nothing", async () => {
    const gw = createX402Gateway({ enabled: false });
    expect(await gw.settle({ session_id: "s", agent_id: "a", payment_ids: [] })).toEqual({
      settled: true,
      total_settled_micro_usd: 0,
    });
  });
});

describe("X402Gateway config", () => {
  it("validate requires a facilitator and service key when enabled", () => {
    expect(createX402Gateway().validate()).toEqual([]);
    expect(new X402Gateway({ enabled: true, facilitator_url: "" }).validate()).toEqual([
      "facilitator_url is required when X402 is enabled",
      "service_key is required when X402 is enabled",
    ]);
    expect(gateway().validate()).toEqual([]);
  });

  it("health reports the facilitator and live metrics", () => {
    const gw = gateway();
    gw.createSession("agent-h");
    const h = gw.health();
    expect(h.enabled).toBe(true);
    expect(h.facilitator).toBe(FACILITATOR);
    expect(h.active_sessions).toBe(1);
    expect(h.metrics.total_sessions).toBe(1);
  });
});
