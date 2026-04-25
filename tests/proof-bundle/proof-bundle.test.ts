import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { ProofBundleBuilder } from "../../src/proof-bundle/builder.js";
import { ProofBundleVerifier } from "../../src/proof-bundle/verifier.js";
import type { ProofBundle } from "../../src/proof-bundle/types.js";
import { AgentIdentityManager } from "../../src/identity/manager.js";
import { EvidenceLedger } from "../../src/ledger/ledger.js";
import type { AgentIdentity } from "../../src/identity/types.js";
import type { CovenantSpec } from "../../src/covenant/types.js";
import type { SessionReport } from "../../src/session/session.js";

const TEST_DIR = join(process.cwd(), "test-tmp-bundle-" + randomUUID().slice(0, 8));

// RSA keys work with sign("sha256", ...) used by AgentIdentityManager.
// Ed25519 keys from generateKeyPair() need null algorithm which the
// identity manager doesn't support yet.
function makeRSAKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function makeTestAgent(keys: { publicKey: string; privateKey: string }): AgentIdentity {
  return AgentIdentityManager.create(
    {
      name: "test-agent",
      version: "1.0",
      operator: "test-operator",
      description: "A test agent",
      capabilities: ["file:read", "file:write"],
      covenants: ["test-covenant"],
      endpoints: [],
      maxTrustTier: "trusted",
      defaultRing: 2,
      expiresAt: new Date(Date.now() + 86400000).toISOString(), // +1 day
    },
    keys.privateKey
  );
}

function makeExpiredAgent(keys: { publicKey: string; privateKey: string }): AgentIdentity {
  return AgentIdentityManager.create(
    {
      name: "expired-agent",
      version: "1.0",
      operator: "test-operator",
      description: "An expired agent",
      capabilities: [],
      covenants: [],
      endpoints: [],
      maxTrustTier: "standard",
      defaultRing: 2,
      expiresAt: new Date(Date.now() - 86400000).toISOString(), // -1 day (expired)
    },
    keys.privateKey
  );
}

function makeReport(): SessionReport {
  return {
    sessionId: randomUUID(),
    duration: 5000,
    totalActions: 10,
    allowed: 8,
    denied: 1,
    gated: 1,
    terminationReason: "completed",
  };
}

function makeCovenant(): CovenantSpec {
  return {
    name: "test-covenant",
    rules: [
      { type: "permit", action: "file:read", conditions: [] },
      { type: "forbid", action: "file:delete", conditions: [] },
    ],
  };
}

