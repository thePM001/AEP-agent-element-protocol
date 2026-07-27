import type { AgentIdentity } from "../../identity/lib/types.js";
import type { CovenantSpec } from "../../covenant/lib/types.js";

export interface ProofBundle {
  identity: AgentIdentity;
  covenant: CovenantSpec | null;
  merkleRoot: string;
  actionCount: number;
  timestamp: string;
  /** Leaf hashed into the merkle tree (required when actionCount > 0). */
  merkleLeaf?: string;
  /** Inclusion proof steps "L:<hash>" / "R:<hash>" (required when actionCount > 0). */
  merkleProof?: string[];
}

export interface HandshakeResult {
  verified: boolean;
  reasons: string[];
  counterpartyId?: string;
}

export interface CovenantRequirement {
  requiredActions: string[];
  forbiddenActions: string[];
}
