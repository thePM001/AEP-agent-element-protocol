// MLE Estimator -- derives constraint parameters from observed data
// Uses Welford's online algorithm for stable numeric estimation
// References: Fisher (1922) maximum likelihood, Welford (1962) online variance

import type {
  MLEFieldEstimate,
  MLEEstimation,
  SchemaCandidate,
  DivergenceReport,
  FieldDivergence,
  TighteningProposal,
  SchemaBuilderConfig,
} from "./types.js";
import { DEFAULT_SCHEMA_BUILDER_CONFIG } from "./types.js";

interface FieldAccumulator {
  fieldName: string;
  count: number;
  // Numeric
  numericValues: boolean;
  min: number;
  max: number;
  mean: number;
  m2: number; // Welford's M2
  precisions: Set<number>;
  // String
  stringValues: boolean;
  minLength: number;
  maxLength: number;
  allStrings: string[];
  // Enum
  valueCounts: Map<string, number>;
  // Boolean
  booleanValues: boolean;
  trueCount: number;
  // Type tracking
  types: Set<string>;
  // Array/Object
  arrayValues: boolean;
  objectValues: boolean;
}

/**
 * Maximum Likelihood Estimator for schema constraint parameters.
 * Derives ground-truth bounds from observed data using Welford's algorithm.
 */
export class MLEEstimator {
  private config: SchemaBuilderConfig;

  constructor(config?: Partial<SchemaBuilderConfig>) {
    this.config = { ...DEFAULT_SCHEMA_BUILDER_CONFIG, ...config };
  }

  /**
   * Estimate field constraints from a dataset.
   * @param data Array of records to analyze
   * @param domain Domain name for the estimation
   * @param schemaId Schema identifier
   * @returns Complete MLE estimation with per-field constraints
   */
  estimateFromData(
    data: Record<string, unknown>[],
    domain: string,
    schemaId: string
  ): MLEEstimation {
    if (data.length === 0) {
      return {
        domain,
        schemaId,
        fields: [],
        totalRecords: 0,
        estimatedAt: new Date().toISOString(),
      };
    }

    const accumulators = new Map<string, FieldAccumulator>();

    for (const record of data) {
      for (const [key, value] of Object.entries(record)) {
        let acc = accumulators.get(key);
        if (!acc) {
          acc = this.createAccumulator(key);
          accumulators.set(key, acc);
        }
        this.updateAccumulator(acc, value);
      }
    }

    const fields: MLEFieldEstimate[] = [];
    for (const acc of accumulators.values()) {
      fields.push(this.finalizeEstimate(acc));
    }

    return {
      domain,
      schemaId,
      fields,
      totalRecords: data.length,
      estimatedAt: new Date().toISOString(),
    };
  }

  /**
   * Compute divergence between a schema candidate and MLE estimation.
   * @param schema Schema candidate to evaluate
   * @param mle MLE estimation to compare against
   * @returns Divergence report with per-field scores
   */
  computeDivergence(
    schema: SchemaCandidate,
    mle: MLEEstimation
  ): DivergenceReport {
    const fieldDivergences: FieldDivergence[] = [];
    const properties = (schema.definition.properties ?? {}) as Record<string, Record<string, unknown>>;

    for (const field of mle.fields) {
      const schemaProp = properties[field.fieldName];
      if (!schemaProp) {
        fieldDivergences.push({
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          divergenceScore: 0.5,
          detail: `Field "${field.fieldName}" not found in schema`,
          severity: "warning",
        });
        continue;
      }

      const div = this.computeFieldDivergence(field, schemaProp);
      fieldDivergences.push(div);
    }

    const criticalCount = fieldDivergences.filter(d => d.severity === "critical").length;
    const warningCount = fieldDivergences.filter(d => d.severity === "warning").length;
    const aggregateDivergence =
      fieldDivergences.length > 0
        ? fieldDivergences.reduce((sum, d) => sum + d.divergenceScore, 0) /
          fieldDivergences.length
        : 0;

    return {
      schemaId: schema.schemaId,
      aggregateDivergence,
      fieldDivergences,
      criticalCount,
      warningCount,
    };
  }

