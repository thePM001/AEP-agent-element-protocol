import type { AgentIdentity } from "../identity/types.js";
import type { CovenantSpec } from "../covenant/types.js";
import type { SessionReport } from "../session/session.js";
import type { TrustTier } from "../trust/types.js";
import type { ExecutionRing } from "../rings/types.js";
import type { TaskTree } from "../decomposition/types.js";

export interface TrustScore {
  score: number;
  tier: TrustTier;
}

export interface ProofBundle {
  bundleId: string;
  version: "2.2";
  createdAt: string;
  agent: AgentIdentity;
  covenant: CovenantSpec | null;
  sessionReport: SessionReport;
  merkleRoot: string;
  entryCount: number;
  trustScore: TrustScore;
  ring: ExecutionRing;
  driftScore: number;
  ledgerHash: string;
  signature: string;
  taskTree?: TaskTree | null;
}

export interface BundleVerification {
  valid: boolean;
  signatureValid: boolean;
  identityValid: boolean;
  covenantValid: boolean;
  identityExpired: boolean;
  ledgerHashMatch: boolean | null;
  merkleRootMatch: boolean | null;
  errors: string[];
}
