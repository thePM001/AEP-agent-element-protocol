// @PAD: p0-v275-h29-h30-rego-generator-v1
// @GCDE: document_sha256=p0-v275-h29-h30-rego
// Rego Generator - generates Rego deny rules from invariants, MLE outliers, and spectral gaps
// Produces syntactically valid Rego deny[msg] blocks

import type { MLEEstimation, SpectralAnalysis } from "../../schema-builder/lib/types.js";
import type { DomainInvariant, RegoRuleProposal } from "./types.js";

/** HIGH: allow only Rego-safe identifier characters (no injection via field names). */
function sanitizeRegoIdent(name: string): string {
  const cleaned = String(name ?? "").replace(/[^A-Za-z0-9_]/g, "_");
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `f_${cleaned || "field"}`;
  }
  return cleaned;
}

/**
 * Generates Rego deny rules from detected invariants, MLE outliers,
 * and spectral gap analysis.
 */
export class RegoGenerator {
  /**
   * Generate a Rego deny rule from a domain invariant.
   */
  generateFromInvariant(
    invariant: DomainInvariant,
    schemaId: string,
    packageName: string
  ): RegoRuleProposal {
    let ruleSource: string;

    switch (invariant.invariantType) {
      case "equality":
        ruleSource = this.generateEqualityRule(invariant, packageName);
        break;
      case "inequality":
        ruleSource = this.generateInequalityRule(invariant, packageName);
        break;
      case "membership":
        ruleSource = this.generateMembershipRule(invariant, packageName);
        break;
      case "exclusion":
        ruleSource = this.generateExclusionRule(invariant, packageName);
        break;
      case "conditional":
        ruleSource = this.generateConditionalRule(invariant, packageName);
        break;
      case "temporal":
        ruleSource = this.generateTemporalRule(invariant, packageName);
        break;
      default:
        ruleSource = this.generateGenericRule(invariant, packageName);
    }

    return {
      ruleId: `rule_${invariant.id}`,
      packageName,
      ruleSource,
      invariantId: invariant.id,
      confidence: 0.9,
      derivedFrom: "violation_pattern",
    };
  }

