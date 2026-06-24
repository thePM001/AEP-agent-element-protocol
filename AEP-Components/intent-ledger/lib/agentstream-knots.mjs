#!/usr/bin/env node

/**
 * Optional Agentstream mirror for intent knots (paid NLA connector).
 * Lattice Memory (sqlite-vec + USearch via aep-memory) remains the canonical open-source path.
 */

import { latticeGatedFetch } from "../../lattice-channels/lib/lattice-transport.mjs";
import { resolveAgentstreamUrl } from "../../../AEP-Composer-Lite/lib/integrations.mjs";
import { defaultPaths } from "../../wizard/lib/paths.mjs";

const DEFAULT_CAPSULE = "aep-intent-knots";
const DEFAULT_TIMEOUT_MS = 5000;

export function resolveAgentstreamKnotConfig(env = process.env, runtime = null) {
  const url = resolveAgentstreamUrl(runtime, env);
  if (!url) return null;
  const capsule = String(env.AGENTSTREAM_INTENT_KNOTS_CAPSULE || DEFAULT_CAPSULE).trim();
  const timeoutMs = Number(env.AGENTSTREAM_INTENT_KNOTS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return { url, capsule, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS };
}

export async function probeAgentstreamKnots(config, { socketBase } = {}) {
  if (!config?.url) {
    return { configured: false, connected: false, status: "unconfigured" };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const res = await latticeGatedFetch(
      socketBase ?? defaultPaths().socketBase,
      {
        agentId: "intent-knots",
        channelId: "ch-agentstream-intent-knots-health",
        gateway: "agentstream",
        eventType: "AGENTSTREAM_INTENT_KNOTS_HEALTH",
      },
      `${config.url}/api/health`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timer);
    if (!res.ok) return { configured: true, connected: false, status: `http_${res.status}` };
    const body = await res.json().catch(() => ({}));
    const raw = String(body?.status ?? body?.health ?? "ok").toLowerCase();
    const connected = raw === "ok" || raw === "healthy" || raw === "online";
    return { configured: true, connected, status: connected ? "ok" : raw };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      status: err instanceof Error ? err.message : "offline",
    };
  }
}

/**
 * Mirror an intent knot to Agentstream. Never throws unless strict mode is on.
 * @param {object} knot - intent knot record
 * @param {object} [opts]
 */
export async function mirrorIntentKnotToAgentstream(knot, opts = {}) {
  const config = opts.config ?? resolveAgentstreamKnotConfig();
  if (!config?.url) {
    return { mirrored: false, skipped: true, reason: "agentstream_unconfigured" };
  }
  if (opts.probe !== false) {
    const health = await probeAgentstreamKnots(config, { socketBase: opts.socketBase });
    if (!health.connected) {
      return { mirrored: false, skipped: true, reason: health.status ?? "agentstream_offline" };
    }
  }

  const record = {
    id: knot.id,
    timestamp: knot.timestamp,
    type: "intent_knot",
    payload: knot,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const res = await latticeGatedFetch(
      opts.socketBase ?? defaultPaths().socketBase,
      {
        agentId: "intent-knots",
        channelId: "ch-agentstream-intent-knots-append",
        gateway: "agentstream",
        eventType: "AGENTSTREAM_INTENT_KNOTS_APPEND",
        sessionId: knot.intent_id ?? "intent-knot-session",
      },
      `${config.url}/api/evidence/${encodeURIComponent(config.capsule)}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(record),
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      const err = new Error(`Agentstream intent knot mirror failed: HTTP ${res.status}`);
      if (opts.strict) throw err;
      return { mirrored: false, skipped: false, error: err.message };
    }
    return { mirrored: true, capsule: config.capsule, url: config.url };
  } catch (err) {
    clearTimeout(timer);
    const message = err instanceof Error ? err.message : String(err);
    if (opts.strict) throw err;
    return { mirrored: false, skipped: false, error: message };
  }
}