/**
 * JSON-LD style message envelope with mandatory signing for routed delivery.
 */

import { sign as cryptoSign, verify as cryptoVerify, createPrivateKey, createPublicKey } from "node:crypto";

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

/** Canonical bytes for signing (excludes signature field). */
export function canonicalEnvelopePayload(envelope: MessageEnvelope): string {
  return JSON.stringify({
    id: envelope.id,
    from: envelope.from,
    to: envelope.to,
    type: envelope.type,
    payload: envelope.payload ?? {},
    timestamp: envelope.timestamp,
    action_path: envelope.action_path ?? null,
  });
}

export function createEnvelope(params: {
  from: string;
  to: string;
  type: string;
  payload?: Record<string, unknown>;
  action_path?: string;
  signature?: string;
  privateKeyPem?: string;
}): MessageEnvelope {
  const envelope: MessageEnvelope = {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: params.from,
    to: params.to,
    type: params.type,
    payload: params.payload ?? {},
    timestamp: Date.now(),
    action_path: params.action_path,
    signature: params.signature,
  };
  if (params.privateKeyPem) {
    envelope.signature = signEnvelope(envelope, params.privateKeyPem);
  }
  return envelope;
}

export function signEnvelope(envelope: MessageEnvelope, privateKeyPem: string): string {
  const { signature: _drop, ...rest } = envelope;
  const payload = canonicalEnvelopePayload(rest as MessageEnvelope);
  try {
    const key = createPrivateKey(privateKeyPem);
    const sig = cryptoSign(null, Buffer.from(payload), key);
    return sig.toString("base64");
  } catch {
    const key = createPrivateKey(privateKeyPem);
    const sig = cryptoSign("sha256", Buffer.from(payload), key);
    return sig.toString("base64");
  }
}

export function verifyEnvelopeSignature(envelope: MessageEnvelope, publicKeyPem: string): boolean {
  if (!envelope.signature || typeof envelope.signature !== "string") return false;
  const payload = canonicalEnvelopePayload(envelope);
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(envelope.signature, "base64");
  } catch {
    return false;
  }
  if (sigBuf.length === 0) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    if (cryptoVerify(null, Buffer.from(payload), key, sigBuf)) return true;
  } catch {
    /* try sha256 */
  }
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify("sha256", Buffer.from(payload), key, sigBuf);
  } catch {
    return false;
  }
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

