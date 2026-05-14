// Policy Builder types - AEP v2.6 Capability 13
// Data-driven Rego policy generation with invariant detection

import type { MLEEstimation, SpectralAnalysis } from "../schema-builder/types.js";

/** A domain invariant detected from data or declared in a manifest. */
export interface DomainInvariant {
  id: string;
  description: string;
  fields: string[];
  invariantType: 'equality' | 'inequality' | 'membership' | 'exclusion' | 'conditional' | 'temporal';
  expression?: string;
}

/** Manifest of all domain invariants for a schema. */
export interface InvariantManifest {
  domain: string;
  schemaId: string;
  invariants: DomainInvariant[];
}

/** A proposed Rego deny rule. */
export interface RegoRuleProposal {
  ruleId: string;
  packageName: string;
  ruleSource: string;
  invariantId: string;
  confidence: number;
  derivedFrom: 'mle' | 'spectral_gap' | 'violation_pattern' | 'manual';
}

/** Policy validation result with coverage and spectral impact. */
export interface PolicyValidationResult {
  schemaId: string;
  invariantsCovered: number;
  invariantsTotal: number;
  coverageRate: number;
  missingRules: DomainInvariant[];
  proposedRules: RegoRuleProposal[];
  spectralImpact: {
    fiedlerBefore: number;
    fiedlerAfter: number;
  };
}

/** Configuration for the Policy Builder. */
export interface PolicyBuilderConfig {
  autoPropose: boolean;
  confidenceThreshold: number;
  requireManifest: boolean;
}

/** Default policy builder configuration. */
export const DEFAULT_POLICY_BUILDER_CONFIG: PolicyBuilderConfig = {
  autoPropose: true,
  confidenceThreshold: 0.8,
  requireManifest: true,
};
