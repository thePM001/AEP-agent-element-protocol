import { describe, it, expect } from "vitest";
import { verifyCounterparty, generateProof } from "../lib/handshake.js";
import { createRequirements } from "../lib/requirements.js";
import type { ProofBundle } from "../lib/types.js";
import { AgentIdentityManager } from "../../identity/lib/manager.js";
import type { AgentIdentity } from "../../identity/lib/types.js";
import type { CovenantSpec } from "../../covenant/lib/types.js";
import { MerkleTree } from "../../evidence-ledger/lib/ledger/merkle.js";

const { privateKey } = AgentIdentityManager.generateKeyPair();

function identity(expiresAt = new Date(Date.now() + 3600_000).toISOString()): AgentIdentity {
  return AgentIdentityManager.create(
    {
      name: "peer",
      version: "1.0.0",
      operator: "ops",
      description: "counterparty",
      capabilities: ["file:read"],
      covenants: ["Peer"],
      endpoints: [],
      maxTrustTier: "standard",
      defaultRing: 2,
      expiresAt,
    },
    privateKey,
  );
}

const covenant: CovenantSpec = {
  name: "Peer",
  rules: [
    { type: "permit", action: "file:read", conditions: [] },
    { type: "permit", action: "Data  Export", conditions: [] },
    { type: "forbid", action: "file:delete", conditions: [] },
  ],
};

const LEDGER = ["e0", "e1", "e2", "e3", "e4"];

function provenBundle(id: AgentIdentity, cov: CovenantSpec | null = covenant): ProofBundle {
  const tree = new MerkleTree(LEDGER);
  const base = generateProof(id, cov, tree.getRoot(), LEDGER.length);
  return { ...base, merkleLeaf: "e4", merkleProof: tree.generateProof(4) };
}

describe("generateProof", () => {
  it("builds a bundle with the given fields and a timestamp", () => {
    const id = identity();
    const root = "a".repeat(64);
    const bundle = generateProof(id, null, root, 0);
    expect(bundle).toMatchObject({ identity: id, covenant: null, merkleRoot: root, actionCount: 0 });
    expect(Number.isNaN(Date.parse(bundle.timestamp))).toBe(false);
  });
});

describe("verifyCounterparty success", () => {
  it("verifies an identity with no ledger work", () => {
    const id = identity();
    const r = verifyCounterparty(generateProof(id, null, MerkleTree.hash(""), 0));
    expect(r).toEqual({ verified: true, reasons: ["All verification checks passed."], counterpartyId: id.agentId });
  });

  it("accepts sha256: prefixed roots", () => {
    const id = identity();
    const tree = new MerkleTree(LEDGER);
    const bundle: ProofBundle = {
      ...generateProof(id, null, "sha256:" + tree.getRoot(), LEDGER.length),
      merkleLeaf: "e1",
      merkleProof: tree.generateProof(1),
    };
    expect(verifyCounterparty(bundle).verified).toBe(true);
  });

  it("verifies an inclusion proof, including the odd last leaf", () => {
    expect(verifyCounterparty(provenBundle(identity())).verified).toBe(true);
  });

  it("checks required and forbidden actions with normalisation", () => {
    const reqs = createRequirements(["FILE:READ", "data export"], ["file:delete"]);
    expect(verifyCounterparty(provenBundle(identity()), reqs).verified).toBe(true);
  });
});

describe("verifyCounterparty failures", () => {
  it("rejects a tampered identity", () => {
    const id = identity();
    const bundle = provenBundle({ ...id, capabilities: ["command:run"] });
    expect(verifyCounterparty(bundle)).toEqual({ verified: false, reasons: ["Identity signature verification failed."] });
  });

  it("rejects an expired identity", () => {
    const bundle = provenBundle(identity(new Date(Date.now() - 1000).toISOString()));
    expect(verifyCounterparty(bundle).verified).toBe(false);
  });

  it("rejects missing or malformed merkle roots", () => {
    const id = identity();
    expect(verifyCounterparty(generateProof(id, null, "", 0)).reasons).toEqual(["Merkle root is missing or malformed."]);
    expect(verifyCounterparty(generateProof(id, null, "not-hex", 0)).reasons).toEqual([
      "Merkle root must be 64-char hex or sha256:<hex>.",
    ]);
  });

  it("requires leaf and proof when actionCount claims work", () => {
    const id = identity();
    const root = new MerkleTree(LEDGER).getRoot();
    expect(verifyCounterparty(generateProof(id, null, root, 3)).reasons).toEqual([
      "merkleLeaf required when actionCount > 0.",
    ]);
    expect(verifyCounterparty({ ...generateProof(id, null, root, 3), merkleLeaf: "e1", merkleProof: [] }).reasons).toEqual([
      "merkleProof required when actionCount > 0.",
    ]);
  });

  it("rejects malformed proof steps", () => {
    const bundle = { ...provenBundle(identity()), merkleProof: ["X:" + "a".repeat(64)] };
    expect(verifyCounterparty(bundle).reasons).toEqual(["merkleProof steps must be L:<64hex> or R:<64hex>."]);
  });

  it("rejects a proof for a leaf that is not in the ledger", () => {
    const bundle = { ...provenBundle(identity()), merkleLeaf: "forged entry" };
    expect(verifyCounterparty(bundle).reasons).toEqual(["Merkle inclusion proof does not verify against merkleRoot."]);
  });

  it("fails closed when requirements exist but the peer has no covenant", () => {
    const r = verifyCounterparty(provenBundle(identity(), null), createRequirements(["file:read"]));
    expect(r.verified).toBe(false);
    expect(r.reasons[0]).toMatch(/no covenant/);
  });

  it("lists every missing required action and every permitted forbidden action", () => {
    const reqs = createRequirements(["net:fetch", "db:write"], ["file:read", "file:delete"]);
    const r = verifyCounterparty(provenBundle(identity()), reqs);
    expect(r.verified).toBe(false);
    expect(r.reasons).toEqual([
      "Counterparty covenant does not permit required action: net:fetch",
      "Counterparty covenant does not permit required action: db:write",
      "Counterparty covenant permits forbidden action: file:read",
    ]);
  });
});

describe("createRequirements", () => {
  it("defaults to empty lists", () => {
    expect(createRequirements()).toEqual({ requiredActions: [], forbiddenActions: [] });
  });
});
