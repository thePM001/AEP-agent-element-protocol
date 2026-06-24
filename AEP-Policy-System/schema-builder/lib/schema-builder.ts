// Schema Builder - orchestrates MLE estimation, spectral analysis,
// permissiveness scoring and modularity detection for schema validation
// AEP v2.75 Capability 12

import type {
  SchemaBuilderConfig,
  SchemaCandidate,
  SchemaValidationResult,
  MLEEstimation,
  TighteningProposal,
} from "./types.js";
import { DEFAULT_SCHEMA_BUILDER_CONFIG } from "./types.js";
import { MLEEstimator } from "./mle-estimator.js";
import { SpectralAnalyzer } from "./spectral-analyzer.js";
import { PermissivenessScorer } from "./permissiveness-scorer.js";
import { ModuleDetector } from "./module-detector.js";

/**
 * Schema Builder - validates schemas with mathematical rigour.
 * Combines four analytical frameworks into a composite validation score.
 */
export class SchemaBuilder {
  readonly mleEstimator: MLEEstimator;
  readonly spectralAnalyzer: SpectralAnalyzer;
  readonly permissivenessScorer: PermissivenessScorer;
  readonly moduleDetector: ModuleDetector;
  readonly config: SchemaBuilderConfig;

  private stats = {
    totalValidated: 0,
    passCount: 0,
    reviewCount: 0,
    rejectCount: 0,
    totalCompositeScore: 0,
  };

  constructor(config?: Partial<SchemaBuilderConfig>) {
    this.config = { ...DEFAULT_SCHEMA_BUILDER_CONFIG, ...config };
    this.mleEstimator = new MLEEstimator(this.config);
    this.spectralAnalyzer = new SpectralAnalyzer();
    this.permissivenessScorer = new PermissivenessScorer();
    this.moduleDetector = new ModuleDetector();
  }

  /**
   * Validate a schema candidate using all four analytical frameworks.
   * @param candidate Schema to validate
   * @param options Historical data, MLE estimation, and/or Rego rules
   * @returns Complete validation result with composite score and decision
   */
  validateSchema(
    candidate: SchemaCandidate,
    options: {
      historicalData?: Record<string, unknown>[];
      mleEstimation?: MLEEstimation;
      regoRules?: string[];
    } = {}
  ): SchemaValidationResult {
    // Compute MLE if data provided but no estimation
    let mle = options.mleEstimation;
    if (!mle && options.historicalData && options.historicalData.length > 0) {
      mle = this.mleEstimator.estimateFromData(
        options.historicalData,
        candidate.domain,
        candidate.schemaId
      );
    }

    const regoRules = options.regoRules ?? [];

    // Run all four analyses
    const divergenceReport = mle
      ? this.mleEstimator.computeDivergence(candidate, mle)
      : {
          schemaId: candidate.schemaId,
          aggregateDivergence: 0,
          fieldDivergences: [],
          criticalCount: 0,
          warningCount: 0,
        };

    const spectral = this.spectralAnalyzer.analyze(candidate, regoRules);
    const permissiveness = this.permissivenessScorer.analyze(candidate, mle);
    const modularity = this.moduleDetector.analyze(candidate, regoRules);

    // Normalize spectral score to [0,1]
    const spectralNorm = Math.min(1, spectral.spectralScore / (this.config.spectralThreshold * 4));

    // Normalize permissiveness excess to [0,1] penalty
    const permNorm = permissiveness.excessPermissiveness > 0
      ? Math.min(1, permissiveness.excessPermissiveness / 100)
      : 0;

    // Compute composite score
    const C =
      this.config.mleWeight * (1 - divergenceReport.aggregateDivergence) +
      this.config.spectralWeight * spectralNorm +
      this.config.permissivenessWeight * (1 - permNorm) +
      this.config.modularityWeight * modularity.modularityScore;

    const compositeScore = Math.round(Math.max(0, Math.min(1, C)) * 1000) / 1000;

    // Decision
    let decision: SchemaValidationResult["decision"];
    if (compositeScore >= 0.8) decision = "pass";
    else if (compositeScore >= 0.5) decision = "review";
    else decision = "reject";

    // Generate diagnostics
    const diagnostics = this.generateDiagnostics(
      divergenceReport,
      spectral,
      permissiveness,
      modularity
    );

    // Update stats
    this.stats.totalValidated++;
    this.stats.totalCompositeScore += compositeScore;
    if (decision === "pass") this.stats.passCount++;
    else if (decision === "review") this.stats.reviewCount++;
    else this.stats.rejectCount++;

    return {
      schemaId: candidate.schemaId,
      compositeScore,
      mle: divergenceReport,
      spectral,
      permissiveness,
      modularity,
      decision,
      diagnostics,
    };
  }