  /**
   * Propose tighter constraints based on MLE estimation.
   * @param schema Current schema
   * @param mle MLE estimation from data
   * @param margin Safety margin (default 0.05 = 5%)
   * @returns Array of tightening proposals
   */
  proposeTightening(
    schema: SchemaCandidate,
    mle: MLEEstimation,
    margin = 0.05
  ): TighteningProposal[] {
    const proposals: TighteningProposal[] = [];
    const properties = (schema.definition.properties ?? {}) as Record<string, Record<string, unknown>>;

    for (const field of mle.fields) {
      const schemaProp = properties[field.fieldName];
      if (!schemaProp) continue;

      if (field.fieldType === "numeric") {
        const schemaMax = schemaProp.maximum as number | undefined;
        const schemaMin = schemaProp.minimum as number | undefined;

        if (schemaMax !== undefined && field.mleMax !== undefined) {
          const ratio = schemaMax / (field.mleMax || 1);
          if (ratio > 2) {
            const proposed = field.mleMax * (1 + margin);
            proposals.push({
              fieldName: field.fieldName,
              currentConstraint: { maximum: schemaMax },
              proposedConstraint: { maximum: Math.ceil(proposed * 100) / 100 },
              mleEvidence: `MLE max=${field.mleMax}, schema max=${schemaMax}, ratio=${ratio.toFixed(2)}`,
              productionReplayResult: "safe",
            });
          }
        }

        if (schemaMin !== undefined && field.mleMin !== undefined) {
          const ratio = Math.abs(field.mleMin) / (Math.abs(schemaMin) || 1);
          if (ratio > 2 || (schemaMin < 0 && field.mleMin >= 0)) {
            const proposed = field.mleMin * (1 - margin);
            proposals.push({
              fieldName: field.fieldName,
              currentConstraint: { minimum: schemaMin },
              proposedConstraint: { minimum: Math.floor(proposed * 100) / 100 },
              mleEvidence: `MLE min=${field.mleMin}, schema min=${schemaMin}`,
              productionReplayResult: "safe",
            });
          }
        }
      }

      if (field.fieldType === "enum" && field.mleEnum) {
        const schemaEnum = schemaProp.enum as string[] | undefined;
        if (schemaEnum && schemaEnum.length > field.mleEnum.length * 2) {
          proposals.push({
            fieldName: field.fieldName,
            currentConstraint: { enum: schemaEnum },
            proposedConstraint: { enum: [...field.mleEnum] },
            mleEvidence: `Schema has ${schemaEnum.length} values, only ${field.mleEnum.length} observed`,
            productionReplayResult: "safe",
          });
        }
      }

      if (field.fieldType === "string" && field.mlePattern) {
        const schemaPattern = schemaProp.pattern as string | undefined;
        if (!schemaPattern) {
          proposals.push({
            fieldName: field.fieldName,
            currentConstraint: {},
            proposedConstraint: { pattern: field.mlePattern },
            mleEvidence: `No pattern in schema; MLE derived pattern: ${field.mlePattern}`,
            productionReplayResult: "safe",
          });
        }
      }
    }

    return proposals;
  }

