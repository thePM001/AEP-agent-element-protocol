import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mirrorIntentKnotToAgentstream,
  probeAgentstreamKnots,
  resolveAgentstreamKnotConfig,
} from "../lib/agentstream-knots.mjs";
import { jsonResponse, openSandbox, PUBLIC_AGENTSTREAM_URL, useDirectFetch } from "./env-guard.mjs";

let box;

beforeEach(() => {
  box = openSandbox();
});

afterEach(() => {
  box.restore();
});

const CONFIG = { url: PUBLIC_AGENTSTREAM_URL, capsule: "aep-intent-knots", timeoutMs: 2000 };

describe("resolveAgentstreamKnotConfig", () => {
  it("returns null when no Agentstream URL is configured", () => {
    expect(resolveAgentstreamKnotConfig({})).toBeNull();
    expect(resolveAgentstreamKnotConfig({ AGENTSTREAM_URL: "   " })).toBeNull();
  });

  it("uses defaults for capsule and timeout and strips a trailing slash", () => {
    expect(resolveAgentstreamKnotConfig({ AGENTSTREAM_URL: "https://as.example/" })).toEqual({
      url: "https://as.example",
      capsule: "aep-intent-knots",
      timeoutMs: 5000,
    });
  });

  it("reads capsule and timeout overrides from env", () => {
    expect(
      resolveAgentstreamKnotConfig({
        AGENTSTREAM_URL: "https://as.example",
        AGENTSTREAM_INTENT_KNOTS_CAPSULE: "  team-capsule ",
        AGENTSTREAM_INTENT_KNOTS_TIMEOUT_MS: "250",
      }),
    ).toEqual({ url: "https://as.example", capsule: "team-capsule", timeoutMs: 250 });
  });

  it("falls back to the default timeout for a non numeric value", () => {
    const cfg = resolveAgentstreamKnotConfig({
      AGENTSTREAM_URL: "https://as.example",
      AGENTSTREAM_INTENT_KNOTS_TIMEOUT_MS: "soon",
    });
    expect(cfg.timeoutMs).toBe(5000);
  });

  it("reads the URL from runtime config when env has none", () => {
    const runtime = { config: { integrations: { agentstream_url: "https://rt.example/" } } };
    expect(resolveAgentstreamKnotConfig({}, runtime).url).toBe("https://rt.example");
  });

  it("reads process.env by default", () => {
    process.env.AGENTSTREAM_URL = "https://proc.example";
    expect(resolveAgentstreamKnotConfig().url).toBe("https://proc.example");
  });
});

describe("probeAgentstreamKnots", () => {
  it("reports unconfigured without touching the network", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    expect(await probeAgentstreamKnots(null)).toEqual({
      configured: false,
      connected: false,
      status: "unconfigured",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports connected for a healthy body and hits the health path", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, { status: "Healthy" }));
    expect(await probeAgentstreamKnots(CONFIG)).toEqual({
      configured: true,
      connected: true,
      status: "ok",
    });
    expect(calls[0].url).toBe(`${PUBLIC_AGENTSTREAM_URL}/api/health`);
    expect(calls[0].init.headers.Accept).toBe("application/json");
  });

  it("accepts the health field and a body that is not JSON", async () => {
    useDirectFetch(() => jsonResponse(200, { health: "online" }));
    expect((await probeAgentstreamKnots(CONFIG)).connected).toBe(true);
    useDirectFetch(() => new Response("plain text", { status: 200 }));
    expect(await probeAgentstreamKnots(CONFIG)).toMatchObject({ connected: true, status: "ok" });
  });

  it("reports a degraded status as not connected", async () => {
    useDirectFetch(() => jsonResponse(200, { status: "Degraded" }));
    expect(await probeAgentstreamKnots(CONFIG)).toEqual({
      configured: true,
      connected: false,
      status: "degraded",
    });
  });

  it("reports the HTTP status of a failed probe", async () => {
    useDirectFetch(() => jsonResponse(503, {}));
    expect(await probeAgentstreamKnots(CONFIG)).toEqual({
      configured: true,
      connected: false,
      status: "http_503",
    });
  });

  it("reports the error message when the request throws", async () => {
    useDirectFetch(() => {
      throw new Error("connection refused");
    });
    expect(await probeAgentstreamKnots(CONFIG)).toEqual({
      configured: true,
      connected: false,
      status: "connection refused",
    });
  });

  it("refuses a private address before any request is made", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, { status: "ok" }));
    const out = await probeAgentstreamKnots({ ...CONFIG, url: "http://10.0.0.5" });
    expect(out.connected).toBe(false);
    expect(out.status).toMatch(/lattice-gated-fetch/);
    expect(calls).toHaveLength(0);
  });
});

