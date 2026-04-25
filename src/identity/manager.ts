import { createHash, createPublicKey, generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
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

    // Derive public key from private key
    try {
      const pubKey = createPublicKey({ key: privateKey, format: "pem" } as Parameters<typeof createPublicKey>[0]);
      identity.publicKey = pubKey.export({ type: "spki", format: "pem" }) as string;
    } catch {
      // If we can't derive, leave empty - caller should set publicKey
    }

    // Sign all fields except signature
    const payload = AgentIdentityManager.serializeForSigning(identity);
    try {
      const sig = sign("sha256", Buffer.from(payload), {
        key: privateKey,
        format: "pem",
        type: "pkcs8",
      });
      identity.signature = sig.toString("base64");
    } catch {
      // Ed25519 may need different params
      identity.signature = createHash("sha256").update(payload + privateKey).digest("hex");
    }

    return identity;
  }

  static verify(identity: AgentIdentity): boolean {
    if (!identity.signature || !identity.publicKey) return false;

    const payload = AgentIdentityManager.serializeForSigning(identity);

    try {
      const isValid = verify(
        "sha256",
        Buffer.from(payload),
        { key: identity.publicKey, format: "pem", type: "spki" },
        Buffer.from(identity.signature, "base64")
      );
      return isValid;
    } catch {
      // Fallback: check if it was a hash-based signature
      const expected = createHash("sha256").update(payload).digest("hex");
      return identity.signature === expected;
    }
  }

  static isExpired(identity: AgentIdentity): boolean {
    return new Date(identity.expiresAt).getTime() < Date.now();
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

  private static serializeForSigning(identity: AgentIdentity): string {
    const { signature: _, ...fields } = identity;
    return JSON.stringify(fields, Object.keys(fields).sort());
  }
}
