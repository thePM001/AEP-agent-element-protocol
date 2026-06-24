/**
 * dynAEP observer outbound HTTP - MUST pass through lattice inference_engine gate.
 */

import {
  latticeGatedFetch,
  type LatticeGatewayMeta,
} from "../../../lattice-channels/lib/lattice-gated-fetch.js";

export interface ObserverOutboundMeta extends LatticeGatewayMeta {
  observer?: string;
  adapter?: string;
}

export async function observerLatticeFetch(
  url: string | URL,
  init: RequestInit = {},
  meta: ObserverOutboundMeta = {},
): Promise<Response> {
  return latticeGatedFetch(url, init, {
    agentId: meta.agentId ?? "dynaep-observer",
    channelId: meta.channelId ?? "ch-dynaep-observer",
    contractId: meta.contractId ?? "lattice-channel-default",
    eventType: meta.eventType ?? "DYNAEP_OBSERVER_OUTBOUND",
    sessionId: meta.sessionId ?? `observer-${meta.adapter ?? "unknown"}`,
    trustScore: meta.trustScore ?? 720,
    gateway: meta.gateway ?? "http",
    payloadExtra: {
      observer: meta.observer ?? meta.adapter,
      ...(meta.payloadExtra ?? {}),
    },
  });
}