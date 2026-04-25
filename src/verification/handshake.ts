import { AgentIdentityManager } from "../identity/manager.js";
import type { ProofBundle, HandshakeResult, CovenantRequirement } from "./types.js";

export function verifyCounterparty(
  proof: ProofBundle,
  requirements?: CovenantRequirement
): HandshakeResult {
  const reasons: string[] = [];

  // 1. Verify identity signature
  if (!AgentIdentityManager.verify(proof.identity)) {
    return { verified: false, reasons: ["Identity signature verification failed."] };
  }

  // 2. Check expiration
  if (AgentIdentityManager.isExpired(proof.identity)) {
    return { verified: false, reasons: ["Agent identity has expired."] };
  }

  // 3. Verify Merkle root format
  if (!proof.merkleRoot || typeof proof.merkleRoot !== "string") {
    return { verified: false, reasons: ["Merkle root is missing or malformed."] };
  }

  // 4. Check covenant requirements if specified
  if (requirements && proof.covenant) {
    for (const required of requirements.requiredActions) {
      const hasPermit = proof.covenant.rules.some(
        r => r.type === "permit" && r.action === required
      );
      if (!hasPermit) {
        reasons.push(`Counterparty covenant does not permit required action: ${required}`);
      }
    }

    for (const forbidden of requirements.forbiddenActions) {
      const hasForbid = proof.covenant.rules.some(
        r => r.type === "forbid" && r.action === forbidden
      );
      if (!hasForbid) {
        reasons.push(`Counterparty covenant does not explicitly forbid: ${forbidden}`);
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
