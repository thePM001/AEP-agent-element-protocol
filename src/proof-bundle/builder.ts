import { createHash, sign, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { ProofBundle, TrustScore } from "./types.js";
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

    const bundle: ProofBundle = {
      bundleId: randomUUID(),
      version: "2.2",
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
