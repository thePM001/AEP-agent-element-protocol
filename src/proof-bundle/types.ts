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

export interface ReliabilityIndex {
  hardComplianceRate: number;
  softRecoveryRate: number;
  driftScore: number;
  trustScore: number;
  scannerPassRate: number;
  theta: number;
}

export interface ReliabilityWeights {
  hard: number;
  recovery: number;
  drift: number;
  trust: number;
  scanner: number;
}

export const DEFAULT_RELIABILITY_WEIGHTS: ReliabilityWeights = {
  hard: 0.3,
  recovery: 0.2,
  drift: 0.15,
  trust: 0.2,
  scanner: 0.15,
};

export interface ProofBundle {
  bundleId: string;
  version: "2.5";
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
  reliabilityIndex?: ReliabilityIndex;
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
