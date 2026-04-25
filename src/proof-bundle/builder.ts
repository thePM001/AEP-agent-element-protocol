import { createHash, sign, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { ProofBundle, TrustScore, ReliabilityIndex, ReliabilityWeights } from "./types.js";
import { DEFAULT_RELIABILITY_WEIGHTS } from "./types.js";
import type { AgentIdentity } from "../identity/types.js";
import type { CovenantSpec } from "../covenant/types.js";
import type { SessionReport } from "../session/session.js";
import type { ExecutionRing } from "../rings/types.js";
import type { TaskTree } from "../decomposition/types.js";
import { MerkleTree } from "../ledger/merkle.js";
import { EvidenceLedger } from "../ledger/ledger.js";

export interface ProofBundleBuildContext {
  sessionReport: SessionReport;
  agent: AgentIdentity;
  covenant: CovenantSpec | null;
  trustScore: TrustScore;
  ring: ExecutionRing;
  driftScore: number;
  ledger: EvidenceLedger;
  taskTree?: TaskTree | null;
  reliabilityWeights?: ReliabilityWeights;
}

export class ProofBundleBuilder {
  build(context: ProofBundleBuildContext, privateKey: string): ProofBundle {
    const entries = context.ledger.entries();
    const entryStrings = entries.map((e) => JSON.stringify(e));

    // Compute Merkle root from all ledger entries
    const merkleRoot =
      entryStrings.length > 0
        ? MerkleTree.computeRoot(entryStrings)
        : MerkleTree.hash("");

    // Compute SHA-256 of the full JSONL ledger content
    const ledgerContent = entryStrings.map((s) => s + "\n").join("");
    const ledgerHash =
      "sha256:" +
      createHash("sha256").update(ledgerContent).digest("hex");

    // Compute reliability index
    const reliabilityIndex = ProofBundleBuilder.computeReliability(
      entries,
      context.trustScore,
      context.driftScore,
      context.reliabilityWeights ?? DEFAULT_RELIABILITY_WEIGHTS
    );

    const bundle: ProofBundle = {
      bundleId: randomUUID(),
      version: "2.5",
      createdAt: new Date().toISOString(),
      agent: context.agent,
      covenant: context.covenant,
      sessionReport: context.sessionReport,
      merkleRoot,
      entryCount: entries.length,
      trustScore: context.trustScore,
      ring: context.ring,
      driftScore: context.driftScore,
      ledgerHash,
      signature: "",
      taskTree: context.taskTree ?? null,
      reliabilityIndex,
    };

    // Sign all fields except signature
    const payload = ProofBundleBuilder.serializeForSigning(bundle);
    bundle.signature = ProofBundleBuilder.signPayload(payload, privateKey);

    return bundle;
  }

  toFile(bundle: ProofBundle, path: string): void {
    writeFileSync(path, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
  }

  fromFile(path: string): ProofBundle {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as ProofBundle;
  }

  static computeReliability(
    entries: import("../ledger/types.js").LedgerEntry[],
    trustScore: TrustScore,
    driftScore: number,
    weights: ReliabilityWeights,
    mlScore?: number
  ): ReliabilityIndex {
    // Hard compliance rate: 1 - (hard violations / total evaluations)
    const evaluations = entries.filter((e) => e.type === "action:evaluate");
    const denials = evaluations.filter(
      (e) => (e.data as Record<string, unknown>).decision === "deny"
    );
    const totalEvals = evaluations.length || 1;
    const hardComplianceRate = Math.max(0, Math.min(1, 1 - denials.length / totalEvals));

    // Soft recovery rate: successful recoveries / total recovery attempts
    // If no recovery was needed, rate is 1.0 (perfect)
    const recoveryAttempts = entries.filter((e) => e.type === "recovery:attempt");
    const recoverySuccesses = entries.filter((e) => e.type === "recovery:success");
    const softRecoveryRate = recoveryAttempts.length === 0
      ? 1.0
      : Math.min(1, recoverySuccesses.length / recoveryAttempts.length);

    // Drift score: inverse of max drift (1 - drift, clamped 0-1)
    const driftComponent = Math.max(0, Math.min(1, 1 - driftScore));

    // Trust score: normalised to 0-1
    const trustComponent = Math.max(0, Math.min(1, trustScore.score / 1000));

    // Scanner pass rate: scans without findings / total scans
    const scannerFindings = entries.filter((e) => e.type === "scanner:finding");
    // Estimate total scans from action:result entries (each result implies a scan opportunity)
    const actionResults = entries.filter((e) => e.type === "action:result");
    const totalScans = actionResults.length || 1;
    const cleanScans = Math.max(0, totalScans - scannerFindings.length);
    const scannerPassRate = Math.min(1, cleanScans / totalScans);

    // Weighted composite theta (includes mlScore if provided)
    const mlComponent = mlScore !== undefined ? Math.max(0, Math.min(1, mlScore)) : undefined;
    const mlWeight = mlComponent !== undefined ? (weights.ml ?? 0.20) : 0;

    const theta = Math.max(0, Math.min(1,
      weights.hard * hardComplianceRate +
      weights.recovery * softRecoveryRate +
      weights.drift * driftComponent +
      weights.trust * trustComponent +
      weights.scanner * scannerPassRate +
      mlWeight * (mlComponent ?? 0)
    ));

    const result: ReliabilityIndex = {
      hardComplianceRate: Math.round(hardComplianceRate * 1000) / 1000,
      softRecoveryRate: Math.round(softRecoveryRate * 1000) / 1000,
      driftScore: Math.round(driftComponent * 1000) / 1000,
      trustScore: Math.round(trustComponent * 1000) / 1000,
      scannerPassRate: Math.round(scannerPassRate * 1000) / 1000,
      theta: Math.round(theta * 1000) / 1000,
    };

    if (mlComponent !== undefined) {
      result.mlScore = Math.round(mlComponent * 1000) / 1000;
    }

    return result;
  }

  static serializeForSigning(bundle: ProofBundle): string {
    const { signature: _, ...fields } = bundle;
    return JSON.stringify(fields, Object.keys(fields).sort());
  }

  static signPayload(payload: string, privateKey: string): string {
    // Try Ed25519 native signing (null algorithm) first
    try {
      const sig = sign(null, Buffer.from(payload), {
        key: privateKey,
        format: "pem",
        type: "pkcs8",
      });
      return sig.toString("base64");
    } catch {
      // Fall back to RSA/ECDSA with sha256 algorithm
      try {
        const sig = sign("sha256", Buffer.from(payload), {
          key: privateKey,
          format: "pem",
          type: "pkcs8",
        });
        return sig.toString("base64");
      } catch {
        // Last resort: hash-based signature
        return createHash("sha256")
          .update(payload + privateKey)
          .digest("hex");
      }
    }
  }
}