  /**
   * Build a schema entirely from data using MLE estimation.
   */
  buildFromData(
    data: Record<string, unknown>[],
    domain: string,
    schemaId: string
  ): SchemaCandidate {
    const mle = this.mleEstimator.estimateFromData(data, domain, schemaId);
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const field of mle.fields) {
      const prop: Record<string, unknown> = {};

      switch (field.fieldType) {
        case "numeric":
          prop.type = Number.isInteger(field.mleMin ?? 0) && Number.isInteger(field.mleMax ?? 0)
            ? "integer"
            : "number";
          if (field.mleMin !== undefined) prop.minimum = field.mleMin;
          if (field.mleMax !== undefined) prop.maximum = field.mleMax;
          break;
        case "string":
          prop.type = "string";
          if (field.mleMinLength !== undefined) prop.minLength = field.mleMinLength;
          if (field.mleMaxLength !== undefined) prop.maxLength = field.mleMaxLength;
          if (field.mlePattern) prop.pattern = field.mlePattern;
          break;
        case "enum":
          prop.type = "string";
          if (field.mleEnum) prop.enum = [...field.mleEnum];
          break;
        case "boolean":
          prop.type = "boolean";
          break;
        case "array":
          prop.type = "array";
          break;
        case "object":
          prop.type = "object";
          break;
      }

      properties[field.fieldName] = prop;

      // Required if present in > 95% of records
      if (field.sampleCount / mle.totalRecords >= 0.95) {
        required.push(field.fieldName);
      }
    }

    return {
      schemaId,
      domain,
      definition: {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      },
      source: "mle_derived",
    };
  }

  /**
   * Compare multiple schema candidates and rank by composite score.
   */
  compareSchemas(
    candidates: SchemaCandidate[],
    options: {
      historicalData?: Record<string, unknown>[];
      regoRules?: string[];
    } = {}
  ): {
    ranked: (SchemaCandidate & { score: SchemaValidationResult })[];
    best: SchemaCandidate;
  } {
    let mle: MLEEstimation | undefined;
    if (options.historicalData && options.historicalData.length > 0) {
      mle = this.mleEstimator.estimateFromData(
        options.historicalData,
        candidates[0]?.domain ?? "unknown",
        "comparison"
      );
    }

    const ranked = candidates
      .map(candidate => {
        const score = this.validateSchema(candidate, {
          mleEstimation: mle,
          regoRules: options.regoRules,
        });
        return { ...candidate, score };
      })
      .sort((a, b) => b.score.compositeScore - a.score.compositeScore);

    return {
      ranked,
      best: ranked[0] ?? candidates[0],
    };
  }

  /**
   * Propose tighter constraints based on MLE estimation.
   */
  proposeTightening(
    currentSchema: SchemaCandidate,
    mle: MLEEstimation
  ): TighteningProposal[] {
    return this.mleEstimator.proposeTightening(currentSchema, mle);
  }

  /**
   * Get accumulated statistics for this builder instance.
   */
  getStats(): {
    totalValidated: number;
    passCount: number;
    reviewCount: number;
    rejectCount: number;
    averageCompositeScore: number;
  } {
    return {
      ...this.stats,
      averageCompositeScore: this.stats.totalValidated > 0
        ? Math.round((this.stats.totalCompositeScore / this.stats.totalValidated) * 1000) / 1000
        : 0,
    };
  }

  private generateDiagnostics(
    mle: { aggregateDivergence: number; criticalCount: number; warningCount: number },
    spectral: { fiedlerValue: number; spectralGap: number },
    permissiveness: { excessPermissiveness: number; weakestConstraints: string[] },
    modularity: { modularityScore: number; interModuleGaps: { moduleA: number; moduleB: number }[] }
  ): string[] {
    const diags: string[] = [];

    if (mle.criticalCount > 0) {
      diags.push(`${mle.criticalCount} field(s) have critical MLE divergence. Tighten bounds to match observed data.`);
    }
    if (mle.warningCount > 0) {
      diags.push(`${mle.warningCount} field(s) have warning-level MLE divergence. Review bound ratios.`);
    }
    if (mle.aggregateDivergence > 0.5) {
      diags.push(`Aggregate divergence ${mle.aggregateDivergence.toFixed(3)} is high. Schema is significantly looser than data warrants.`);
    }

    if (spectral.fiedlerValue === 0) {
      diags.push("Fiedler value is 0: constraint graph is disconnected. Add cross-field rules to couple isolated fields.");
    } else if (spectral.fiedlerValue < 0.25) {
      diags.push(`Low Fiedler value (${spectral.fiedlerValue}): weak structural coupling. Consider adding more cross-field constraints.`);
    }

    if (spectral.spectralGap < 0.1) {
      diags.push(`Low spectral gap (${spectral.spectralGap}): constraint coupling is uneven. Balance rule density across fields.`);
    }

    if (permissiveness.excessPermissiveness > 20) {
      diags.push(`High excess permissiveness (${permissiveness.excessPermissiveness.toFixed(1)} bits). Constrain: ${permissiveness.weakestConstraints.join(", ")}`);
    }

    if (modularity.modularityScore < 0.3 && modularity.interModuleGaps.length > 0) {
      diags.push(`Low modularity (${modularity.modularityScore}). ${modularity.interModuleGaps.length} inter-module gap(s) detected.`);
    }

    if (diags.length === 0) {
      diags.push("Schema passes all validation criteria.");
    }

    return diags;
  }
}
