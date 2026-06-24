/**
 * JSON-LD style message envelope with optional signing metadata.
 */

export interface MessageEnvelope {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  signature?: string;
  action_path?: string;
}

export function createEnvelope(params: {
  from: string;
  to: string;
  type: string;
  payload?: Record<string, unknown>;
  action_path?: string;
  signature?: string;
}): MessageEnvelope {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: params.from,
    to: params.to,
    type: params.type,
    payload: params.payload ?? {},
    timestamp: Date.now(),
    action_path: params.action_path,
    signature: params.signature,
  };
}

export function validateEnvelope(envelope: unknown): envelope is MessageEnvelope {
  if (!envelope || typeof envelope !== "object") return false;
  const e = envelope as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.from === "string" &&
    typeof e.to === "string" &&
    typeof e.type === "string" &&
    typeof e.timestamp === "number" &&
    (e.payload === undefined || (typeof e.payload === "object" && e.payload !== null))
  );
}

export function envelopeToJsonLd(envelope: MessageEnvelope): Record<string, unknown> {
  return {
    "@context": "urn:aep:comm:v1",
    "@type": "MessageEnvelope",
    ...envelope,
  };
}