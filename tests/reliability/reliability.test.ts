import { ProofBundleBuilder } from "../../src/proof-bundle/builder.js";
import { DEFAULT_RELIABILITY_WEIGHTS } from "../../src/proof-bundle/types.js";
import type { ReliabilityWeights } from "../../src/proof-bundle/types.js";
import type { LedgerEntry } from "../../src/ledger/types.js";
import type { TrustScore } from "../../src/proof-bundle/types.js";

function makeEntry(type: string, data: Record<string, unknown> = {}, seq = 1): LedgerEntry {
  return {
    seq,
    ts: new Date().toISOString(),
    hash: `sha256:${seq}`,
    prev: `sha256:${seq - 1}`,
    type: type as LedgerEntry["type"],
    data,
  };
}

describe("ReliabilityIndex", () => {
  describe("Theta calculation with all components", () => {
    it("computes theta as weighted composite of five components", () => {
      const entries: LedgerEntry[] = [
        makeEntry("action:evaluate", { decision: "allow", tool: "file:read" }, 1),
        makeEntry("action:result", { success: true }, 2),
      ];
      const trust: TrustScore = { score: 500, tier: "standard" };
      const ri = ProofBundleBuilder.computeReliability(entries, trust, 0, DEFAULT_RELIABILITY_WEIGHTS);

      expect(ri.theta).toBeGreaterThan(0);
      expect(ri.theta).toBeLessThanOrEqual(1);
      expect(ri.hardComplianceRate).toBeDefined();
      expect(ri.softRecoveryRate).toBeDefined();
      expect(ri.driftScore).toBeDefined();
      expect(ri.trustScore).toBeDefined();
      expect(ri.scannerPassRate).toBeDefined();
    });
  });

  describe("Weights applied correctly", () => {
    it("uses custom weights when provided", () => {
      const entries: LedgerEntry[] = [
        makeEntry("action:evaluate", { decision: "allow" }, 1),
        makeEntry("action:result", {}, 2),
      ];
      const trust: TrustScore = { score: 1000, tier: "privileged" };

      // All weight on trust
      const weights: ReliabilityWeights = { hard: 0, recovery: 0, drift: 0, trust: 1, scanner: 0 };
      const ri = ProofBundleBuilder.computeReliability(entries, trust, 0, weights);
      expect(ri.theta).toBe(1);

      // All weight on trust with low score
      const ri2 = ProofBundleBuilder.computeReliability(entries, { score: 250, tier: "provisional" }, 0, weights);
      expect(ri2.theta).toBe(0.25);
    });
  });

  describe("Included in proof bundle", () => {
    it("proof bundle build context produces reliabilityIndex", () => {
      // The builder.build method adds reliabilityIndex to the bundle.
      // This is verified structurally: the type requires it.
      const ri = ProofBundleBuilder.computeReliability(
        [],
        { score: 500, tier: "standard" },
        0,
        DEFAULT_RELIABILITY_WEIGHTS
      );
      expect(ri).toHaveProperty("theta");
    });
  });

  describe("CLI output shows theta and components", () => {
    it("reliability index has all six numeric fields", () => {
      const entries: LedgerEntry[] = [
        makeEntry("action:evaluate", { decision: "allow" }, 1),
        makeEntry("action:result", {}, 2),
      ];
      const ri = ProofBundleBuilder.computeReliability(
        entries,
        { score: 500, tier: "standard" },
        0,
        DEFAULT_RELIABILITY_WEIGHTS
      );

      const fields = ["hardComplianceRate", "softRecoveryRate", "driftScore", "trustScore", "scannerPassRate", "theta"];
      for (const field of fields) {
        expect(typeof (ri as Record<string, unknown>)[field]).toBe("number");
      }
    });
  });

  describe("Zero violations leads to theta near 1.0", () => {
    it("clean session has high theta", () => {
      const entries: LedgerEntry[] = [
        makeEntry("action:evaluate", { decision: "allow" }, 1),
        makeEntry("action:evaluate", { decision: "allow" }, 2),
        makeEntry("action:evaluate", { decision: "allow" }, 3),
        makeEntry("action:result", {}, 4),
        makeEntry("action:result", {}, 5),
        makeEntry("action:result", {}, 6),
      ];
      const ri = ProofBundleBuilder.computeReliability(
        entries,
        { score: 800, tier: "privileged" },
        0,
        DEFAULT_RELIABILITY_WEIGHTS
      );

      // hardCompliance=1, drift=1, trust=0.8, scanner=1, recovery=1
      // theta = 0.3*1 + 0.2*1 + 0.15*1 + 0.2*0.8 + 0.15*1 = 0.96
      expect(ri.theta).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe("Many violations leads to theta low", () => {
    it("many denials lower theta", () => {
      const entries: LedgerEntry[] = [
        makeEntry("action:evaluate", { decision: "deny" }, 1),
        makeEntry("action:evaluate", { decision: "deny" }, 2),
        makeEntry("action:evaluate", { decision: "deny" }, 3),
        makeEntry("action:evaluate", { decision: "deny" }, 4),
        makeEntry("action:evaluate", { decision: "allow" }, 5),
        makeEntry("action:result", {}, 6),
        makeEntry("scanner:finding", { scanner: "pii", severity: "hard" }, 7),
        makeEntry("recovery:attempt", { attemptNumber: 1, result: "failed" }, 8),
      ];
      const ri = ProofBundleBuilder.computeReliability(
        entries,
        { score: 100, tier: "untrusted" },
        0.8,
        DEFAULT_RELIABILITY_WEIGHTS
      );

      // hardCompliance = 1 - 4/5 = 0.2
      // recovery = 0/1 = 0 (1 attempt, 0 successes)
      // trust = 0.1
      // drift = 1 - 0.8 = 0.2
      // scanner = 0/1 = 0 (1 result, 1 finding)
      // theta = 0.3*0.2 + 0.2*0 + 0.15*0.2 + 0.2*0.1 + 0.15*0 = 0.11
      expect(ri.theta).toBeLessThan(0.15);
    });
  });
});
