import { generateKeyPairSync } from "node:crypto";
import { verifyCounterparty, generateProof } from "../../src/verification/handshake.js";
import { AgentIdentityManager } from "../../src/identity/manager.js";
import { createRequirements } from "../../src/verification/requirements.js";
import type { CreateIdentityInput } from "../../src/identity/manager.js";
import type { CovenantSpec } from "../../src/covenant/types.js";

// RSA keys work with sign("sha256", ...) in the identity manager
function makeRSAKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function makeInput(overrides?: Partial<CreateIdentityInput>): CreateIdentityInput {
  return {
    name: "agent-a",
    version: "1.0.0",
    operator: "op",
    description: "test agent",
    capabilities: ["file:read"],
    covenants: [],
    endpoints: [],
    maxTrustTier: "standard",
    defaultRing: 2,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    ...overrides,
  };
}

describe("Cross-Agent Verification", () => {
  let privateKey: string;

  beforeEach(() => {
    const pair = makeRSAKeyPair();
    privateKey = pair.privateKey;
  });

  it("verifies a valid counterparty", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const proof = generateProof(identity, null, "root-hash-abc", 5);

    const result = verifyCounterparty(proof);
    expect(result.verified).toBe(true);
    expect(result.counterpartyId).toBe(identity.agentId);
  });

  it("rejects tampered counterparty", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const proof = generateProof(identity, null, "root-hash-abc", 5);

    // Tamper with identity after proof generation
    proof.identity.name = "tampered";
    const result = verifyCounterparty(proof);
    expect(result.verified).toBe(false);
    expect(result.reasons).toBeDefined();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("rejects expired counterparty", () => {
    const identity = AgentIdentityManager.create(
      makeInput({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      privateKey
    );
    const proof = generateProof(identity, null, "root-hash-abc", 5);

    const result = verifyCounterparty(proof);
    expect(result.verified).toBe(false);
    expect(result.reasons.some(r => r.toLowerCase().includes("expired"))).toBe(true);
  });

  it("rejects proof with missing merkle root", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const proof = generateProof(identity, null, "root-hash-abc", 5);
    proof.merkleRoot = "";

    const result = verifyCounterparty(proof);
    expect(result.verified).toBe(false);
    expect(result.reasons.some(r => r.toLowerCase().includes("merkle"))).toBe(true);
  });

  it("generateProof builds a complete proof bundle", () => {
    const identity = AgentIdentityManager.create(
      makeInput({ name: "prover" }),
      privateKey
    );

    const proof = generateProof(identity, null, "root-hash-42", 10);
    expect(proof.identity.agentId).toBe(identity.agentId);
    expect(proof.covenant).toBeNull();
    expect(proof.merkleRoot).toBe("root-hash-42");
    expect(proof.actionCount).toBe(10);
    expect(proof.timestamp).toBeDefined();
  });

  it("generateProof includes covenant when provided", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const covenant: CovenantSpec = {
      name: "test-covenant",
      rules: [
        { type: "permit", action: "file:read", conditions: [] },
        { type: "forbid", action: "file:delete", conditions: [] },
      ],
    };

    const proof = generateProof(identity, covenant, "merkle-abc", 3);
    expect(proof.covenant).not.toBeNull();
    expect(proof.covenant!.name).toBe("test-covenant");
    expect(proof.covenant!.rules).toHaveLength(2);
  });

  it("verifies counterparty with matching covenant requirements", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const covenant: CovenantSpec = {
      name: "full-covenant",
      rules: [
        { type: "permit", action: "file:read", conditions: [] },
        { type: "forbid", action: "file:delete", conditions: [] },
      ],
    };
    const proof = generateProof(identity, covenant, "merkle-root", 5);

    const requirements = createRequirements(["file:read"], ["file:delete"]);
    const result = verifyCounterparty(proof, requirements);
    expect(result.verified).toBe(true);
  });

  it("rejects counterparty missing required covenant action", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const covenant: CovenantSpec = {
      name: "limited-covenant",
      rules: [
        { type: "permit", action: "file:read", conditions: [] },
      ],
    };
    const proof = generateProof(identity, covenant, "merkle-root", 5);

    const requirements = createRequirements(["file:write"], []);
    const result = verifyCounterparty(proof, requirements);
    expect(result.verified).toBe(false);
    expect(result.reasons.some(r => r.includes("file:write"))).toBe(true);
  });

  it("rejects counterparty missing required forbidden action", () => {
    const identity = AgentIdentityManager.create(makeInput(), privateKey);
    const covenant: CovenantSpec = {
      name: "no-forbids",
      rules: [
        { type: "permit", action: "file:read", conditions: [] },
      ],
    };
    const proof = generateProof(identity, covenant, "merkle-root", 5);

    const requirements = createRequirements([], ["file:delete"]);
    const result = verifyCounterparty(proof, requirements);
    expect(result.verified).toBe(false);
    expect(result.reasons.some(r => r.includes("file:delete"))).toBe(true);
  });

  it("createRequirements builds requirement object", () => {
    const reqs = createRequirements(["file:read"], ["file:delete"]);
    expect(reqs.requiredActions).toEqual(["file:read"]);
    expect(reqs.forbiddenActions).toEqual(["file:delete"]);
  });

  it("createRequirements defaults to empty arrays", () => {
    const reqs = createRequirements();
    expect(reqs.requiredActions).toEqual([]);
    expect(reqs.forbiddenActions).toEqual([]);
  });
});
