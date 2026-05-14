// Rego Generator - generates Rego deny rules from invariants, MLE outliers, and spectral gaps
// Produces syntactically valid Rego deny[msg] blocks

import type { MLEEstimation, SpectralAnalysis } from "../schema-builder/types.js";
import type { DomainInvariant, RegoRuleProposal } from "./types.js";

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
          const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${field.fieldName}
  val < ${field.mleMin}
  msg := sprintf("${field.fieldName} value %v is below MLE minimum ${field.mleMin}", [val])
}

deny[msg] {
  val := input.payload.${field.fieldName}
  val > ${field.mleMax}
  msg := sprintf("${field.fieldName} value %v exceeds MLE maximum ${field.mleMax}", [val])
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
        const allowedSet = field.mleEnum.map(v => `"${v}"`).join(", ");
        const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${field.fieldName}
  allowed := {${allowedSet}}
  not allowed[val]
  msg := sprintf("${field.fieldName} value '%v' not in observed values", [val])
}`;
        proposals.push({
          ruleId: `mle_enum_${ruleNum++}`,
          packageName,
          ruleSource,
          invariantId: `mle_${field.fieldName}`,
          confidence: 0.9,
          derivedFrom: "mle",
        });
      }

      if (field.fieldType === "string" && field.mlePattern) {
        const ruleSource = `package ${packageName}

deny[msg] {
  val := input.payload.${field.fieldName}
  not re_match("${field.mlePattern.replace(/\\/g, "\\\\")}", val)
  msg := sprintf("${field.fieldName} value '%v' does not match MLE-derived pattern", [val])
}`;
        proposals.push({
          ruleId: `mle_string_${ruleNum++}`,
          packageName,
          ruleSource,
          invariantId: `mle_${field.fieldName}`,
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
# with no cross-validation rule. This placeholder ensures they are
# checked together.
deny[msg] {
  a := input.payload.${fieldA}
  b := input.payload.${fieldB}
  # TODO: Define the actual cross-field constraint
  # This is a placeholder generated from Fiedler vector analysis
  false
  msg := sprintf("Cross-field validation: ${fieldA}=%v ${fieldB}=%v", [a, b])
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
    const va = match ? match[2] : "X";
    const vb = match ? match[4] : "Y";
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
    return `package ${pkg}

# ${inv.description}
deny[msg] {
  ${inv.fields.map(f => `  _ := input.payload.${f}`).join("\n")}
  # TODO: Implement constraint logic for invariant ${inv.id}
  false
  msg := "Invariant ${inv.id}: ${inv.description}"
}`;
  }
}
