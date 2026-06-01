// Schema Builder - AEP v2.75 Capability 12
// Data-driven schema creation and validation with mathematical foundations

export {
  type MLEFieldEstimate,
  type MLEEstimation,
  type SchemaCandidate,
  type FieldDivergence,
  type DivergenceReport,
  type SpectralAnalysis,
  type PermissivenessAnalysis,
  type ModularityAnalysis,
  type SchemaValidationResult,
  type SchemaBuilderConfig,
  type TighteningProposal,
  DEFAULT_SCHEMA_BUILDER_CONFIG,
} from "./types.js";

export { MLEEstimator } from "./mle-estimator.js";
export { SpectralAnalyzer } from "./spectral-analyzer.js";
export { PermissivenessScorer } from "./permissiveness-scorer.js";
export { ModuleDetector } from "./module-detector.js";
export { SchemaBuilder } from "./schema-builder.js";
