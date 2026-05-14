// Policy Builder - AEP v2.6 Capability 13
// Data-driven Rego policy generation with invariant detection

export {
  type DomainInvariant,
  type InvariantManifest,
  type RegoRuleProposal,
  type PolicyValidationResult,
  type PolicyBuilderConfig,
  DEFAULT_POLICY_BUILDER_CONFIG,
} from "./types.js";

export { InvariantDetector } from "./invariant-detector.js";
export { RegoGenerator } from "./rego-generator.js";
export { PolicyBuilder } from "./policy-builder.js";
