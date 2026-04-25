import { generateKeyPairSync } from "node:crypto";
import { AgentIdentityManager } from "../../src/identity/manager.js";
import type { CreateIdentityInput } from "../../src/identity/manager.js";

// RSA keys work with sign("sha256", ...) used by the manager.
// Ed25519 keys from generateKeyPair() fall back to hash-based signing
// which cannot be verified in the current implementation.
function makeRSAKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function makeInput(overrides?: Partial<CreateIdentityInput>): CreateIdentityInput {
  return {
    name: "test-agent",
    version: "1.0.0",
    operator: "test-operator",
    description: "A test agent",
    capabilities: ["file:read"],
    covenants: [],
    endpoints: [{ protocol: "https", url: "https://localhost:8080" }],
    maxTrustTier: "standard",
    defaultRing: 2,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe("AgentIdentityManager", () => {
  let privateKey: string;

  beforeEach(() => {
    const pair = makeRSAKeyPair();
    privateKey = pair.privateKey;
  });

  it("creates an identity with required fields", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);

    expect(identity.agentId).toBeDefined();
    expect(identity.name).toBe("test-agent");
    expect(identity.version).toBe("1.0.0");
    expect(identity.operator).toBe("test-operator");
    expect(identity.description).toBe("A test agent");
    expect(identity.capabilities).toEqual(["file:read"]);
    expect(identity.publicKey).toBeDefined();
    expect(identity.publicKey.length).toBeGreaterThan(0);
    expect(identity.signature).toBeDefined();
    expect(identity.signature.length).toBeGreaterThan(0);
    expect(identity.createdAt).toBeDefined();
    expect(identity.expiresAt).toBeDefined();
  });

  it("identity with future expiration is not expired", () => {
    const identity = AgentIdentityManager.create(
      makeInput({ expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      privateKey
    );

    expect(identity.expiresAt).toBeDefined();
    expect(AgentIdentityManager.isExpired(identity)).toBe(false);
  });

  it("expired identity is detected", () => {
    const identity = AgentIdentityManager.create(
      makeInput({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      privateKey
    );

    expect(AgentIdentityManager.isExpired(identity)).toBe(true);
  });

  it("verifies valid identity", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);

    const result = AgentIdentityManager.verify(identity);
    expect(result).toBe(true);
  });

  it("rejects tampered identity", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);

    identity.name = "hacked";
    const result = AgentIdentityManager.verify(identity);
    expect(result).toBe(false);
  });

  it("rejects tampered capabilities", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);

    identity.capabilities = ["admin:*"];
    const result = AgentIdentityManager.verify(identity);
    expect(result).toBe(false);
  });

  it("compact form retains only selected fields", () => {
    const identity = AgentIdentityManager.create(
      makeInput({ name: "compact-test" }),
      privateKey
    );

    const compact = AgentIdentityManager.toCompact(identity);
    expect(compact.agentId).toBe(identity.agentId);
    expect(compact.name).toBe(identity.name);
    expect(compact.publicKey).toBe(identity.publicKey);
    expect(compact.capabilities).toEqual(identity.capabilities);
    expect(compact.expiresAt).toBe(identity.expiresAt);
    expect(compact.signature).toBe(identity.signature);
    // Compact should not include operator, version, description, etc.
    expect((compact as any).operator).toBeUndefined();
    expect((compact as any).version).toBeUndefined();
    expect((compact as any).description).toBeUndefined();
  });

  it("generates unique IDs for different identities", () => {
    const id1 = AgentIdentityManager.create(makeInput({ name: "alpha" }), privateKey);
    const id2 = AgentIdentityManager.create(makeInput({ name: "beta" }), privateKey);
    expect(id1.agentId).not.toBe(id2.agentId);
  });

  it("generateKeyPair produces PEM-formatted keys", () => {
    const pair = AgentIdentityManager.generateKeyPair();
    expect(pair.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(pair.privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("identity without public key fails verification", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    identity.publicKey = "";
    expect(AgentIdentityManager.verify(identity)).toBe(false);
  });

  it("identity without signature fails verification", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    identity.signature = "";
    expect(AgentIdentityManager.verify(identity)).toBe(false);
  });

  it("identity signed with one key fails verification with another", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);

    // Replace the public key with a different one
    const otherPair = makeRSAKeyPair();
    identity.publicKey = otherPair.publicKey;
    expect(AgentIdentityManager.verify(identity)).toBe(false);
  });
});
