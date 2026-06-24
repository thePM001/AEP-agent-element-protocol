import type { AgentIdentity } from "../../identity/lib/types.js";
import type { CovenantSpec } from "../../covenant/lib/types.js";

export interface ProofBundle {
  identity: AgentIdentity;
  covenant: CovenantSpec | null;
  merkleRoot: string;
  actionCount: number;
  timestamp: string;
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