  /**
   * Online update of an existing estimation with a new record.
   * Uses Welford's algorithm for numeric fields.
   */
  updateEstimation(
    existing: MLEEstimation,
    newRecord: Record<string, unknown>
  ): MLEEstimation {
    const updated = { ...existing, totalRecords: existing.totalRecords + 1 };
    const fieldMap = new Map(updated.fields.map(f => [f.fieldName, { ...f }]));

    for (const [key, value] of Object.entries(newRecord)) {
      const field = fieldMap.get(key);
      if (!field) {
        // New field discovered
        const acc = this.createAccumulator(key);
        this.updateAccumulator(acc, value);
        fieldMap.set(key, this.finalizeEstimate(acc));
        continue;
      }

      field.sampleCount++;

      if (field.fieldType === "numeric" && typeof value === "number") {
        // Welford's online update
        const oldMean = field.mleMean ?? 0;
        const newMean = oldMean + (value - oldMean) / field.sampleCount;
        const oldVariance = field.mleVariance ?? 0;
        const newM2 = oldVariance * (field.sampleCount - 1) + (value - oldMean) * (value - newMean);
        field.mleMean = newMean;
        field.mleVariance = field.sampleCount > 1 ? newM2 / (field.sampleCount - 1) : 0;
        if (field.mleMin !== undefined) field.mleMin = Math.min(field.mleMin, value);
        if (field.mleMax !== undefined) field.mleMax = Math.max(field.mleMax, value);
      }

      if (field.fieldType === "enum" && typeof value === "string") {
        if (field.mleDistribution) {
          field.mleDistribution[value] = (field.mleDistribution[value] ?? 0) + 1;
        }
        if (field.mleEnum && !field.mleEnum.includes(value)) {
          field.mleEnum.push(value);
        }
      }

      if (field.fieldType === "string" && typeof value === "string") {
        if (field.mleMinLength !== undefined) field.mleMinLength = Math.min(field.mleMinLength, value.length);
        if (field.mleMaxLength !== undefined) field.mleMaxLength = Math.max(field.mleMaxLength, value.length);
      }
    }

    updated.fields = [...fieldMap.values()];
    updated.estimatedAt = new Date().toISOString();
    return updated;
  }

  private createAccumulator(fieldName: string): FieldAccumulator {
    return {
      fieldName,
      count: 0,
      numericValues: false,
      min: Infinity,
      max: -Infinity,
      mean: 0,
      m2: 0,
      precisions: new Set(),
      stringValues: false,
      minLength: Infinity,
      maxLength: 0,
      allStrings: [],
      valueCounts: new Map(),
      booleanValues: false,
      trueCount: 0,
      types: new Set(),
      arrayValues: false,
      objectValues: false,
    };
  }

  private updateAccumulator(acc: FieldAccumulator, value: unknown): void {
    acc.count++;

    if (value === null || value === undefined) {
      acc.types.add("null");
      return;
    }

    const t = typeof value;
    acc.types.add(t);

    if (t === "number") {
      const num = value as number;
      acc.numericValues = true;
      acc.min = Math.min(acc.min, num);
      acc.max = Math.max(acc.max, num);
      // Welford's online algorithm
      const delta = num - acc.mean;
      acc.mean += delta / acc.count;
      const delta2 = num - acc.mean;
      acc.m2 += delta * delta2;
      // Precision (GCD of decimal places)
      const str = String(num);
      const dot = str.indexOf(".");
      if (dot >= 0) {
        const decimals = str.length - dot - 1;
        acc.precisions.add(Math.pow(10, -decimals));
      } else {
        acc.precisions.add(1);
      }
    }

    if (t === "string") {
      const s = value as string;
      acc.stringValues = true;
      acc.minLength = Math.min(acc.minLength, s.length);
      acc.maxLength = Math.max(acc.maxLength, s.length);
      acc.allStrings.push(s);
      acc.valueCounts.set(s, (acc.valueCounts.get(s) ?? 0) + 1);
    }

    if (t === "boolean") {
      acc.booleanValues = true;
      if (value) acc.trueCount++;
    }

    if (Array.isArray(value)) {
      acc.arrayValues = true;
    }

    if (t === "object" && !Array.isArray(value)) {
      acc.objectValues = true;
    }
  }

