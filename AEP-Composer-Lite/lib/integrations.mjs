/** Paid / external connector probes for Composer Lite (open-source base node). */

import { latticeGatedFetch } from "../../AEP-Components/lattice-channels/lib/lattice-transport.mjs";
import { defaultPaths } from "../../AEP-Components/wizard/lib/paths.mjs";

export function resolveAgentstreamUrl(runtime, env = process.env) {
  const fromEnv = String(env.AGENTSTREAM_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const fromConfig =
    runtime?.config?.integrations?.agentstream_url
    || runtime?.config?.base_node?.agentstream_url
    || runtime?.config?.agentstream_url;
  if (fromConfig) return String(fromConfig).trim().replace(/\/$/, "");
  return null;
}

export async function probeAgentstream(url, { timeoutMs = 1200, socketBase } = {}) {
  if (!url) {
    return {
      id: "conn-agentstream",
      service: "agentstream",
      label: "Agentstream",
      paid_addon: true,
      configured: false,
      connected: false,
      online: false,
      status: "unconfigured",
      url: null,
    };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await latticeGatedFetch(
      socketBase ?? defaultPaths().socketBase,
      {
        agentId: "composer-lite",
        channelId: "ch-agentstream-probe",
        gateway: "agentstream",
        eventType: "AGENTSTREAM_HEALTH_PROBE",
      },
      `${url}/api/health`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      return {
        id: "conn-agentstream",
        service: "agentstream",
        label: "Agentstream",
        paid_addon: true,
        configured: true,
        connected: false,
        online: false,
        status: `http_${res.status}`,
        url,
      };
    }
    const data = await res.json().catch(() => ({}));
    const raw = String(data?.status ?? data?.health ?? "").toLowerCase();
    const connected = raw === "ok" || raw === "healthy" || raw === "online";
    return {
      id: "conn-agentstream",
      service: "agentstream",
      label: "Agentstream",
      paid_addon: true,
      configured: true,
      connected,
      online: connected,
      status: data?.status ?? (connected ? "ok" : "degraded"),
      url,
    };
  } catch (err) {
    return {
      id: "conn-agentstream",
      service: "agentstream",
      label: "Agentstream",
      paid_addon: true,
      configured: true,
      connected: false,
      online: false,
      status: "offline",
      url,
      error: err?.message || "probe failed",
    };
  }
}

export async function getIntegrationsState(runtime, env = process.env) {
  const agentstream = await probeAgentstream(resolveAgentstreamUrl(runtime, env), {
    socketBase: runtime.socketBase,
  });
  let hcse = {
    id: "conn-hcse",
    service: "hcse",
    label: "AEP-HCSE",
    configured: false,
    connected: false,
    online: false,
    status: "not_installed",
  };
  try {
    const { probeHcseLocal } = await import("../../hcse/lib/hcse-bridge.mjs");
    const dataDir = runtime?.dataDir ?? env.AEP_DATA;
    if (dataDir) hcse = probeHcseLocal(dataDir);
  } catch {
    /* hcse optional */
  }
  return { agentstream, hcse, generated_at: new Date().toISOString() };
}