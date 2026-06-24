// Permissiveness Scorer - measures schema acceptance distribution entropy
// References: Amari (2016) Information Geometry, Cover & Thomas (2006) Elements of Information Theory

import type { SchemaCandidate, MLEEstimation, PermissivenessAnalysis } from "./types.js";

/**
 * Scores schema permissiveness using acceptance distribution entropy.
 * Higher entropy = more permissive schema = more input space accepted.
 */
export class PermissivenessScorer {
  /**
   * Analyze permissiveness of a schema.
   * @param schema Schema candidate to analyze
   * @param mle Optional MLE estimation for comparative scoring
   * @returns PermissivenessAnalysis with entropy, excess and principal components
   */
  analyze(schema: SchemaCandidate, mle?: MLEEstimation): PermissivenessAnalysis {
    const properties = (schema.definition.properties ?? {}) as Record<string, Record<string, unknown>>;
    const fieldNames = Object.keys(properties);

    if (fieldNames.length === 0) {
      return {
        entropy: 0,
        excessPermissiveness: 0,
        principalComponents: [],
        weakestConstraints: [],
      };
    }

    // Compute per-field acceptance volume and entropy contribution
    const fieldEntropies: { fieldName: string; entropy: number }[] = [];

    for (const [name, prop] of Object.entries(properties)) {
      const volume = this.estimateAcceptanceVolume(prop);
      const fieldEntropy = volume > 0 ? Math.log2(volume) : 0;
      fieldEntropies.push({ fieldName: name, entropy: fieldEntropy });
    }

    // Total entropy: sum of per-field log2(accepted_values)
    const totalEntropy = fieldEntropies.reduce((s, f) => s + f.entropy, 0);

    // Compute excess permissiveness relative to MLE
    let excessPermissiveness = 0;
    if (mle) {
      const mleEntropy = this.computeMLEEntropy(mle);
      excessPermissiveness = totalEntropy - mleEntropy;
    }

    // Principal components: sort by information weight (entropy contribution)
    const totalWeight = fieldEntropies.reduce((s, f) => s + Math.abs(f.entropy), 0) || 1;
    const principalComponents = fieldEntropies
      .map(f => ({
        fieldName: f.fieldName,
        informationWeight: Math.abs(f.entropy) / totalWeight,
      }))
      .sort((a, b) => b.informationWeight - a.informationWeight);

    // Weakest constraints: fields with highest entropy (most permissive)
    const weakestConstraints = fieldEntropies
      .sort((a, b) => b.entropy - a.entropy)
      .slice(0, Math.ceil(fieldEntropies.length / 3))
      .map(f => f.fieldName);

    return {
      entropy: Math.round(totalEntropy * 1000) / 1000,
      excessPermissiveness: Math.round(excessPermissiveness * 1000) / 1000,
      principalComponents,
      weakestConstraints,
    };
  }

  private estimateAcceptanceVolume(prop: Record<string, unknown>): number {
    const type = prop.type as string | undefined;

    if (type === "number" || type === "integer") {
      const min = (prop.minimum as number) ?? -1e9;
      const max = (prop.maximum as number) ?? 1e9;
      const precision = type === "integer" ? 1 : 0.01;
      return Math.max(1, (max - min) / precision);
    }

    if (type === "string") {
      if (prop.enum && Array.isArray(prop.enum)) {
        return (prop.enum as unknown[]).length;
      }
      const minLen = (prop.minLength as number) ?? 0;
      const maxLen = (prop.maxLength as number) ?? 256;
      // Approximate: character class size ^ average length
      const charSetSize = prop.pattern ? this.estimatePatternCardinality(prop.pattern as string) : 62; // a-zA-Z0-9
      const avgLen = (minLen + maxLen) / 2;
      return Math.pow(charSetSize, Math.min(avgLen, 10)); // cap to avoid overflow
    }

    if (type === "boolean") {
      return 2;
    }

    if (prop.enum && Array.isArray(prop.enum)) {
      return (prop.enum as unknown[]).length;
    }

    // Unconstrained: large penalty
    return 1e6;
  }

  private estimatePatternCardinality(pattern: string): number {
    // Rough estimation of regex character class size
    if (pattern.includes("\\d")) return 10;
    if (pattern.includes("[a-z]") || pattern.includes("[A-Z]")) return 26;
    if (pattern.includes("[a-zA-Z]")) return 52;
    if (pattern.includes("[a-zA-Z0-9]")) return 62;
    if (pattern.includes(".")) return 95; // printable ASCII
    return 62; // default guess
  }

  private computeMLEEntropy(mle: MLEEstimation): number {
    let entropy = 0;

    for (const field of mle.fields) {
      if (field.fieldType === "numeric" && field.mleMin !== undefined && field.mleMax !== undefined) {
        const range = field.mleMax - field.mleMin;
        const precision = field.mlePrecision ?? 0.01;
        const volume = Math.max(1, range / precision);
        entropy += Math.log2(volume);
      }

      if (field.fieldType === "enum" && field.mleEnum) {
        entropy += Math.log2(Math.max(1, field.mleEnum.length));
      }

      if (field.fieldType === "string" && field.mleMaxLength !== undefined) {
        const charSetSize = 62;
        const avgLen = ((field.mleMinLength ?? 0) + field.mleMaxLength) / 2;
        entropy += Math.log2(Math.pow(charSetSize, Math.min(avgLen, 10)));
      }

      if (field.fieldType === "boolean") {
        entropy += 1; // log2(2)
      }
    }

    return entropy;
  }
}
