// @PAD: p0-v275-h-sec2-handshake-covenant-v1
// @GCDE: document_sha256=p0-v275-sec2-sec36-handshake
import { AgentIdentityManager } from "../../identity/lib/manager.js";
import { MerkleTree } from "../../evidence-ledger/lib/ledger/merkle.js";
import type { ProofBundle, HandshakeResult, CovenantRequirement } from "./types.js";

function normalizeAction(action: string): string {
  return action.trim().replace(/\s+/g, " ").toUpperCase();
}

export function verifyCounterparty(
  proof: ProofBundle,
  requirements?: CovenantRequirement
): HandshakeResult {
  const reasons: string[] = [];

  if (!AgentIdentityManager.verify(proof.identity)) {
    return { verified: false, reasons: ["Identity signature verification failed."] };
  }

  if (AgentIdentityManager.isExpired(proof.identity)) {
    return { verified: false, reasons: ["Agent identity has expired."] };
  }

  if (!proof.merkleRoot || typeof proof.merkleRoot !== "string") {
    return { verified: false, reasons: ["Merkle root is missing or malformed."] };
  }
  // Reject garbage roots: require sha256 hex (64) or sha256:hex form.
  const root = proof.merkleRoot.trim();
  const hex64 = /^[0-9a-f]{64}$/i;
  const shaPrefixed = /^sha256:[0-9a-f]{64}$/i;
  if (!hex64.test(root) && !shaPrefixed.test(root)) {
    return {
      verified: false,
      reasons: ["Merkle root must be 64-char hex or sha256:<hex>."],
    };
  }

  // Require real inclusion proof when actionCount claims ledger work.
  const actionCount = Number(proof.actionCount ?? 0);
  if (Number.isFinite(actionCount) && actionCount > 0) {
    if (!proof.merkleLeaf || typeof proof.merkleLeaf !== "string") {
      return {
        verified: false,
        reasons: ["merkleLeaf required when actionCount > 0."],
      };
    }
    if (!Array.isArray(proof.merkleProof) || proof.merkleProof.length === 0) {
      return {
        verified: false,
        reasons: ["merkleProof required when actionCount > 0."],
      };
    }
    for (const step of proof.merkleProof) {
      if (typeof step !== "string" || !/^[LR]:[0-9a-fA-F]{64}$/.test(step)) {
        return {
          verified: false,
          reasons: ["merkleProof steps must be L:<64hex> or R:<64hex>."],
        };
      }
    }
    const rootNorm = shaPrefixed.test(root) ? root.slice("sha256:".length) : root;
    if (!MerkleTree.verifyProof(proof.merkleLeaf, proof.merkleProof, rootNorm)) {
      return {
        verified: false,
        reasons: ["Merkle inclusion proof does not verify against merkleRoot."],
      };
    }
  }

  // SEC-2 / H-18: fail closed when requirements present but covenant missing
  if (requirements) {
    if (!proof.covenant) {
      return {
        verified: false,
        reasons: ["Counterparty has no covenant but covenant requirements were specified."],
      };
    }

    const rules = proof.covenant.rules ?? [];
    for (const required of requirements.requiredActions ?? []) {
      const need = normalizeAction(required);
      const hasPermit = rules.some(
        (r) =>
          r.type === "permit" &&
          typeof r.action === "string" &&
          normalizeAction(r.action) === need
      );
      if (!hasPermit) {
        reasons.push(`Counterparty covenant does not permit required action: ${required}`);
      }
    }

    // H-17: fail if counterparty PERMITS a forbidden action
    for (const forbidden of requirements.forbiddenActions ?? []) {
      const need = normalizeAction(forbidden);
      const hasPermit = rules.some(
        (r) =>
          r.type === "permit" &&
          typeof r.action === "string" &&
          normalizeAction(r.action) === need
      );
      if (hasPermit) {
        reasons.push("Counterparty covenant permits forbidden action: " + forbidden);
      }
    }

    if (reasons.length > 0) {
      return { verified: false, reasons };
    }
  }

  return {
    verified: true,
    reasons: ["All verification checks passed."],
    counterpartyId: proof.identity.agentId,
  };
}

export function generateProof(
  identity: import("../identity/types.js").AgentIdentity,
  covenant: import("../covenant/types.js").CovenantSpec | null,
  merkleRoot: string,
  actionCount: number
): ProofBundle {
  return {
    identity,
    covenant,
    merkleRoot,
    actionCount,
    timestamp: new Date().toISOString(),
  };
}
