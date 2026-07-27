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

export async function latticeGatedFetch(url, init = {}, meta = {}) {
  if (!latticeStrictEnabled()) return fetch(url, init);
  await buildLatticeFrame({
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
  return fetch(url, init);
}