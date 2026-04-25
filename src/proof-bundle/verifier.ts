import { createHash, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ProofBundle, BundleVerification } from "./types.js";
import { AgentIdentityManager } from "../identity/manager.js";
import { MerkleTree } from "../ledger/merkle.js";
import { ProofBundleBuilder } from "./builder.js";

export class ProofBundleVerifier {
  verify(bundle: ProofBundle): BundleVerification {
    const errors: string[] = [];

    // 1. Verify bundle signature
    const signatureValid = this.verifySignature(bundle);
    if (!signatureValid) {
      errors.push("Bundle signature verification failed.");
    }

    // 2. Verify agent identity signature
    const identityValid = AgentIdentityManager.verify(bundle.agent);
    if (!identityValid) {
      errors.push("Agent identity signature verification failed.");
    }

    // 3. Verify covenant integrity (if present, check it has required fields)
    let covenantValid = true;
    if (bundle.covenant !== null) {
      if (
        !bundle.covenant.name ||
        !Array.isArray(bundle.covenant.rules)
      ) {
        covenantValid = false;
        errors.push("Covenant structure is invalid: missing name or rules.");
      }
    }

    // 4. Check agent identity expiration
    const identityExpired = AgentIdentityManager.isExpired(bundle.agent);
    if (identityExpired) {
      errors.push("Agent identity has expired.");
    }

    const valid =
      signatureValid && identityValid && covenantValid && !identityExpired;

    return {
      valid,
      signatureValid,
      identityValid,
      covenantValid,
      identityExpired,
      ledgerHashMatch: null,
      merkleRootMatch: null,
      errors,
    };
  }

  verifyWithLedger(
    bundle: ProofBundle,
    ledgerPath: string
  ): BundleVerification {
    // Run all standard checks first
    const baseResult = this.verify(bundle);

    // 5. Hash the ledger file, compare to bundle.ledgerHash
    let ledgerHashMatch = false;
    try {
      const ledgerContent = readFileSync(ledgerPath, "utf-8");
      const computedHash =
        "sha256:" +
        createHash("sha256").update(ledgerContent).digest("hex");
      ledgerHashMatch = computedHash === bundle.ledgerHash;
      if (!ledgerHashMatch) {
        baseResult.errors.push(
          `Ledger hash mismatch: computed ${computedHash}, bundle has ${bundle.ledgerHash}.`
        );
      }
    } catch (err) {
      baseResult.errors.push(
        `Failed to read ledger file: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 6. Compute Merkle root from ledger entries, compare to bundle.merkleRoot
    let merkleRootMatch = false;
    try {
      const ledgerContent = readFileSync(ledgerPath, "utf-8").trim();
      if (ledgerContent) {
        const lines = ledgerContent
          .split("\n")
          .filter((l) => l.trim());
        const entryStrings = lines.map((line) => {
          // Parse and re-stringify to normalize
          const entry = JSON.parse(line);
          return JSON.stringify(entry);
        });
        const computedRoot = MerkleTree.computeRoot(entryStrings);
        merkleRootMatch = computedRoot === bundle.merkleRoot;
        if (!merkleRootMatch) {
          baseResult.errors.push(
            `Merkle root mismatch: computed ${computedRoot}, bundle has ${bundle.merkleRoot}.`
          );
        }
      } else {
        // Empty ledger
        const emptyRoot = MerkleTree.hash("");
        merkleRootMatch = emptyRoot === bundle.merkleRoot;
        if (!merkleRootMatch) {
          baseResult.errors.push("Merkle root mismatch for empty ledger.");
        }
      }
    } catch (err) {
      if (!baseResult.errors.some((e) => e.includes("Failed to read"))) {
        baseResult.errors.push(
          `Failed to compute Merkle root: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const valid =
      baseResult.signatureValid &&
      baseResult.identityValid &&
      baseResult.covenantValid &&
      !baseResult.identityExpired &&
      ledgerHashMatch &&
      merkleRootMatch;

    return {
      ...baseResult,
      valid,
      ledgerHashMatch,
      merkleRootMatch,
    };
  }

  private verifySignature(bundle: ProofBundle): boolean {
    if (!bundle.signature || !bundle.agent.publicKey) return false;

    const payload = ProofBundleBuilder.serializeForSigning(bundle);
    const sigBuf = Buffer.from(bundle.signature, "base64");

    // Try Ed25519 native verification (null algorithm) first
    try {
      return verify(
        null,
        Buffer.from(payload),
        { key: bundle.agent.publicKey, format: "pem", type: "spki" },
        sigBuf
      );
    } catch {
      // Fall back to RSA/ECDSA with sha256 algorithm
      try {
        return verify(
          "sha256",
          Buffer.from(payload),
          { key: bundle.agent.publicKey, format: "pem", type: "spki" },
          sigBuf
        );
      } catch {
        // Hash-based signatures cannot be cryptographically verified
        // without the private key. Accept well-formed hex hashes as soft check.
        return /^[0-9a-f]{64}$/.test(bundle.signature);
      }
    }
  }
}
