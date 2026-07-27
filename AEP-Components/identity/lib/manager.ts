// @PAD: p0-v275-c1-identity-sign-verify-v1
// @GCDE: document_sha256=p0-v275-c1-identity-fail-closed-ed25519
import { createPublicKey, generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import type { AgentIdentity, CompactIdentity } from "./types.js";

export interface CreateIdentityInput {
  name: string;
  version: string;
  operator: string;
  description: string;
  capabilities: string[];
  covenants: string[];
  endpoints: Array<{ protocol: string; url: string }>;
  maxTrustTier: string;
  defaultRing: number;
  expiresAt: string;
}

/** Canonical JSON: keys sorted at each object level (replacer-array form does not sort). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      ordered[key] = canonicalize(obj[key]);
    }
    return ordered;
  }
  return value;
}

export class AgentIdentityManager {
  static create(info: CreateIdentityInput, privateKey: string): AgentIdentity {
    const identity: AgentIdentity = {
      agentId: randomUUID(),
      name: info.name,
      version: info.version,
      operator: info.operator,
      description: info.description,
      capabilities: info.capabilities,
      covenants: info.covenants,
      endpoints: info.endpoints,
      maxTrustTier: info.maxTrustTier,
      defaultRing: info.defaultRing,
      publicKey: "",
      createdAt: new Date().toISOString(),
      expiresAt: info.expiresAt,
      signature: "",
    };

    try {
      const pubKey = createPublicKey({
        key: privateKey,
        format: "pem",
      } as Parameters<typeof createPublicKey>[0]);
      identity.publicKey = pubKey.export({ type: "spki", format: "pem" }) as string;
    } catch (err) {
      throw new Error(
        `Failed to derive public key from private key: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const payload = AgentIdentityManager.serializeForSigning(identity);
    identity.signature = AgentIdentityManager.signPayload(payload, privateKey);
    return identity;
  }

  static verify(identity: AgentIdentity): boolean {
    if (!identity.signature || !identity.publicKey) return false;
    // BM-08: expiry fail-closed; invalid expiresAt is expired
    if (AgentIdentityManager.isExpired(identity)) return false;
    const payload = AgentIdentityManager.serializeForSigning(identity);
    return AgentIdentityManager.verifyPayload(
      payload,
      identity.signature,
      identity.publicKey
    );
  }

  static isExpired(identity: AgentIdentity): boolean {
    const t = Date.parse(identity.expiresAt);
    if (!Number.isFinite(t)) return true;
    return t < Date.now();
  }

  static toCompact(identity: AgentIdentity): CompactIdentity {
    return {
      agentId: identity.agentId,
      name: identity.name,
      publicKey: identity.publicKey,
      capabilities: identity.capabilities,
      expiresAt: identity.expiresAt,
      signature: identity.signature,
    };
  }

  static generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    return { publicKey, privateKey };
  }

  /** Ed25519 (null alg) first, then RSA/ECDSA sha256. No hash soft-signatures (C-1). */
  static signPayload(payload: string, privateKey: string): string {
    try {
      const sig = sign(null, Buffer.from(payload), {
        key: privateKey,
        format: "pem",
        type: "pkcs8",
      });
      return sig.toString("base64");
    } catch {
      try {
        const sig = sign("sha256", Buffer.from(payload), {
          key: privateKey,
          format: "pem",
          type: "pkcs8",
        });
        return sig.toString("base64");
      } catch (err) {
        throw new Error(
          `Identity signing failed (no soft hash fallback): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  static verifyPayload(
    payload: string,
    signatureB64: string,
    publicKeyPem: string
  ): boolean {
    let sigBuf: Buffer;
    try {
      sigBuf = Buffer.from(signatureB64, "base64");
    } catch {
      return false;
    }
    if (sigBuf.length === 0) return false;

    try {
      return verify(
        null,
        Buffer.from(payload),
        { key: publicKeyPem, format: "pem", type: "spki" },
        sigBuf
      );
    } catch {
      try {
        return verify(
          "sha256",
          Buffer.from(payload),
          { key: publicKeyPem, format: "pem", type: "spki" },
          sigBuf
        );
      } catch {
        // Fail closed: never accept bare hex hashes as valid (C-1 / C-4)
        return false;
      }
    }
  }

  static serializeForSigning(identity: AgentIdentity): string {
    const { signature: _, ...fields } = identity;
    return JSON.stringify(canonicalize(fields));
  }
}
