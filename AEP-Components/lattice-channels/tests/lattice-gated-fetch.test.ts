// Tests for the lattice-gated fetch module. The ".js" specifier loads lattice-gated-fetch.js
// at runtime (which re-exports lattice-gated-fetch.mjs) while TypeScript checks the calls
// against the lattice-gated-fetch.ts bridge, so these tests hold both twins to one API.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUrlNotSsrf,
  buildGatewayEvent,
  dockSuffix,
  latticeGatedFetch,
  latticeStrictEnabled,
  responseFromDockAllow,
  sendLatticeLine,
  ssrfPolicyFromEnv,
  type SsrfLookup,
} from "../lib/lattice-gated-fetch.js";

const NO_ENV: NodeJS.ProcessEnv = {};

const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restoreEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}
const LOOPBACK_V4 = ["127", "0", "0", "2"].join(".");

function lookupOf(addrs: string[]): SsrfLookup & { calls: string[] } {
  const calls: string[] = [];
  const fn = (host: string): string[] => {
    calls.push(host);
    return addrs;
  };
  return Object.assign(fn, { calls });
}

const LOOPBACK_ERR = "lattice-gated-fetch: loopback blocked";
const PRIVATE_ERR = "lattice-gated-fetch: private/metadata host blocked";

describe("assertUrlNotSsrf", () => {
  it("allows a public host whose lookup returns only public addresses", () => {
    const lookup = lookupOf(["93.184.216.34", "2606:4700::1111"]);
    expect(() => assertUrlNotSsrf("https://api.example.com/v1", lookup, NO_ENV)).not.toThrow();
    expect(lookup.calls).toEqual(["api.example.com"]);
  });

  it("accepts a URL object as input", () => {
    const lookup = lookupOf(["93.184.216.34"]);
    expect(() => assertUrlNotSsrf(new URL("http://example.org/x"), lookup, NO_ENV)).not.toThrow();
    expect(lookup.calls).toEqual(["example.org"]);
  });

  it("blocks a host that resolves to loopback", () => {
    expect(() => assertUrlNotSsrf("http://sneaky.example/", lookupOf([LOOPBACK_V4]), NO_ENV)).toThrow(
      LOOPBACK_ERR,
    );
  });

  it.each([["10.1.2.3"], ["192.168.0.10"], ["172.16.0.5"], ["172.31.255.1"], ["169.254.10.10"], ["255.255.255.255"]])(
    "blocks a host that resolves to the private or link-local address %s",
    (addr) => {
      expect(() => assertUrlNotSsrf("http://intra.example/", lookupOf([addr]), NO_ENV)).toThrow(PRIVATE_ERR);
    },
  );

  it("treats 172.32.x and 11.x as public", () => {
    expect(() => assertUrlNotSsrf("http://a.example/", lookupOf(["172.32.0.1", "11.0.0.1"]), NO_ENV)).not.toThrow();
  });

  it("blocks when any resolved address is internal, even if others are public", () => {
    const lookup = lookupOf(["93.184.216.34", "10.0.0.5"]);
    expect(() => assertUrlNotSsrf("http://mixed.example/", lookup, NO_ENV)).toThrow(PRIVATE_ERR);
  });

  it("checks resolved addresses written in numeric forms", () => {
    expect(() => assertUrlNotSsrf("http://n.example/", lookupOf(["2130706433"]), NO_ENV)).toThrow(LOOPBACK_ERR);
    expect(() => assertUrlNotSsrf("http://n.example/", lookupOf(["0x0a000001"]), NO_ENV)).toThrow(PRIVATE_ERR);
    expect(() => assertUrlNotSsrf("http://n.example/", lookupOf(["::ffff:192.168.1.1"]), NO_ENV)).toThrow(
      PRIVATE_ERR,
    );
    expect(() => assertUrlNotSsrf("http://n.example/", lookupOf(["::1"]), NO_ENV)).toThrow(LOOPBACK_ERR);
  });

  it("fails closed when the lookup returns no addresses or garbage", () => {
    expect(() => assertUrlNotSsrf("http://empty.example/", lookupOf([]), NO_ENV)).toThrow(
      "lattice-gated-fetch: DNS resolve returned no addresses",
    );
    expect(() => assertUrlNotSsrf("http://junk.example/", lookupOf(["not-an-address"]), NO_ENV)).toThrow(
      "lattice-gated-fetch: DNS resolve failed",
    );
  });

  it.each([
    ["http://metadata/latest"],
    ["http://metadata.google.internal/computeMetadata/v1/"],
    ["http://service.internal/"],
    ["http://printer.local/"],
    ["http://metadata./"],
  ])("blocks the metadata or internal name %s without a lookup", (url) => {
    const lookup = lookupOf(["93.184.216.34"]);
    expect(() => assertUrlNotSsrf(url, lookup, NO_ENV)).toThrow(PRIVATE_ERR);
    expect(lookup.calls).toEqual([]);
  });

  it.each([
    ["http://2130706433/", LOOPBACK_ERR],
    ["http://0x7f000001/", LOOPBACK_ERR],
    ["http://0177.0.0.1/", LOOPBACK_ERR],
    ["http://127.1/", LOOPBACK_ERR],
    ["http://0.0.0.0/", LOOPBACK_ERR],
    ["http://10.1/", PRIVATE_ERR],
    ["http://0xa9.0xfe.0xa9.0xfe/", PRIVATE_ERR],
    ["http://3232235777/", PRIVATE_ERR],
  ])("blocks the numeric IPv4 trick %s without a lookup", (url, message) => {
    const lookup = lookupOf(["93.184.216.34"]);
    expect(() => assertUrlNotSsrf(url, lookup, NO_ENV)).toThrow(message);
    expect(lookup.calls).toEqual([]);
  });

  it.each([
    ["http://[::1]/", LOOPBACK_ERR],
    ["http://[::]/", LOOPBACK_ERR],
    [`http://[::ffff:${LOOPBACK_V4}]/`, LOOPBACK_ERR],
    ["http://[::ffff:7f00:2]/", LOOPBACK_ERR],
    ["http://[::ffff:10.0.0.1]/", PRIVATE_ERR],
    ["http://[::ffff:a9fe:a9fe]/", PRIVATE_ERR],
    ["http://[fd00::1]/", PRIVATE_ERR],
    ["http://[fc12:3456::1]/", PRIVATE_ERR],
    ["http://[fe80::1]/", PRIVATE_ERR],
  ])("blocks the IPv6 literal %s", (url, message) => {
    expect(() => assertUrlNotSsrf(url, lookupOf([]), NO_ENV)).toThrow(message);
  });

  it("allows public IPv6 literals and IPv4-mapped public addresses", () => {
    expect(() => assertUrlNotSsrf("http://[2606:4700::1111]/", lookupOf([]), NO_ENV)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://[::ffff:8.8.8.8]/", lookupOf([]), NO_ENV)).not.toThrow();
  });

  it("rejects non-http protocols, userinfo and unparsable URLs", () => {
    const lookup = lookupOf(["93.184.216.34"]);
    expect(() => assertUrlNotSsrf("ftp://example.com/", lookup, NO_ENV)).toThrow(
      "lattice-gated-fetch: blocked protocol ftp:",
    );
    expect(() => assertUrlNotSsrf("file:///etc/passwd", lookup, NO_ENV)).toThrow("blocked protocol file:");
    expect(() => assertUrlNotSsrf("http://user:pw@example.com/", lookup, NO_ENV)).toThrow(
      "lattice-gated-fetch: userinfo host spoof blocked",
    );
    expect(() => assertUrlNotSsrf("not a url", lookup, NO_ENV)).toThrow("lattice-gated-fetch: invalid URL");
    expect(lookup.calls).toEqual([]);
  });

  it("AEP_LATTICE_ALLOW_LOOPBACK=1 opens loopback only", () => {
    const env = { AEP_LATTICE_ALLOW_LOOPBACK: "1" };
    expect(() => assertUrlNotSsrf("http://[::1]:9000/", lookupOf([]), env)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://dev.example/", lookupOf([LOOPBACK_V4]), env)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://10.0.0.1/", lookupOf([]), env)).toThrow(PRIVATE_ERR);
  });

  it("AEP_LATTICE_ALLOW_PRIVATE=1 opens private, link-local and metadata names but not loopback", () => {
    const env = { AEP_LATTICE_ALLOW_PRIVATE: "1" };
    expect(() => assertUrlNotSsrf("http://10.0.0.1/", lookupOf([]), env)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://[fe80::1]/", lookupOf([]), env)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://metadata.google.internal/", lookupOf([]), env)).not.toThrow();
    expect(() => assertUrlNotSsrf("http://[::1]/", lookupOf([]), env)).toThrow(LOOPBACK_ERR);
  });

  it("only the exact value 1 enables an allow flag", () => {
    const env = { AEP_LATTICE_ALLOW_LOOPBACK: "true", AEP_LATTICE_ALLOW_PRIVATE: "yes" };
    expect(ssrfPolicyFromEnv(env)).toEqual({ allowLoopback: false, allowPrivate: false });
    expect(() => assertUrlNotSsrf("http://[::1]/", lookupOf([]), env)).toThrow(LOOPBACK_ERR);
  });
});

describe("ssrfPolicyFromEnv", () => {
  it("reads both flags", () => {
    expect(ssrfPolicyFromEnv({})).toEqual({ allowLoopback: false, allowPrivate: false });
    expect(ssrfPolicyFromEnv({ AEP_LATTICE_ALLOW_LOOPBACK: "1", AEP_LATTICE_ALLOW_PRIVATE: "1" })).toEqual({
      allowLoopback: true,
      allowPrivate: true,
    });
  });
});

describe("latticeStrictEnabled", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("is on by default and for any value other than 0", () => {
    setEnv("AEP_LATTICE_STRICT", undefined);
    expect(latticeStrictEnabled()).toBe(true);
    setEnv("AEP_LATTICE_STRICT", "1");
    expect(latticeStrictEnabled()).toBe(true);
  });

  it("refuses STRICT=0 without the dev flag", () => {
    setEnv("AEP_LATTICE_STRICT", "0");
    setEnv("AEP_LATTICE_STRICT_DEV", undefined);
    expect(() => latticeStrictEnabled()).toThrow(/fail-closed/);
  });

  it("allows STRICT=0 with AEP_LATTICE_STRICT_DEV=1", () => {
    setEnv("AEP_LATTICE_STRICT", "0");
    setEnv("AEP_LATTICE_STRICT_DEV", "1");
    expect(latticeStrictEnabled()).toBe(false);
  });
});

describe("buildGatewayEvent", () => {
  it("fills gateway defaults with a low trust score", () => {
    expect(buildGatewayEvent("https://api.example.com/x")).toEqual({
      agent_id: "lattice-gateway",
      channel_id: "ch-outbound-gateway",
      contract_id: "lattice-channel-default",
      event_type: "LATTICE_GATEWAY_REQUEST",
      session_id: "gateway-session",
      docking_port: "inference_engine",
      trust_score: 100,
      payload: { url: "https://api.example.com/x", method: "GET", gateway: "http" },
    });
  });

  it("applies caller metadata and merges payloadExtra into the payload", () => {
    const event = buildGatewayEvent(
      new URL("https://api.example.com/y?q=1"),
      { method: "POST" },
      {
        agentId: "agent-7",
        channelId: "ch-a",
        contractId: "c-1",
        eventType: "CUSTOM",
        sessionId: "s-1",
        trustScore: 640,
        gateway: "llm",
        payloadExtra: { model: "m-1", url: "ignored-by-spread-order" },
      },
    );
    expect(event).toMatchObject({
      agent_id: "agent-7",
      channel_id: "ch-a",
      contract_id: "c-1",
      event_type: "CUSTOM",
      session_id: "s-1",
      docking_port: "inference_engine",
      trust_score: 640,
    });
    expect(event["payload"]).toEqual({
      url: "ignored-by-spread-order",
      method: "POST",
      gateway: "llm",
      model: "m-1",
    });
  });
});

describe("dockSuffix", () => {
  it("maps the four docking ports to their socket names and passes others through", () => {
    expect(dockSuffix("inference_engine")).toBe("inference");
    expect(dockSuffix("validation_engine")).toBe("validation");
    expect(dockSuffix("future_features")).toBe("future");
    expect(dockSuffix("regulation_module")).toBe("regulation");
    expect(dockSuffix("wasm_sandbox")).toBe("wasm_sandbox");
  });
});

describe("responseFromDockAllow", () => {
  it("decodes the base64 body, status, status text and headers", async () => {
    const res = responseFromDockAllow({
      ok: true,
      http: {
        status: 201,
        status_text: "Created",
        headers: [
          ["content-type", "application/json"],
          ["x-trace", "abc"],
        ],
        body_b64: Buffer.from('{"hello":"world"}').toString("base64"),
      },
    });
    expect(res.status).toBe(201);
    expect(res.statusText).toBe("Created");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("x-trace")).toBe("abc");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("keeps binary bodies byte for byte", async () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const res = responseFromDockAllow({
      ok: true,
      http: { status: 200, body_b64: Buffer.from(bytes).toString("base64") },
    });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("returns an empty body when none is sent and skips malformed header pairs", async () => {
    const res = responseFromDockAllow({
      ok: true,
      http: { status: 200, headers: [["only-name"], ["x-ok", "1"]] },
    });
    expect(await res.text()).toBe("");
    expect(res.headers.get("x-ok")).toBe("1");
    expect(res.headers.has("only-name")).toBe(false);
  });

  it("maps no-content statuses to a null body", async () => {
    const res = responseFromDockAllow({ ok: true, http: { status: 204 } });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("rejects a missing or out of range status", () => {
    expect(() => responseFromDockAllow({ ok: true, http: {} })).toThrow(/invalid http status/);
    expect(() => responseFromDockAllow({ ok: true, http: { status: 700 } })).toThrow(/invalid http status/);
  });

  it("throws the dock error when the reply is not ok", () => {
    expect(() => responseFromDockAllow({ ok: false, error: "policy deny" })).toThrow("policy deny");
    expect(() => responseFromDockAllow(null)).toThrow("lattice frame rejected");
    expect(() => responseFromDockAllow({ ok: true })).toThrow(
      "lattice-gated-fetch: dock allow did not return http",
    );
  });
});

describe("sendLatticeLine over a Unix socket", () => {
  let dir = "";
  let server: Server | null = null;
  const received: string[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    received.length = 0;
  });

  afterEach(async () => {
    const s = server;
    server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function listen(onLine: (sock: Socket, line: string) => void): Promise<string> {
    const path = join(dir, "dock.sock");
    const srv = createServer((sock) => {
      let buf = "";
      sock.setEncoding("utf8");
      sock.on("data", (chunk: string) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          const line = buf.slice(0, nl);
          received.push(line);
          onLine(sock, line);
        }
      });
      sock.on("error", () => undefined);
    });
    server = srv;
    await new Promise<void>((resolve) => srv.listen(path, () => resolve()));
    return path;
  }

  it("writes one newline-terminated line and resolves with the first reply line", async () => {
    const path = await listen((sock, line) => {
      const req = JSON.parse(line) as { n: number };
      sock.write(`${JSON.stringify({ ok: true, echo: req.n })}\n{"second":true}\n`);
    });
    const reply = await sendLatticeLine(path, JSON.stringify({ n: 5 }));
    expect(JSON.parse(reply)).toEqual({ ok: true, echo: 5 });
    expect(received).toEqual(['{"n":5}']);
  });

  it("assembles a reply that arrives in several chunks", async () => {
    const path = await listen((sock) => {
      sock.write('{"ok":');
      setTimeout(() => sock.write('true, "part": 2}  \n'), 10);
    });
    const reply = await sendLatticeLine(path, "ping");
    expect(JSON.parse(reply)).toEqual({ ok: true, part: 2 });
  });

  it("rejects when the socket file does not exist", async () => {
    await expect(sendLatticeLine(join(dir, "missing.sock"), "x")).rejects.toThrow(
      `lattice socket not found: ${join(dir, "missing.sock")}`,
    );
  });

  it("rejects when the peer closes before a full line", async () => {
    const path = await listen((sock) => {
      sock.end("partial-without-newline");
    });
    await expect(sendLatticeLine(path, "x")).rejects.toThrow("lattice socket closed before a response line");
  });

  it("rejects on timeout when the peer never answers", async () => {
    const path = await listen(() => undefined);
    await expect(sendLatticeLine(path, "x", 50)).rejects.toThrow("lattice socket timeout");
  });
});

describe("latticeGatedFetch guards", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("rejects an SSRF target before touching the dock", async () => {
    await expect(latticeGatedFetch("http://[::1]:9/", {}, {}, "/nonexistent-socket-base")).rejects.toThrow(
      LOOPBACK_ERR,
    );
    await expect(latticeGatedFetch("http://metadata.google.internal/")).rejects.toThrow(PRIVATE_ERR);
  });

  it("rejects STRICT=0 without the dev flag", async () => {
    setEnv("AEP_LATTICE_STRICT", "0");
    setEnv("AEP_LATTICE_STRICT_DEV", undefined);
    await expect(latticeGatedFetch("http://93.184.216.34/")).rejects.toThrow(/fail-closed/);
  });
});
