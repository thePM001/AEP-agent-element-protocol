/**
 * AEP HTML/CSS SDK - browser lattice client (delegates frame build to aep-lattice-log via optional bridge).
 * For strict lattice mode in browser, host must expose POST /aep/lattice/build-frame.
 */
export function latticeStrictEnabled() {
  return (globalThis.AEP_LATTICE_STRICT ?? "1") !== "0";
}

export async function buildLatticeFrame(event, bridgeUrl = "/aep/lattice/build-frame") {
  const res = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`lattice bridge failed: ${res.status}`);
  const parsed = await res.json();
  if (!parsed.frame) throw new Error("missing LatticeChannelFrame");
  return parsed;
}

export async function latticeDockRequest(sealed, dockUrl = "/aep/lattice/dock") {
  const res = await fetch(dockUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ frame: sealed.frame }),
  });
  if (!res.ok) throw new Error("lattice dock failed: " + res.status);
  const resp = await res.json();
  if (!resp.ok) throw new Error(resp.error || "lattice frame rejected");
  return resp;
}

function responseFromDockAllow(resp) {
  if (!resp || resp.ok !== true) {
    throw new Error((resp && resp.error) || "lattice frame rejected");
  }
  const http = resp.http;
  if (!http) {
    throw new Error("lattice-gated-fetch: dock allow did not return http");
  }
  const raw = String(http.body_b64 || "");
  let body = new Uint8Array(0);
  if (raw) {
    const bin = atob(raw);
    body = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) body[i] = bin.charCodeAt(i);
  }
  const headers = new Headers();
  const pairs = Array.isArray(http.headers) ? http.headers : [];
  for (const pair of pairs) {
    if (Array.isArray(pair) && pair.length >= 2) headers.append(String(pair[0]), String(pair[1]));
  }
  return new Response(body, { status: Number(http.status) || 0, statusText: String(http.status_text || ""), headers });
}

export async function latticeGatedFetch(url, init = {}, meta = {}) {
  if (!latticeStrictEnabled()) return fetch(url, init);
  const sealed = await buildLatticeFrame({
    agent_id: meta.agentId ?? "lattice-gateway",
    channel_id: meta.channelId ?? "ch-outbound-gateway",
    contract_id: meta.contractId ?? "lattice-channel-default",
    event_type: meta.eventType ?? "LATTICE_GATEWAY_REQUEST",
    session_id: meta.sessionId ?? "gateway-session",
    docking_port: "inference_engine",
    trust_score: meta.trustScore ?? 750,
    payload: {
      url: String(url),
      method: init.method ?? "GET",
      gateway: meta.gateway ?? "http",
      ...(meta.payloadExtra ?? {}),
    },
  });
  const resp = await latticeDockRequest(sealed);
  return responseFromDockAllow(resp);
}