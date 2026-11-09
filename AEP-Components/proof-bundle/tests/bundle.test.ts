import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ProofBundleBuilder, type ProofBundleBuildContext } from "../lib/builder.js";
import { ProofBundleVerifier } from "../lib/verifier.js";
import { DEFAULT_RELIABILITY_WEIGHTS, ML_RELIABILITY_WEIGHTS, type ProofBundle } from "../lib/types.js";
import { AgentIdentityManager } from "../../identity/lib/manager.js";
import { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";
import { MerkleTree } from "../../evidence-ledger/lib/ledger/merkle.js";
import type { LedgerEntry } from "../../evidence-ledger/lib/ledger/types.js";

const keys = AgentIdentityManager.generateKeyPair();

function agent(expiresAt = new Date(Date.now() + 3600_000).toISOString()) {
  return AgentIdentityManager.create(
    {
      name: "bundler",
      version: "1.0.0",
      operator: "ops",
      description: "proof bundle test agent",
      capabilities: ["file:read"],
      covenants: [],
      endpoints: [],
      maxTrustTier: "standard",
      defaultRing: 2,
      expiresAt,
    },
    keys.privateKey,
  );
}

describe("ProofBundleBuilder and ProofBundleVerifier", () => {
  let dir: string;
  let ledger: EvidenceLedger;
  let ledgerPath: string;

  function context(overrides: Partial<ProofBundleBuildContext> = {}): ProofBundleBuildContext {
    return {
      sessionReport: {
        sessionId: "sess1",
        duration: 1000,
        totalActions: 3,
        allowed: 2,
        denied: 1,
        gated: 0,
        terminationReason: "done",
      },
      agent: agent(),
      covenant: { name: "C", rules: [{ type: "permit", action: "file:read", conditions: [] }] },
      trustScore: { score: 600, tier: "standard" },
      isolation_class: "sandbox",
      driftScore: 0.1,
      ledger,
      ...overrides,
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    ledger = new EvidenceLedger({ dir, sessionId: "sess1" });
    ledger.append("session:start", {});
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    ledger.append("action:evaluate", { tool: "file:delete", decision: "deny" });
    ledger.append("action:result", { ok: true });
    ledgerPath = join(dir, "sess1.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("builds a signed bundle that verifies with its ledger", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    const entries = ledger.entries().map((e) => JSON.stringify(e));

    expect(bundle.version).toBe("2.9.0");
    expect(bundle.entryCount).toBe(4);
    expect(bundle.merkleRoot).toBe(MerkleTree.computeRoot(entries));
    expect(bundle.ledgerHash).toBe(
      "sha256:" + createHash("sha256").update(readFileSync(ledgerPath, "utf-8")).digest("hex"),
    );
    expect(bundle.taskTree).toBeNull();
    expect(bundle.signature.length).toBeGreaterThan(0);

    const verifier = new ProofBundleVerifier();
    expect(verifier.verify(bundle)).toEqual({
      valid: true,
      signatureValid: true,
      identityValid: true,
      covenantValid: true,
      identityExpired: false,
      ledgerHashMatch: null,
      merkleRootMatch: null,
      errors: [],
    });
    const full = verifier.verifyWithLedger(bundle, ledgerPath);
    expect(full.valid).toBe(true);
    expect(full.ledgerHashMatch).toBe(true);
    expect(full.merkleRootMatch).toBe(true);
  });

  it("round-trips through a file", () => {
    const builder = new ProofBundleBuilder();
    const bundle = builder.build(context(), keys.privateKey);
    const file = join(dir, "bundle.json");
    builder.toFile(bundle, file);
    const loaded = builder.fromFile(file);
    expect(loaded).toEqual(bundle);
    expect(new ProofBundleVerifier().verify(loaded).valid).toBe(true);
  });

  it("detects tampering with any signed field", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    const verifier = new ProofBundleVerifier();
    const tampered: ProofBundle[] = [
      { ...bundle, entryCount: 1 },
      { ...bundle, driftScore: 0 },
      { ...bundle, trustScore: { score: 1000, tier: "privileged" } },
      { ...bundle, sessionReport: { ...bundle.sessionReport, denied: 0 } },
      { ...bundle, merkleRoot: MerkleTree.hash("x") },
    ];
    for (const t of tampered) {
      const r = verifier.verify(t);
      expect(r.valid).toBe(false);
      expect(r.signatureValid).toBe(false);
      expect(r.errors).toContain("Bundle signature verification failed.");
    }
  });

  it("rejects a bundle signed by a key other than the agent's", () => {
    const other = AgentIdentityManager.generateKeyPair();
    const bundle = new ProofBundleBuilder().build(context(), other.privateKey);
    const r = new ProofBundleVerifier().verify(bundle);
    expect(r.signatureValid).toBe(false);
    expect(r.identityValid).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("rejects a missing signature", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    expect(new ProofBundleVerifier().verify({ ...bundle, signature: "" }).signatureValid).toBe(false);
  });

  it("detects a ledger changed after the bundle was built", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    ledger.append("action:evaluate", { decision: "deny" });
    const r = new ProofBundleVerifier().verifyWithLedger(bundle, ledgerPath);
    expect(r.valid).toBe(false);
    expect(r.ledgerHashMatch).toBe(false);
    expect(r.merkleRootMatch).toBe(false);
    expect(r.errors.some((e) => e.startsWith("Ledger hash mismatch"))).toBe(true);
    expect(r.errors.some((e) => e.startsWith("Merkle root mismatch"))).toBe(true);
  });

  it("detects an edited ledger line", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    const lines = readFileSync(ledgerPath, "utf-8").trim().split("\n");
    const parsed = lines.map((l) => JSON.parse(l) as LedgerEntry);
    const target = parsed[2];
    if (target) target.data = { tool: "file:delete", decision: "allow" };
    writeFileSync(ledgerPath, parsed.map((e) => JSON.stringify(e) + "\n").join(""), "utf-8");
    const r = new ProofBundleVerifier().verifyWithLedger(bundle, ledgerPath);
    expect(r.valid).toBe(false);
    expect(r.ledgerHashMatch).toBe(false);
  });

  it("reports an unreadable ledger file", () => {
    const bundle = new ProofBundleBuilder().build(context(), keys.privateKey);
    const r = new ProofBundleVerifier().verifyWithLedger(bundle, join(dir, "missing.jsonl"));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith("Failed to read ledger file"))).toBe(true);
  });

  it("verifies an empty ledger against the empty root", () => {
    const emptyLedger = new EvidenceLedger({ dir, sessionId: "empty" });
    const bundle = new ProofBundleBuilder().build(context({ ledger: emptyLedger }), keys.privateKey);
    expect(bundle.merkleRoot).toBe(MerkleTree.hash(""));
    writeFileSync(join(dir, "empty.jsonl"), "", "utf-8");
    const r = new ProofBundleVerifier().verifyWithLedger(bundle, join(dir, "empty.jsonl"));
    expect(r.valid).toBe(true);
  });

  it("flags an invalid covenant structure and an expired agent", () => {
    const bundle = new ProofBundleBuilder().build(
      context({ agent: agent(new Date(Date.now() - 1000).toISOString()), covenant: { name: "", rules: [] } }),
      keys.privateKey,
    );
    const r = new ProofBundleVerifier().verify(bundle);
    expect(r.covenantValid).toBe(false);
    expect(r.identityExpired).toBe(true);
    expect(r.identityValid).toBe(false);
    expect(r.valid).toBe(false);
  });

  it("throws with a cause when the private key is unusable", () => {
    expect(() => new ProofBundleBuilder().build(context(), "garbage")).toThrow(/Proof bundle signing failed/);
  });
});

