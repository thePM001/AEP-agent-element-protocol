import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { request } from "node:http";
import { createHmac } from "node:crypto";
import {
  DEFAULT_WEBHOOK_HOST,
  WEBHOOK_MAX_BODY_BYTES,
  WebhookObserverAdapter,
  isLoopbackHost,
  type WebhookObserverConfig,
} from "../observers/webhook/index.js";
import type { LatticeEvent } from "../observers/interface.js";
import { quietConsole, restoreAll, type QuietConsole } from "./support/fakes.js";

// Built at runtime so no literal secret lands in the source.
const SECRET = ["webhook", "test", "key", String(Date.now())].join("-");

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

describe("isLoopbackHost", () => {
  it.each([
    ["localhost", true],
    ["LOCALHOST ", true],
    ["::1", true],
    ["[::1]", true],
    [DEFAULT_WEBHOOK_HOST, true],
    ["127.10.20.30", true],
    ["128.0.0.1", false],
    ["0.0.0.0", false],
    ["127.example.com", false],
    ["10.0.0.1", false],
  ])("%s -> %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});

describe("WebhookObserverAdapter configuration", () => {
  it("refuses a non-loopback bind without an HMAC secret", () => {
    expect(() => new WebhookObserverAdapter({ host: "0.0.0.0" })).toThrow(/hmacSecret is required/);
    expect(() => new WebhookObserverAdapter({ host: "0.0.0.0", hmacSecret: SECRET })).not.toThrow();
  });

  it("defaults to loopback and names itself after the port", () => {
    expect(new WebhookObserverAdapter().name).toBe("webhook:9000");
    expect(new WebhookObserverAdapter({ port: 9100 }).name).toBe("webhook:9100");
    expect(new WebhookObserverAdapter({ name: "hooks" }).name).toBe("hooks");
  });

  it("exposes the 1 MiB default body cap", () => {
    expect(WEBHOOK_MAX_BODY_BYTES).toBe(1024 * 1024);
  });

  it("stop before start is a no-op and address is null", async () => {
    const a = new WebhookObserverAdapter({ port: 0 });
    await expect(a.stop()).resolves.toBeUndefined();
    expect(a.address()).toBeNull();
  });
});

describe("WebhookObserverAdapter over loopback HTTP", () => {
  let out: QuietConsole;
  let events: LatticeEvent[];
  let adapters: WebhookObserverAdapter[];

  async function listen(cfg: WebhookObserverConfig = {}): Promise<WebhookObserverAdapter> {
    const a = new WebhookObserverAdapter({ port: 0, ...cfg });
    a.onEvent((e) => events.push(e));
    adapters.push(a);
    await a.start();
    return a;
  }

  function send(
    a: WebhookObserverAdapter,
    opts: { method?: string; path?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Reply> {
    const addr = a.address();
    if (!addr) throw new Error("adapter is not listening");
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: addr.host,
          port: addr.port,
          method: opts.method ?? "POST",
          path: opts.path ?? "/events",
          headers: { "Content-Type": "application/json", ...opts.headers },
          agent: false,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : {} });
          });
        },
      );
      req.on("error", reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  }

  beforeEach(() => {
    out = quietConsole();
    events = [];
    adapters = [];
  });

  afterEach(async () => {
    for (const a of adapters) await a.stop();
    restoreAll();
  });

  it("binds to the IPv4 loopback address by default", async () => {
    const a = await listen();
    expect(a.address()?.host).toBe(DEFAULT_WEBHOOK_HOST);
    expect(a.address()?.port).toBeGreaterThan(0);
    expect(out.logs.join("\n")).toMatch(/listening/);
  });

  it("accepts a JSON event and forwards it to the callback", async () => {
    const a = await listen();
    const before = Date.now();
    const reply = await send(a, {
      body: JSON.stringify({ source: "stripe", action_path: "webhook:incoming", payload: { amount: 5 }, agent_id: "agent-g" }),
    });
    expect(reply).toEqual({ status: 200, body: { accepted: true, action_path: "webhook:incoming" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "stripe",
      action_path: "webhook:incoming",
      payload: { amount: 5 },
      agent_id: "agent-g",
    });
    expect(events[0]?.bridge_timestamp).toBeGreaterThanOrEqual(before);
  });

  it("fills defaults and ignores fields of the wrong type", async () => {
    const a = await listen({ name: "hooks" });
    await send(a, { body: JSON.stringify({ source: 5, payload: [1, 2], agent_id: 9 }) });
    expect(events[0]).toEqual({
      source: "hooks",
      action_path: "unknown",
      payload: {},
      bridge_timestamp: events[0]?.bridge_timestamp,
    });
    expect(events[0] && "agent_id" in events[0]).toBe(false);
  });

  it("ignores the query string when matching the endpoint", async () => {
    const a = await listen({ endpoint: "/hooks" });
    const reply = await send(a, { path: "/hooks?delivery=1", body: "{}" });
    expect(reply.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("rejects other methods and paths", async () => {
    const a = await listen();
    expect(await send(a, { method: "GET" })).toEqual({ status: 405, body: { error: "Method Not Allowed" } });
    expect(await send(a, { path: "/other", body: "{}" })).toEqual({ status: 404, body: { error: "Not Found" } });
    expect(events).toHaveLength(0);
  });

  it("rejects invalid JSON and non-object JSON without crashing", async () => {
    const a = await listen();
    expect((await send(a, { body: "{oops" })).status).toBe(400);
    for (const body of ["null", "[1,2]", "42", '"text"']) {
      const reply = await send(a, { body });
      expect(reply).toEqual({ status: 400, body: { error: "JSON body must be an object" } });
    }
    // the server is still up
    expect((await send(a, { body: "{}" })).status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("refuses bodies above the size cap", async () => {
    const a = await listen({ maxBodyBytes: 32 });
    const reply = await send(a, { body: JSON.stringify({ pad: "x".repeat(200) }) });
    expect(reply).toEqual({ status: 413, body: { error: "Payload Too Large" } });
    expect(events).toHaveLength(0);
  });

  describe("with an HMAC secret", () => {
    it("requires the signature header", async () => {
      const a = await listen({ hmacSecret: SECRET });
      const reply = await send(a, { body: "{}" });
      expect(reply).toEqual({ status: 401, body: { error: "Missing x-signature-256 header" } });
      expect(events).toHaveLength(0);
    });

    it("rejects a wrong or malformed signature", async () => {
      const a = await listen({ hmacSecret: SECRET });
      const body = JSON.stringify({ action_path: "x" });
      for (const sig of [sign(body, "other-key"), "zz", sign(body).slice(2)]) {
        const reply = await send(a, { body, headers: { "x-signature-256": sig } });
        expect(reply).toEqual({ status: 401, body: { error: "Invalid signature" } });
      }
      expect(events).toHaveLength(0);
    });

    it("accepts a valid signature and records it in the payload", async () => {
      const a = await listen({ hmacSecret: SECRET });
      const body = JSON.stringify({ action_path: "webhook:incoming", payload: { n: 1 } });
      const sig = sign(body);
      const reply = await send(a, { body, headers: { "x-signature-256": sig } });
      expect(reply.status).toBe(200);
      expect(events[0]?.payload).toEqual({ n: 1, signature: sig });
    });

    it("does not overwrite a signature already in the payload", async () => {
      const a = await listen({ hmacSecret: SECRET });
      const body = JSON.stringify({ payload: { signature: "upstream" } });
      await send(a, { body, headers: { "x-signature-256": sign(body) } });
      expect(events[0]?.payload).toEqual({ signature: "upstream" });
    });

    it("reads a custom signature header", async () => {
      const a = await listen({ hmacSecret: SECRET, signatureHeader: "X-Hub-Signature" });
      const body = "{}";
      const missing = await send(a, { body, headers: { "x-signature-256": sign(body) } });
      expect(missing.status).toBe(401);
      const ok = await send(a, { body, headers: { "X-Hub-Signature": sign(body) } });
      expect(ok.status).toBe(200);
    });
  });

  it("start and stop are idempotent", async () => {
    const a = await listen();
    const port = a.address()?.port;
    await a.start();
    expect(a.address()?.port).toBe(port);
    await a.stop();
    await a.stop();
    expect(a.address()).toBeNull();
    expect(out.logs.join("\n")).toMatch(/Server stopped/);
  });

  it("start rejects when the port is taken", async () => {
    const first = await listen();
    const port = first.address()?.port;
    if (port === undefined) throw new Error("no port");
    const second = new WebhookObserverAdapter({ port });
    await expect(second.start()).rejects.toThrow(/EADDRINUSE/);
  });
});