describe("mirrorIntentKnotToAgentstream", () => {
  const knot = { id: "ik-propose-i1-1", timestamp: "2026-01-01T00:00:00.000Z", intent_id: "i1" };

  it("skips when Agentstream is not configured", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    expect(await mirrorIntentKnotToAgentstream(knot)).toEqual({
      mirrored: false,
      skipped: true,
      reason: "agentstream_unconfigured",
    });
    expect(calls).toHaveLength(0);
  });

  it("skips with the probe status when the health probe fails", async () => {
    const calls = useDirectFetch(() => jsonResponse(500, {}));
    expect(await mirrorIntentKnotToAgentstream(knot, { config: CONFIG })).toEqual({
      mirrored: false,
      skipped: true,
      reason: "http_500",
    });
    expect(calls).toHaveLength(1);
  });

  it("probes then posts the knot record to the capsule evidence path", async () => {
    const calls = useDirectFetch((url) =>
      url.endsWith("/api/health") ? jsonResponse(200, { status: "ok" }) : jsonResponse(201, {}),
    );
    const config = { ...CONFIG, capsule: "team knots" };
    expect(await mirrorIntentKnotToAgentstream(knot, { config })).toEqual({
      mirrored: true,
      capsule: "team knots",
      url: PUBLIC_AGENTSTREAM_URL,
    });
    expect(calls).toHaveLength(2);
    const post = calls[1];
    expect(post.url).toBe(`${PUBLIC_AGENTSTREAM_URL}/api/evidence/team%20knots`);
    expect(post.init.method).toBe("POST");
    expect(JSON.parse(post.init.body)).toEqual({
      id: knot.id,
      timestamp: knot.timestamp,
      type: "intent_knot",
      payload: knot,
    });
  });

  it("posts without a probe when probe is false", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    const out = await mirrorIntentKnotToAgentstream(knot, { config: CONFIG, probe: false });
    expect(out.mirrored).toBe(true);
    expect(calls.map((c) => c.init.method)).toEqual(["POST"]);
  });

  it("returns the HTTP error when the append fails and strict is off", async () => {
    useDirectFetch(() => jsonResponse(502, {}));
    expect(await mirrorIntentKnotToAgentstream(knot, { config: CONFIG, probe: false })).toEqual({
      mirrored: false,
      skipped: false,
      error: "Agentstream intent knot mirror failed: HTTP 502",
    });
  });

  it("throws the HTTP error when strict is on", async () => {
    useDirectFetch(() => jsonResponse(502, {}));
    await expect(
      mirrorIntentKnotToAgentstream(knot, { config: CONFIG, probe: false, strict: true }),
    ).rejects.toThrow(/HTTP 502/);
  });

  it("returns or throws a transport error depending on strict", async () => {
    useDirectFetch(() => {
      throw new Error("socket hang up");
    });
    expect(await mirrorIntentKnotToAgentstream(knot, { config: CONFIG, probe: false })).toEqual({
      mirrored: false,
      skipped: false,
      error: "socket hang up",
    });
    await expect(
      mirrorIntentKnotToAgentstream(knot, { config: CONFIG, probe: false, strict: true }),
    ).rejects.toThrow("socket hang up");
  });
});
