import type { AgentIdentity } from "../../identity/lib/types.js";
import type { CovenantSpec } from "../../covenant/lib/types.js";
import type { SessionReport } from "../../session/lib/session.js";
import type { TaskTree } from "../../decomposition/lib/types.js";

export interface ReliabilityIndex {
  hardComplianceRate: number;
  softRecoveryRate: number;
  driftScore: number;
  scannerPassRate: number;
  mlScore?: number;
  theta: number;
}

export interface ReliabilityWeights {
  hard: number;
  recovery: number;
  drift: number;
  scanner: number;
  ml?: number;
}

// Weights sum to 1. Ratios 6:4:3:3 for hard, recovery, drift and scanner.
export const DEFAULT_RELIABILITY_WEIGHTS: ReliabilityWeights = {
  hard: 0.375,
  recovery: 0.25,
  drift: 0.1875,
  scanner: 0.1875,
};

// Weights sum to 1. Ratios 5:3:2:3:4 for hard, recovery, drift, scanner and ml.
export const ML_RELIABILITY_WEIGHTS: ReliabilityWeights = {
  hard: 5 / 17,
  recovery: 3 / 17,
  drift: 2 / 17,
  scanner: 3 / 17,
  ml: 4 / 17,
};

export interface ProofBundle {
  bundleId: string;
  version: "2.9.0";
  createdAt: string;
  agent: AgentIdentity;
  covenant: CovenantSpec | null;
  sessionReport: SessionReport;
  merkleRoot: string;
  entryCount: number;
  isolation_class: string;
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
