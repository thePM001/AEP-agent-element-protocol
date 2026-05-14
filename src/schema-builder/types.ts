// Schema Builder types - AEP v2.6 Capability 12
// Mathematical foundations: Fisher MLE, Fiedler spectral graph theory,
// Amari information geometry, Blondel-Louvain clustering

/** MLE-derived constraint estimate for a single schema field. */
export interface MLEFieldEstimate {
  fieldName: string;
  fieldType: 'numeric' | 'string' | 'enum' | 'boolean' | 'object' | 'array';
  // Numeric fields
  mleMin?: number;
  mleMax?: number;
  mleMean?: number;
  mleVariance?: number;
  mlePrecision?: number;
  // String fields
  mlePattern?: string;
  mleMinLength?: number;
  mleMaxLength?: number;
  // Enum fields
  mleEnum?: string[];
  mleDistribution?: Record<string, number>;
  // Confidence
  sampleCount: number;
  confidenceLevel: number;
  confidenceIntervalUpper?: number;
  confidenceIntervalLower?: number;
}

/** Complete MLE estimation for a schema domain. */
export interface MLEEstimation {
  domain: string;
  schemaId: string;
  fields: MLEFieldEstimate[];
  totalRecords: number;
  estimatedAt: string;
}

/** A schema candidate for validation. */
export interface SchemaCandidate {
  schemaId: string;
  domain: string;
  definition: Record<string, unknown>;
  source: 'human' | 'llm' | 'mle_derived' | 'ensemble';
  sourceModel?: string;
}

/** Per-field divergence between schema and MLE estimation. */
export interface FieldDivergence {
  fieldName: string;
  fieldType: string;
  divergenceScore: number;
  divergenceRatio?: number;
  detail: string;
  severity: 'ok' | 'warning' | 'critical';
}

/** Aggregated divergence report for a schema. */
export interface DivergenceReport {
  schemaId: string;
  aggregateDivergence: number;
  fieldDivergences: FieldDivergence[];
  criticalCount: number;
  warningCount: number;
}

/** Graph spectral analysis of constraint coupling. */
export interface SpectralAnalysis {
  fiedlerValue: number;
  spectralGap: number;
  spectralScore: number;
  weakestCut: {
    clusterA: string[];
    clusterB: string[];
    missingCouplings: string[];
  };
  eigenvalues: number[];
}

/** Acceptance distribution entropy and permissiveness analysis. */
export interface PermissivenessAnalysis {
  entropy: number;
  excessPermissiveness: number;
  principalComponents: {
    fieldName: string;
    informationWeight: number;
  }[];
  weakestConstraints: string[];
}

/** Louvain community detection modularity analysis. */
export interface ModularityAnalysis {
  modularityScore: number;
  modules: {
    id: number;
    fields: string[];
    internalCoupling: number;
    externalCoupling: number;
  }[];
  interModuleGaps: {
    moduleA: number;
    moduleB: number;
    missingRules: string[];
  }[];
}

/** Complete schema validation result combining all four analyses. */
export interface SchemaValidationResult {
  schemaId: string;
  compositeScore: number;
  mle: DivergenceReport;
  spectral: SpectralAnalysis;
  permissiveness: PermissivenessAnalysis;
  modularity: ModularityAnalysis;
  decision: 'pass' | 'review' | 'reject';
  diagnostics: string[];
}

/** Configuration for the Schema Builder. */
export interface SchemaBuilderConfig {
  mleWeight: number;
  spectralWeight: number;
  permissivenessWeight: number;
  modularityWeight: number;
  divergenceThreshold: number;
  spectralThreshold: number;
  confidenceLevel: number;
  minSampleSize: number;
}

/** Proposed constraint tightening for a field. */
export interface TighteningProposal {
  fieldName: string;
  currentConstraint: Record<string, unknown>;
  proposedConstraint: Record<string, unknown>;
  mleEvidence: string;
  productionReplayResult: 'safe' | 'breaking';
  breakingCount?: number;
  totalReplayed?: number;
}

/** Default schema builder configuration. */
export const DEFAULT_SCHEMA_BUILDER_CONFIG: SchemaBuilderConfig = {
  mleWeight: 0.35,
  spectralWeight: 0.25,
  permissivenessWeight: 0.25,
  modularityWeight: 0.15,
  divergenceThreshold: 3.0,
  spectralThreshold: 0.25,
  confidenceLevel: 0.99,
  minSampleSize: 30,
};