  /**
   * Generate Rego rules from MLE outlier analysis.
   */
  generateFromMLEOutliers(
    mle: MLEEstimation,
    schemaId: string,
    packageName: string
  ): RegoRuleProposal[] {
    const proposals: RegoRuleProposal[] = [];
    let ruleNum = 1;

    for (const field of mle.fields) {
      if (field.fieldType === "numeric") {
        // Confidence interval bounds
        if (field.confidenceIntervalLower !== undefined && field.confidenceIntervalUpper !== undefined) {
          const lower = Math.floor(field.confidenceIntervalLower * 100) / 100;
          const upper = Math.ceil(field.confidenceIntervalUpper * 100) / 100;
          // HIGH: sanitize field names for Rego (identifier-safe only)
          const safeField = sanitizeRegoIdent(field.fieldName);
          const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${safeField}
  val < ${lower}
  msg := sprintf("${safeField} value %v is below confidence lower bound ${lower}", [val])
}

deny[msg] {
  val := input.payload.${safeField}
  val > ${upper}
  msg := sprintf("${safeField} value %v exceeds confidence upper bound ${upper}", [val])
}`;
          proposals.push({
            ruleId: `mle_numeric_${ruleNum++}`,
            packageName,
            ruleSource,
            invariantId: `mle_${field.fieldName}`,
            confidence: 0.85,
            derivedFrom: "mle",
          });
        }
      }

      if (field.fieldType === "enum" && field.mleEnum) {
        const safeField = sanitizeRegoIdent(field.fieldName);
        const allowedSet = field.mleEnum
          .map((v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
          .join(", ");
        const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${safeField}
  allowed := {${allowedSet}}
  not allowed[val]
  msg := sprintf("${safeField} value '%v' not in observed values", [val])
}`;
        proposals.push({
          ruleId: `mle_enum_${ruleNum++}`,
          packageName,
          ruleSource,
          invariantId: `mle_${safeField}`,
          confidence: 0.9,
          derivedFrom: "mle",
        });
      }

      if (field.fieldType === "string" && field.mlePattern) {
        const safeField = sanitizeRegoIdent(field.fieldName);
        const safePattern = String(field.mlePattern)
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"');
        const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${safeField}
  not re_match("${safePattern}", val)
  msg := sprintf("${safeField} value '%v' does not match MLE-derived pattern", [val])
}`;
        proposals.push({
          ruleId: `mle_string_${ruleNum++}`,
          packageName,
          ruleSource,
          invariantId: `mle_${safeField}`,
          confidence: 0.7,
          derivedFrom: "mle",
        });
      }
    }

    return proposals;
  }

  /**
   * Generate Rego rules from spectral gap analysis.
   * Low confidence: inferred from graph topology, not domain knowledge.
   */
  generateFromSpectralGap(
    spectral: SpectralAnalysis,
    schemaId: string,
    packageName: string
  ): RegoRuleProposal[] {
    const proposals: RegoRuleProposal[] = [];
    let ruleNum = 1;

    for (const coupling of spectral.weakestCut.missingCouplings) {
      const parts = coupling.split(" <-> ");
      if (parts.length !== 2) continue;

      const [fieldA, fieldB] = parts;
      const ruleSource = `package ${packageName}

# Generated from spectral gap analysis. Review before adoption.
# Fields ${fieldA} and ${fieldB} are in different constraint clusters
# with no cross-validation rule. Coupled fields must appear together.
deny[msg] {
  a := input.payload.${fieldA}
  not input.payload.${fieldB}
  a
  msg := sprintf("Spectral gap: ${fieldA} is set (%v) but coupled field ${fieldB} is missing", [a])
}

deny[msg] {
  b := input.payload.${fieldB}
  not input.payload.${fieldA}
  b
  msg := sprintf("Spectral gap: ${fieldB} is set (%v) but coupled field ${fieldA} is missing", [b])
}`;

      proposals.push({
        ruleId: `spectral_gap_${ruleNum++}`,
        packageName,
        ruleSource,
        invariantId: `spectral_${fieldA}_${fieldB}`,
        confidence: 0.5,
        derivedFrom: "spectral_gap",
      });
    }

    return proposals;
  }

  private generateEqualityRule(inv: DomainInvariant, pkg: string): string {
    const [a, b] = inv.fields;
    return `package ${pkg}

deny[msg] {
  a := input.payload.${a}
  b := input.payload.${b}
  a != b
  msg := sprintf("Invariant violation: ${a} (%v) must equal ${b} (%v)", [a, b])
}`;
  }

  private generateInequalityRule(inv: DomainInvariant, pkg: string): string {
    const [a, b] = inv.fields;
    return `package ${pkg}

deny[msg] {
  a := input.payload.${a}
  b := input.payload.${b}
  a < b
  msg := sprintf("Invariant violation: ${a} (%v) must be >= ${b} (%v)", [a, b])
}`;
  }

  private generateMembershipRule(inv: DomainInvariant, pkg: string): string {
    const field = inv.fields[0];
    // Extract values from expression if available
    const match = inv.expression?.match(/\[(.+)\]/);
    const values = match ? match[1] : `"value1", "value2"`;
    return `package ${pkg}

deny[msg] {
  val := input.payload.${field}
  allowed := {${values}}
  not allowed[val]
  msg := sprintf("${field} value '%v' is not a valid member", [val])
}`;
  }

  private generateExclusionRule(inv: DomainInvariant, pkg: string): string {
    const [a, b] = inv.fields;
    // Parse the exclusion values from expression
    const match = inv.expression?.match(/not \((\w+) == "(.+)" and (\w+) == "(.+)"\)/);
    if (!match) {
      return `package ${pkg}

deny[msg] {
  msg := "Exclusion invariant expression could not be parsed; fail closed"
}`;
    }
    const va = match[2];
    const vb = match[4];
    return `package ${pkg}

deny[msg] {
  input.payload.${a} == "${va}"
  input.payload.${b} == "${vb}"
  msg := sprintf("Forbidden co-occurrence: ${a}='${va}' with ${b}='${vb}'", [])
}`;
  }

  private generateConditionalRule(inv: DomainInvariant, pkg: string): string {
    const [condField, resultField] = inv.fields;
    const match = inv.expression?.match(/if \w+ == "(.+)" then \w+ in \[(.+)\]/);
    const condVal = match ? match[1] : "X";
    const allowedVals = match ? match[2] : `"a", "b"`;
    return `package ${pkg}

deny[msg] {
  input.payload.${condField} == "${condVal}"
  val := input.payload.${resultField}
  allowed := {${allowedVals}}
  not allowed[val]
  msg := sprintf("When ${condField}='${condVal}', ${resultField} must be in allowed set; got '%v'", [val])
}`;
  }

  private generateTemporalRule(inv: DomainInvariant, pkg: string): string {
    const [a, b] = inv.fields;
    return `package ${pkg}

deny[msg] {
  date_a := time.parse_rfc3339_ns(input.payload.${a})
  date_b := time.parse_rfc3339_ns(input.payload.${b})
  date_b < date_a
  msg := sprintf("Temporal invariant violation: ${b} must not be before ${a}", [])
}`;
  }

  private generateGenericRule(inv: DomainInvariant, pkg: string): string {
    // M-42: consistent zero-indent deny blocks joined by blank lines
    const blocks = inv.fields
      .map(
        (field) =>
          [
            "deny[msg] {",
            `  not input.payload.${field}`,
            `  msg := sprintf("Invariant ${inv.id}: required field ${field} is missing")`,
            "}",
          ].join("\n")
      )
      .join("\n\n");

    const expressionNote = inv.expression
      ? `\n# Expression hint: ${inv.expression}`
      : "";

    return `package ${pkg}

# ${inv.description}${expressionNote}
${blocks}`;
  }
}