  private finalizeEstimate(acc: FieldAccumulator): MLEFieldEstimate {
    const fieldType = this.detectFieldType(acc);
    const estimate: MLEFieldEstimate = {
      fieldName: acc.fieldName,
      fieldType,
      sampleCount: acc.count,
      confidenceLevel: this.config.confidenceLevel,
    };

    if (fieldType === "numeric") {
      estimate.mleMin = acc.min;
      estimate.mleMax = acc.max;
      estimate.mleMean = acc.mean;
      estimate.mleVariance = acc.count > 1 ? acc.m2 / (acc.count - 1) : 0;
      estimate.mlePrecision = acc.precisions.size > 0
        ? Math.min(...acc.precisions)
        : 1;

      // Confidence intervals (normal approximation)
      if (acc.count >= 2) {
        const stddev = Math.sqrt(estimate.mleVariance!);
        const z = this.config.confidenceLevel === 0.99 ? 2.576 : 1.96;
        const margin = z * stddev / Math.sqrt(acc.count);
        estimate.confidenceIntervalLower = estimate.mleMean! - margin;
        estimate.confidenceIntervalUpper = estimate.mleMean! + margin;
      }
    }

    if (fieldType === "string") {
      estimate.mleMinLength = acc.minLength === Infinity ? 0 : acc.minLength;
      estimate.mleMaxLength = acc.maxLength;
      estimate.mlePattern = this.derivePattern(acc.allStrings);
    }

    if (fieldType === "enum") {
      const sorted = [...acc.valueCounts.entries()].sort((a, b) => b[1] - a[1]);
      estimate.mleEnum = sorted.map(([v]) => v);
      estimate.mleDistribution = Object.fromEntries(
        sorted.map(([v, c]) => [v, c / acc.count])
      );
    }

    return estimate;
  }

  private detectFieldType(acc: FieldAccumulator): MLEFieldEstimate["fieldType"] {
    if (acc.booleanValues && !acc.numericValues && !acc.stringValues) return "boolean";
    if (acc.numericValues && !acc.stringValues) return "numeric";
    if (acc.arrayValues && !acc.stringValues && !acc.numericValues) return "array";
    if (acc.objectValues && !acc.stringValues && !acc.numericValues) return "object";
    if (acc.stringValues) {
      // Heuristic: if fewer than 20 unique values and > 30 samples, treat as enum
      if (acc.valueCounts.size <= 20 && acc.count >= this.config.minSampleSize) {
        return "enum";
      }
      return "string";
    }
    return "string";
  }