describe("ProofBundleBuilder", () => {
  let keys: { publicKey: string; privateKey: string };
  let ledgerDir: string;

  beforeAll(() => {
    keys = makeRSAKeyPair();
    ledgerDir = join(TEST_DIR, "ledgers");
    mkdirSync(ledgerDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("creates a bundle with all required fields", () => {
    const sessionId = randomUUID();
    const ledger = new EvidenceLedger({ dir: ledgerDir, sessionId });
    ledger.append("session:start", { sessionId });
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });

    const builder = new ProofBundleBuilder();
    const bundle = builder.build(
      {
        sessionReport: makeReport(),
        agent: makeTestAgent(keys),
        covenant: makeCovenant(),
        trustScore: { score: 600, tier: "trusted" },
        ring: 2,
        driftScore: 0.1,
        ledger,
      },
      keys.privateKey
    );

    expect(bundle.bundleId).toBeDefined();
    expect(bundle.version).toBe("2.5");
    expect(bundle.createdAt).toBeDefined();
    expect(bundle.agent.name).toBe("test-agent");
    expect(bundle.covenant).not.toBeNull();
    expect(bundle.sessionReport.totalActions).toBe(10);
    expect(bundle.merkleRoot).toBeDefined();
    expect(bundle.merkleRoot.length).toBe(64);
    expect(bundle.entryCount).toBe(2);
    expect(bundle.trustScore.score).toBe(600);
    expect(bundle.trustScore.tier).toBe("trusted");
    expect(bundle.ring).toBe(2);
    expect(bundle.driftScore).toBe(0.1);
    expect(bundle.ledgerHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bundle.signature).toBeDefined();
    expect(bundle.signature.length).toBeGreaterThan(0);
  });

  it("writes and reads bundle from file", () => {
    const sessionId = randomUUID();
    const ledger = new EvidenceLedger({ dir: ledgerDir, sessionId });
    ledger.append("session:start", { sessionId });

    const builder = new ProofBundleBuilder();
    const bundle = builder.build(
      {
        sessionReport: makeReport(),
        agent: makeTestAgent(keys),
        covenant: null,
        trustScore: { score: 500, tier: "standard" },
        ring: 2,
        driftScore: 0,
        ledger,
      },
      keys.privateKey
    );

    const filePath = join(TEST_DIR, "test-bundle.aep-proof.json");
    builder.toFile(bundle, filePath);
    const loaded = builder.fromFile(filePath);

    expect(loaded.bundleId).toBe(bundle.bundleId);
    expect(loaded.version).toBe(bundle.version);
    expect(loaded.merkleRoot).toBe(bundle.merkleRoot);
    expect(loaded.ledgerHash).toBe(bundle.ledgerHash);
    expect(loaded.signature).toBe(bundle.signature);
  });

  it("includes task tree when provided", () => {
    const sessionId = randomUUID();
    const ledger = new EvidenceLedger({ dir: ledgerDir, sessionId });
    ledger.append("session:start", { sessionId });

    const builder = new ProofBundleBuilder();
    const taskTree = {
      rootTaskId: "task-root",
      nodes: {},
      sessionId,
    };

    const bundle = builder.build(
      {
        sessionReport: makeReport(),
        agent: makeTestAgent(keys),
        covenant: null,
        trustScore: { score: 500, tier: "standard" },
        ring: 2,
        driftScore: 0,
        ledger,
        taskTree,
      },
      keys.privateKey
    );

    expect(bundle.taskTree).not.toBeNull();
    expect(bundle.taskTree?.rootTaskId).toBe("task-root");
  });
});

describe("ProofBundleVerifier", () => {
  let keys: { publicKey: string; privateKey: string };
  let ledgerDir: string;

  beforeAll(() => {
    keys = makeRSAKeyPair();
    ledgerDir = join(TEST_DIR, "verify-ledgers");
    mkdirSync(ledgerDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  function buildBundle(
    overrides?: Partial<{
      agent: AgentIdentity;
      sessionId: string;
    }>
  ): { bundle: ProofBundle; ledgerPath: string } {
    const sessionId = overrides?.sessionId ?? randomUUID();
    const ledger = new EvidenceLedger({ dir: ledgerDir, sessionId });
    ledger.append("session:start", { sessionId });
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    ledger.append("action:evaluate", { tool: "file:write", decision: "allow" });

    const agent = overrides?.agent ?? makeTestAgent(keys);
    const builder = new ProofBundleBuilder();
    const bundle = builder.build(
      {
        sessionReport: makeReport(),
        agent,
        covenant: makeCovenant(),
        trustScore: { score: 700, tier: "trusted" },
        ring: 1,
        driftScore: 0.05,
        ledger,
      },
      keys.privateKey
    );

    return { bundle, ledgerPath: join(ledgerDir, `${sessionId}.jsonl`) };
  }

  it("verifies a valid bundle signature", () => {
    const { bundle } = buildBundle();
    const verifier = new ProofBundleVerifier();
    const result = verifier.verify(bundle);

    expect(result.signatureValid).toBe(true);
    expect(result.identityValid).toBe(true);
    expect(result.covenantValid).toBe(true);
    expect(result.identityExpired).toBe(false);
    expect(result.valid).toBe(true);
  });

  it("detects tampered bundle", () => {
    const { bundle } = buildBundle();
    // Tamper with the bundle
    bundle.driftScore = 0.99;

    const verifier = new ProofBundleVerifier();
    const result = verifier.verify(bundle);

    // Signature should not match the tampered payload
    expect(result.signatureValid).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("verifies bundle with ledger: hash match", () => {
    const { bundle, ledgerPath } = buildBundle();
    const verifier = new ProofBundleVerifier();
    const result = verifier.verifyWithLedger(bundle, ledgerPath);

    expect(result.ledgerHashMatch).toBe(true);
    expect(result.merkleRootMatch).toBe(true);
    expect(result.valid).toBe(true);
  });

  it("detects ledger hash mismatch when ledger is modified", () => {
    const { bundle, ledgerPath } = buildBundle();

    // Tamper with the ledger file (append extra data)
    const existing = readFileSync(ledgerPath, "utf-8");
    writeFileSync(
      ledgerPath,
      existing + '{"tampered":true}\n'
    );

    const verifier = new ProofBundleVerifier();
    const result = verifier.verifyWithLedger(bundle, ledgerPath);

    expect(result.ledgerHashMatch).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("detects Merkle root mismatch", () => {
    const { bundle, ledgerPath } = buildBundle();
    // Change the bundle's merkle root
    const originalSig = bundle.signature;
    bundle.merkleRoot = "0".repeat(64);
    bundle.signature = originalSig; // Keep old sig so it also fails sig check

    const verifier = new ProofBundleVerifier();
    const result = verifier.verifyWithLedger(bundle, ledgerPath);

    expect(result.merkleRootMatch).toBe(false);
    expect(result.valid).toBe(false);
  });

  it("flags expired identity in bundle", () => {
    const expiredAgent = makeExpiredAgent(keys);
    const { bundle } = buildBundle({ agent: expiredAgent });

    const verifier = new ProofBundleVerifier();
    const result = verifier.verify(bundle);

    expect(result.identityExpired).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Agent identity has expired.");
  });

  it("returns null for ledger fields when ledger not provided", () => {
    const { bundle } = buildBundle();
    const verifier = new ProofBundleVerifier();
    const result = verifier.verify(bundle);

    expect(result.ledgerHashMatch).toBeNull();
    expect(result.merkleRootMatch).toBeNull();
  });
});
