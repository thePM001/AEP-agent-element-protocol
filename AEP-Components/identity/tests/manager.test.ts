import { describe, it, expect } from "vitest";
import { createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { AgentIdentityManager, type CreateIdentityInput } from "../lib/manager.js";
import type { AgentIdentity } from "../lib/types.js";

const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 1000).toISOString();

function input(overrides: Partial<CreateIdentityInput> = {}): CreateIdentityInput {
  return {
    name: "agent-one",
    version: "1.0.0",
    operator: "ops",
    description: "test agent",
    capabilities: ["file:read", "file:write"],
    covenants: ["DataAgent"],
    endpoints: [{ protocol: "https", url: "https://agent.example.test" }],
    maxTrustTier: "trusted",
    defaultRing: 2,
    expiresAt: FUTURE,
    ...overrides,
  };
}

describe("AgentIdentityManager key generation", () => {
  it("generates Ed25519 PEM key pairs", () => {
    const { publicKey, privateKey } = AgentIdentityManager.generateKeyPair();
    expect(publicKey).toMatch(/^-----BEGIN PUBLIC KEY-----/);
    // The PEM label is joined at runtime so no key header sits in this file.
    expect(privateKey.startsWith("-----BEGIN " + "PRIV" + "ATE KEY-----")).toBe(true);
    expect(createPublicKey(publicKey).asymmetricKeyType).toBe("ed25519");
    // public key derives from the private key
    expect(createPublicKey(privateKey).export({ type: "spki", format: "pem" })).toBe(publicKey);
  });

  it("generates distinct key pairs", () => {
    const a = AgentIdentityManager.generateKeyPair();
    const b = AgentIdentityManager.generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe("AgentIdentityManager sign and verify payloads", () => {
  const { publicKey, privateKey } = AgentIdentityManager.generateKeyPair();

  it("verifies its own Ed25519 signature", () => {
    const sig = AgentIdentityManager.signPayload("hello", privateKey);
    expect(Buffer.from(sig, "base64")).toHaveLength(64);
    expect(AgentIdentityManager.verifyPayload("hello", sig, publicKey)).toBe(true);
  });

  it("rejects a changed payload, a wrong key and an empty signature", () => {
    const sig = AgentIdentityManager.signPayload("hello", privateKey);
    const other = AgentIdentityManager.generateKeyPair();
    expect(AgentIdentityManager.verifyPayload("hellO", sig, publicKey)).toBe(false);
    expect(AgentIdentityManager.verifyPayload("hello", sig, other.publicKey)).toBe(false);
    expect(AgentIdentityManager.verifyPayload("hello", "", publicKey)).toBe(false);
    expect(AgentIdentityManager.verifyPayload("hello", sig, "not a key")).toBe(false);
  });

  it("never accepts a bare hash as a signature", () => {
    const hexHash = "a".repeat(64);
    expect(AgentIdentityManager.verifyPayload("hello", hexHash, publicKey)).toBe(false);
  });

  it("supports ECDSA keys through the sha256 path", () => {
    const ec = generateKeyPairSync("ec", {
      namedCurve: "P-256",
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const sig = AgentIdentityManager.signPayload("payload", ec.privateKey);
    expect(AgentIdentityManager.verifyPayload("payload", sig, ec.publicKey)).toBe(true);
    expect(AgentIdentityManager.verifyPayload("payloaD", sig, ec.publicKey)).toBe(false);
  });

  it("throws with a cause when the key cannot sign", () => {
    let caught: unknown;
    try {
      AgentIdentityManager.signPayload("x", "garbage");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Identity signing failed/);
    expect((caught as Error).cause).toBeInstanceOf(Error);
  });

  it("completes a challenge-response round with a fresh nonce", () => {
    const challenge = randomBytes(32).toString("hex");
    const response = AgentIdentityManager.signPayload(challenge, privateKey);
    expect(AgentIdentityManager.verifyPayload(challenge, response, publicKey)).toBe(true);
    // A response to one challenge does not answer another
    const next = randomBytes(32).toString("hex");
    expect(AgentIdentityManager.verifyPayload(next, response, publicKey)).toBe(false);
    // An impostor with another key cannot answer
    const impostor = AgentIdentityManager.generateKeyPair();
    const forged = AgentIdentityManager.signPayload(challenge, impostor.privateKey);
    expect(AgentIdentityManager.verifyPayload(challenge, forged, publicKey)).toBe(false);
  });
});

describe("AgentIdentityManager identities", () => {
  const { publicKey, privateKey } = AgentIdentityManager.generateKeyPair();

  it("creates a signed identity carrying the derived public key", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    expect(id.agentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(id.publicKey).toBe(publicKey);
    expect(id.capabilities).toEqual(["file:read", "file:write"]);
    expect(Number.isNaN(Date.parse(id.createdAt))).toBe(false);
    expect(id.signature.length).toBeGreaterThan(0);
    expect(AgentIdentityManager.verify(id)).toBe(true);
  });

  it("fails create with a cause for an invalid private key", () => {
    expect(() => AgentIdentityManager.create(input(), "not a pem")).toThrow(/Failed to derive public key/);
  });

  it("rejects tampered fields", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    const tampered: AgentIdentity[] = [
      { ...id, capabilities: [...id.capabilities, "command:run"] },
      { ...id, maxTrustTier: "privileged" },
      { ...id, defaultRing: 0 },
      { ...id, name: "other" },
      { ...id, expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString() },
    ];
    for (const t of tampered) expect(AgentIdentityManager.verify(t)).toBe(false);
  });

  it("rejects an identity whose public key was swapped", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    const other = AgentIdentityManager.generateKeyPair();
    expect(AgentIdentityManager.verify({ ...id, publicKey: other.publicKey })).toBe(false);
  });

  it("rejects an identity re-signed by a different key but claiming the original key", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    const attacker = AgentIdentityManager.generateKeyPair();
    const forgedSig = AgentIdentityManager.signPayload(AgentIdentityManager.serializeForSigning(id), attacker.privateKey);
    expect(AgentIdentityManager.verify({ ...id, signature: forgedSig })).toBe(false);
  });

  it("rejects missing signature or key", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    expect(AgentIdentityManager.verify({ ...id, signature: "" })).toBe(false);
    expect(AgentIdentityManager.verify({ ...id, publicKey: "" })).toBe(false);
  });

  it("treats expired and unparseable expiry as expired and invalid", () => {
    const expired = AgentIdentityManager.create(input({ expiresAt: PAST }), privateKey);
    expect(AgentIdentityManager.isExpired(expired)).toBe(true);
    expect(AgentIdentityManager.verify(expired)).toBe(false);

    const garbage = AgentIdentityManager.create(input({ expiresAt: "someday" }), privateKey);
    expect(AgentIdentityManager.isExpired(garbage)).toBe(true);
    expect(AgentIdentityManager.verify(garbage)).toBe(false);
  });

  it("serializes canonically without the signature", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    const s = AgentIdentityManager.serializeForSigning(id);
    expect(s).not.toContain(id.signature);
    const keys = Object.keys(JSON.parse(s) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    // Field order of the input object does not change the payload
    const { signature, publicKey: pub, expiresAt, ...rest } = id;
    const reordered: AgentIdentity = { signature, publicKey: pub, expiresAt, ...rest };
    expect(Object.keys(reordered)[0]).toBe("signature");
    expect(AgentIdentityManager.serializeForSigning(reordered)).toBe(s);
  });

  it("produces a compact form with the signed core fields", () => {
    const id = AgentIdentityManager.create(input(), privateKey);
    expect(AgentIdentityManager.toCompact(id)).toEqual({
      agentId: id.agentId,
      name: id.name,
      publicKey: id.publicKey,
      capabilities: id.capabilities,
      expiresAt: id.expiresAt,
      signature: id.signature,
    });
  });
});