  private derivePattern(strings: string[]): string {
    if (strings.length === 0) return ".*";

    const lens = strings.map(s => s.length);
    const minLen = Math.min(...lens);
    const maxLen = Math.max(...lens);

    // Check for common prefix first (most specific pattern)
    let prefix = strings[0];
    for (const s of strings) {
      while (!s.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
    }

    if (prefix.length > 0) {
      const suffixLen = maxLen - prefix.length;
      const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `^${escapedPrefix}.{0,${suffixLen}}$`;
    }

    // Check if all digits
    if (strings.every(s => /^\d+$/.test(s))) {
      return minLen === maxLen ? `^\\d{${minLen}}$` : `^\\d{${minLen},${maxLen}}$`;
    }

    // Check if all alphanumeric
    if (strings.every(s => /^[a-zA-Z0-9]+$/.test(s))) {
      return minLen === maxLen ? `^[a-zA-Z0-9]{${minLen}}$` : `^[a-zA-Z0-9]{${minLen},${maxLen}}$`;
    }

    // Fallback: character class analysis
    const hasUpper = strings.some(s => /[A-Z]/.test(s));
    const hasLower = strings.some(s => /[a-z]/.test(s));
    const hasDigit = strings.some(s => /\d/.test(s));
    const hasSpecial = strings.some(s => /[^a-zA-Z0-9]/.test(s));

    let charClass = "";
    if (hasUpper) charClass += "A-Z";
    if (hasLower) charClass += "a-z";
    if (hasDigit) charClass += "0-9";
    if (hasSpecial) charClass += "\\W";

    return `^[${charClass}]{${minLen},${maxLen}}$`;
  }

  private computeFieldDivergence(
    field: MLEFieldEstimate,
    schemaProp: Record<string, unknown>
  ): FieldDivergence {
    if (field.fieldType === "numeric") {
      return this.computeNumericDivergence(field, schemaProp);
    }
    if (field.fieldType === "enum") {
      return this.computeEnumDivergence(field, schemaProp);
    }
    if (field.fieldType === "string") {
      return this.computeStringDivergence(field, schemaProp);
    }

    return {
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      divergenceScore: 0,
      detail: "No divergence analysis for this field type",
      severity: "ok",
    };
  }

  private computeNumericDivergence(
    field: MLEFieldEstimate,
    schemaProp: Record<string, unknown>
  ): FieldDivergence {
    const schemaMax = schemaProp.maximum as number | undefined;
    const schemaMin = schemaProp.minimum as number | undefined;
    let maxRatio = 1;
    let minRatio = 1;

    if (schemaMax !== undefined && field.mleMax !== undefined && field.mleMax !== 0) {
      maxRatio = schemaMax / field.mleMax;
    }
    if (schemaMin !== undefined && field.mleMin !== undefined && field.mleMin !== 0) {
      minRatio = Math.abs(schemaMin) / Math.abs(field.mleMin);
    }

    const ratio = Math.max(maxRatio, minRatio);
    const logThreshold = Math.log(this.config.divergenceThreshold);
    const score = ratio <= 1 ? 0 : Math.min(Math.log(ratio) / logThreshold, 1);

    let severity: FieldDivergence["severity"] = "ok";
    if (ratio > 5) severity = "critical";
    else if (ratio > 2) severity = "warning";

    return {
      fieldName: field.fieldName,
      fieldType: "numeric",
      divergenceScore: score,
      divergenceRatio: ratio,
      detail: `Schema bounds ratio ${ratio.toFixed(2)}x wider than MLE estimate (max: schema=${schemaMax}, mle=${field.mleMax})`,
      severity,
    };
  }

  private computeEnumDivergence(
    field: MLEFieldEstimate,
    schemaProp: Record<string, unknown>
  ): FieldDivergence {
    const schemaEnum = schemaProp.enum as string[] | undefined;
    if (!schemaEnum || !field.mleEnum) {
      return {
        fieldName: field.fieldName,
        fieldType: "enum",
        divergenceScore: 0,
        detail: "No enum constraint to compare",
        severity: "ok",
      };
    }

    const mleSet = new Set(field.mleEnum);
    const unobserved = schemaEnum.filter(v => !mleSet.has(v));
    const score = unobserved.length / schemaEnum.length;

    let severity: FieldDivergence["severity"] = "ok";
    if (score > 0.5) severity = "critical";
    else if (score > 0.2) severity = "warning";

    return {
      fieldName: field.fieldName,
      fieldType: "enum",
      divergenceScore: score,
      detail: `${unobserved.length}/${schemaEnum.length} enum values never observed in data`,
      severity,
    };
  }

  private computeStringDivergence(
    field: MLEFieldEstimate,
    schemaProp: Record<string, unknown>
  ): FieldDivergence {
    const schemaPattern = schemaProp.pattern as string | undefined;
    const schemaMaxLength = schemaProp.maxLength as number | undefined;

    let score = 0;
    let detail = "";

    if (!schemaPattern && field.mlePattern) {
      score = 0.3;
      detail = "Schema has no pattern constraint; MLE derived one";
    }

    if (schemaMaxLength !== undefined && field.mleMaxLength !== undefined) {
      const ratio = schemaMaxLength / (field.mleMaxLength || 1);
      if (ratio > 3) {
        score = Math.max(score, 0.6);
        detail += ` Schema maxLength ${schemaMaxLength} is ${ratio.toFixed(1)}x wider than observed max ${field.mleMaxLength}`;
      }
    }

    let severity: FieldDivergence["severity"] = "ok";
    if (score > 0.5) severity = "warning";
    if (score > 0.8) severity = "critical";

    return {
      fieldName: field.fieldName,
      fieldType: "string",
      divergenceScore: score,
      detail: detail || "String constraints align with MLE estimate",
      severity,
    };
  }
}