describe("ProofBundleBuilder.computeReliability", () => {
  const entry = (type: LedgerEntry["type"], data: Record<string, unknown> = {}): LedgerEntry => ({
    seq: 0,
    ts: "",
    hash: "",
    prev: "",
    type,
    data,
  });

  it("is perfect with no activity and full trust", () => {
    const r = ProofBundleBuilder.computeReliability([], { score: 1000, tier: "x" }, 0, DEFAULT_RELIABILITY_WEIGHTS);
    expect(r).toEqual({
      hardComplianceRate: 1,
      softRecoveryRate: 1,
      driftScore: 1,
      trustScore: 1,
      scannerPassRate: 1,
      theta: 1,
    });
  });

  it("computes each component from ledger entries", () => {
    const entries = [
      entry("action:evaluate", { decision: "allow" }),
      entry("action:evaluate", { decision: "deny" }),
      entry("action:evaluate", { decision: "allow" }),
      entry("action:evaluate", { decision: "deny" }),
      entry("recovery:attempt"),
      entry("recovery:attempt"),
      entry("recovery:success"),
      entry("action:result"),
      entry("action:result"),
      entry("action:result"),
      entry("action:result"),
      entry("scanner:finding"),
    ];
    const r = ProofBundleBuilder.computeReliability(entries, { score: 500, tier: "x" }, 0.25, DEFAULT_RELIABILITY_WEIGHTS);
    expect(r.hardComplianceRate).toBe(0.5);
    expect(r.softRecoveryRate).toBe(0.5);
    expect(r.driftScore).toBe(0.75);
    expect(r.trustScore).toBe(0.5);
    expect(r.scannerPassRate).toBe(0.75);
    // 0.3*0.5 + 0.2*0.5 + 0.15*0.75 + 0.2*0.5 + 0.15*0.75
    expect(r.theta).toBeCloseTo(0.575, 3);
    expect(r.mlScore).toBeUndefined();
  });

  it("clamps out of range inputs and includes the ml score when given", () => {
    const r = ProofBundleBuilder.computeReliability([], { score: 5000, tier: "x" }, 2, ML_RELIABILITY_WEIGHTS, 1.5);
    expect(r.driftScore).toBe(0);
    expect(r.trustScore).toBe(1);
    expect(r.mlScore).toBe(1);
    // 0.25 + 0.15 + 0 + 0.15 + 0.15 + 0.2
    expect(r.theta).toBeCloseTo(0.9, 3);
  });
});
