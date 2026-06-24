// Policy Builder - orchestrates invariant detection, Rego generation,
// coverage tracking and spectral impact analysis
// AEP v2.75 Capability 13

import type { SchemaCandidate, MLEEstimation, SpectralAnalysis } from "../../schema-builder/lib/types.js";
import { SpectralAnalyzer } from "../../schema-builder/lib/spectral-analyzer.js";
import { MLEEstimator } from "../../schema-builder/lib/mle-estimator.js";
import type {
  PolicyBuilderConfig,
  InvariantManifest,
  PolicyValidationResult,
  RegoRuleProposal,
  DomainInvariant,
} from "./types.js";
import { DEFAULT_POLICY_BUILDER_CONFIG } from "./types.js";
import { InvariantDetector } from "./invariant-detector.js";
import { RegoGenerator } from "./rego-generator.js";

/**
 * Policy Builder - data-driven Rego policy generation and validation.
 * Detects domain invariants from data, generates Rego rules, tracks coverage,
 * and projects spectral impact.
 */
export class PolicyBuilder {
  readonly invariantDetector: InvariantDetector;
  readonly regoGenerator: RegoGenerator;
  readonly config: PolicyBuilderConfig;

  constructor(config?: Partial<PolicyBuilderConfig>) {
    this.config = { ...DEFAULT_POLICY_BUILDER_CONFIG, ...config };
    this.invariantDetector = new InvariantDetector(this.config.confidenceThreshold);
    this.regoGenerator = new RegoGenerator();
  }

  /**
   * Validate a policy against a schema and optional invariant manifest.
   * @param schema Schema to validate against
   * @param regoRules Existing Rego rules
   * @param manifest Optional invariant manifest
   * @param options Additional data for analysis
   * @returns PolicyValidationResult with coverage and spectral impact
   */
  validatePolicy(
    schema: SchemaCandidate,
    regoRules: string[],
    manifest?: InvariantManifest,
    options?: {
      historicalData?: Record<string, unknown>[];
      mleEstimation?: MLEEstimation;
      spectral?: SpectralAnalysis;
    }
  ): PolicyValidationResult {
    // Detect invariants from data if available
    let detectedInvariants: DomainInvariant[] = [];
    if (options?.historicalData && options.historicalData.length > 0) {
      detectedInvariants = this.invariantDetector.detectFromData(
        options.historicalData,
        schema.schemaId
      );
    }

    // Detect covered invariants from existing rules
    const coveredInvariants = this.invariantDetector.detectFromSchema(
      schema,
      regoRules
    );

    // Use manifest if provided, otherwise use detected invariants
    const targetManifest: InvariantManifest = manifest ?? {
      domain: schema.domain,
      schemaId: schema.schemaId,
      invariants: detectedInvariants,
    };

    // Compute coverage
    const coverage = this.invariantDetector.computeCoverage(
      targetManifest,
      coveredInvariants
    );

    // Generate proposed rules for missing invariants
    const proposedRules: RegoRuleProposal[] = [];
    if (this.config.autoPropose) {
      for (const missing of coverage.missing) {
        const proposal = this.regoGenerator.generateFromInvariant(
          missing,
          schema.schemaId,
          `aep.schema.${schema.schemaId}`
        );
        proposedRules.push(proposal);
      }
    }

    // Compute spectral impact
    const spectralAnalyzer = new SpectralAnalyzer();
    const beforeSpectral = options?.spectral ?? spectralAnalyzer.analyze(schema, regoRules);

    // Project Fiedler value with proposed rules
    const allRules = [...regoRules, ...proposedRules.map(p => p.ruleSource)];
    const afterSpectral = spectralAnalyzer.analyze(schema, allRules);

    return {
      schemaId: schema.schemaId,
      invariantsCovered: coverage.covered.length,
      invariantsTotal: targetManifest.invariants.length,
      coverageRate: Math.round(coverage.coverageRate * 1000) / 1000,
      missingRules: coverage.missing,
      proposedRules,
      spectralImpact: {
        fiedlerBefore: beforeSpectral.fiedlerValue,
        fiedlerAfter: afterSpectral.fiedlerValue,
      },
    };
  }

  /**
   * Build a complete policy from schema and data.
   * Full pipeline: detect invariants, generate rules, validate, compute spectral.
   */
  buildPolicy(
    schema: SchemaCandidate,
    domain: string,
    options: {
      historicalData?: Record<string, unknown>[];
      manifest?: InvariantManifest;
    } = {}
  ): {
    rules: RegoRuleProposal[];
    manifest: InvariantManifest;
    spectral: SpectralAnalysis;
  } {
    const packageName = `aep.schema.${schema.schemaId}`;

    // Detect invariants
    let invariants: DomainInvariant[] = [];
    if (options.historicalData && options.historicalData.length > 0) {
      invariants = this.invariantDetector.detectFromData(
        options.historicalData,
        schema.schemaId
      );
    }

    // Merge with manifest if provided
    if (options.manifest) {
      const existingIds = new Set(invariants.map(i => i.id));
      for (const inv of options.manifest.invariants) {
        if (!existingIds.has(inv.id)) {
          invariants.push(inv);
        }
      }
    }

    const manifest: InvariantManifest = {
      domain,
      schemaId: schema.schemaId,
      invariants,
    };

    // Generate rules for all invariants
    const rules: RegoRuleProposal[] = invariants.map(inv =>
      this.regoGenerator.generateFromInvariant(inv, schema.schemaId, packageName)
    );

    // Add MLE outlier rules if data available
    if (options.historicalData && options.historicalData.length > 0) {
      const mleEstimator = new MLEEstimator();
      const mle = mleEstimator.estimateFromData(
        options.historicalData,
        domain,
        schema.schemaId
      );
      const mleRules = this.regoGenerator.generateFromMLEOutliers(
        mle,
        schema.schemaId,
        packageName
      );
      rules.push(...mleRules);
    }

    // Compute spectral analysis of the complete rule set
    const spectralAnalyzer = new SpectralAnalyzer();
    const spectral = spectralAnalyzer.analyze(
      schema,
      rules.map(r => r.ruleSource)
    );

    // Add spectral gap rules
    if (spectral.weakestCut.missingCouplings.length > 0) {
      const gapRules = this.regoGenerator.generateFromSpectralGap(
        spectral,
        schema.schemaId,
        packageName
      );
      rules.push(...gapRules);
    }

    return { rules, manifest, spectral };
  }
}
