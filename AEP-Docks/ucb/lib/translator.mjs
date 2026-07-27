/**
 * UCB representation translation (phi): foreign agent payloads -> DynAep lattice events.
 * Reference: NLA Research Paper 005 - Universal Connect Bridge.
 */

import { normalizeDockPort } from "../../lattice-channels/lib/lattice-transport.mjs";

const SUPPORTED_PROTOCOLS = new Set([
  "langgraph",
  "langchain",
  "autogen",
  "crewai",
  "mcp",
  "cursor",
  "claude-code",
  "codex",
  "custom",
  "http",
]);

export function normalizeProtocol(value) {
  const raw = String(value ?? "custom").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return SUPPORTED_PROTOCOLS.has(raw) ? raw : "custom";
}

function factFromStructured(payload) {
  const subject = payload.subject ?? payload.s ?? null;
  const predicate = payload.predicate ?? payload.p ?? null;
  const object = payload.object ?? payload.o ?? null;
  if (subject && predicate && object) {
    return { subject: String(subject), predicate: String(predicate), object: String(object) };
  }
  return null;
}

function hypervectorSeed(text) {
  let hash = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Deterministic VSA-style binding fingerprint for resonance predicate P_R.
 */
export function bindingFingerprint(payload) {
  const fact = factFromStructured(payload);
  if (fact) {
    return hypervectorSeed(`${fact.subject}|${fact.predicate}|${fact.object}`);
  }
  const keys = Object.keys(payload ?? {}).sort();
  return hypervectorSeed(keys.map((k) => `${k}:${JSON.stringify(payload[k])}`).join(";"));
}

export function translateForeignIngest(body, defaults = {}) {
  const protocol = normalizeProtocol(body.protocol ?? body.provenance?.source);
  const sessionId =
    body.session_id
    ?? body.provenance?.session_id
    ?? defaults.sessionId
    ?? `ucb-${protocol}-${Date.now()}`;
  const agentId = body.agent_id ?? body.provenance?.agent_id ?? defaults.agentId ?? `ucb-foreign-${protocol}`;
  const eventType = String(body.event_type ?? "UCB_FOREIGN_INGEST").trim();
  const dock = normalizeDockPort(body.dock ?? body.docking_port ?? "validation_engine");
  const rawTrust = Number(body.trust_score ?? defaults.trustScore ?? 650);
  const trustScore = Number.isFinite(rawTrust)
    ? Math.max(0, Math.min(1000, Math.trunc(rawTrust)))
    : 650;
  const payload = body.payload ?? body.content ?? body.data ?? {};
  const fact = factFromStructured(payload);
  const translated = {
    foreign_protocol: protocol,
    foreign_event_type: eventType,
    binding_fingerprint: bindingFingerprint(payload),
    ...(fact ? { structured_fact: fact } : {}),
    raw: payload,
    provenance: {
      source: body.provenance?.source ?? protocol,
      protocol: body.provenance?.protocol ?? "ucb/1.0",
      session_id: sessionId,
      timestamp_ms: body.provenance?.timestamp_ms ?? Date.now(),
      bridge: "ucb/2.8.0",
    },
  };

  return {
    agent_id: agentId,
    channel_id: body.channel_id ?? `ch-ucb-${protocol}`,
    contract_id: body.contract_id ?? "dynaep-action-lattice",
    event_type: "UCB_INGEST",
    session_id: sessionId,
    docking_port: dock,
    trust_score: trustScore,
    payload: translated,
  };
}

export function translateDelegateRequest(body, defaults = {}) {
  const protocol = normalizeProtocol(body.protocol ?? "custom");
  const sessionId = body.session_id ?? `ucb-delegate-${Date.now()}`;
  return {
    protocol,
    session_id: sessionId,
    agent_id: body.agent_id ?? defaults.agentId ?? "ucb-delegate",
    prompt: String(body.prompt ?? body.message ?? "").trim(),
    schema: body.schema ?? body.response_schema ?? null,
    ingest_result: Boolean(body.ingest_result),
    capability_scope: body.capability_scope ?? body.scope ?? "read-only-delegation",
  };
}