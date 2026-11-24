// Rego Generator - generates Rego deny rules from invariants, MLE outliers and spectral gaps
// Produces syntactically valid Rego deny[msg] blocks. Every name and value that
// comes from data or from a manifest enters the Rego source as a quoted string
// literal or a checked identifier, so no field name or value can add a rule.

import type { MLEEstimation, SpectralAnalysis } from "../../schema-builder/lib/types.js";
import type { DomainInvariant, RegoRuleProposal } from "./types.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REGO_KEYWORDS = new Set([
  "as", "contains", "default", "else", "every", "false", "if", "import",
  "in", "not", "null", "package", "some", "true", "with",
]);

/** A Rego string literal. Rego strings use the JSON escapes. */
export function regoString(text: string): string {
  return JSON.stringify(String(text));
}

/** The reference to a payload field: dotted for a plain identifier, bracketed otherwise. */
export function payloadRef(field: string): string {
  const name = String(field);
  if (IDENT.test(name) && !REGO_KEYWORDS.has(name)) return `input.payload.${name}`;
  return `input.payload[${regoString(name)}]`;
}

/** A Rego scalar literal for a value read from data or from a manifest. */
export function regoScalar(value: string | number | boolean): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError(`a Rego literal cannot hold ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return regoString(value);
}

/** Text placed inside a sprintf format: a percent sign stays literal. */
function fmt(text: string): string {
  return String(text).replace(/%/g, "%%");
}

/** One line of comment text: line breaks would end the comment. */
function commentText(text: string): string {
  const breaks = new Set(["\r", "\n", String.fromCharCode(0x2028), String.fromCharCode(0x2029)]);
  return [...String(text)].map((ch) => (breaks.has(ch) ? " " : ch)).join("");
}

/**
 * Check a Rego package name: dot separated identifiers. A schema id that holds
 * other characters has each of them replaced by an underscore.
 */
export function regoPackageName(name: string): string {
  const parts = String(name)
    .split(".")
    .map((p) => p.replace(/[^A-Za-z0-9_]/g, "_"))
    .map((p) => (p === "" || /^[0-9]/.test(p) || REGO_KEYWORDS.has(p) ? `p_${p}` : p));
  return parts.join(".");
}

/** A rule that always denies, for an invariant whose values cannot be read. */
function failClosed(pkg: string, inv: DomainInvariant, what: string): string {
  return `package ${pkg}

# ${commentText(inv.description)}
deny[msg] {
  msg := ${regoString(`Invariant ${inv.id}: ${what}; fail closed`)}
}`;
}

/** The string literals of an expression such as a == "x" and b == "y". */
function quotedLiterals(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    try {
      const v: unknown = JSON.parse(m[0]);
      if (typeof v === "string") out.push(v);
    } catch {
      return [];
    }
  }
  return out;
}

/** The JSON array that follows the last " in " of an expression. */
function arrayAfterIn(text: string): (string | number | boolean)[] | null {
  const at = text.lastIndexOf(" in [");
  if (at < 0) return null;
  try {
    const v: unknown = JSON.parse(text.slice(at + 4));
    if (!Array.isArray(v) || v.length === 0) return null;
    if (!v.every((x) => typeof x === "string" || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)))) {
      return null;
    }
    return v as (string | number | boolean)[];
  } catch {
    return null;
  }
}

/**
 * Generates Rego deny rules from detected invariants, MLE outliers
 * and spectral gap analysis.
 */
export class RegoGenerator {
  /** Generate a Rego deny rule from a domain invariant. */
  generateFromInvariant(
    invariant: DomainInvariant,
    _schemaId: string,
    packageName: string
  ): RegoRuleProposal {
    const pkg = regoPackageName(packageName);
    let generated: { source: string; closed: boolean };

    switch (invariant.invariantType) {
      case "equality":
        generated = this.generateEqualityRule(invariant, pkg);
        break;
      case "inequality":
        generated = this.generateInequalityRule(invariant, pkg);
        break;
      case "membership":
        generated = this.generateMembershipRule(invariant, pkg);
        break;
      case "exclusion":
        generated = this.generateExclusionRule(invariant, pkg);
        break;
      case "conditional":
        generated = this.generateConditionalRule(invariant, pkg);
        break;
      case "temporal":
        generated = this.generateTemporalRule(invariant, pkg);
        break;
      default:
        generated = this.generateGenericRule(invariant, pkg);
    }

    return {
      ruleId: `rule_${invariant.id}`,
      packageName: pkg,
      ruleSource: generated.source,
      invariantId: invariant.id,
      // A rule that fails closed proves nothing about the invariant.
      confidence: generated.closed ? 0 : 0.9,
      derivedFrom: "violation_pattern",
    };
  }

  /** Generate Rego rules from MLE outlier analysis. */
  generateFromMLEOutliers(
    mle: MLEEstimation,
    _schemaId: string,
    packageName: string
  ): RegoRuleProposal[] {
    const pkg = regoPackageName(packageName);
    const proposals: RegoRuleProposal[] = [];
    let ruleNum = 1;

    for (const field of mle.fields) {
      const ref = payloadRef(field.fieldName);
      const label = fmt(field.fieldName);

      if (field.fieldType === "numeric") {
        // The bounds are the observed range of the values. The confidence
        // interval of the mean bounds the mean, not a single value, so a rule
        // built on it would deny most of the values it learned from.
        if (
          field.mleMin !== undefined &&
          field.mleMax !== undefined &&
          Number.isFinite(field.mleMin) &&
          Number.isFinite(field.mleMax)
        ) {
          const lower = Math.floor(field.mleMin * 100) / 100;
          const upper = Math.ceil(field.mleMax * 100) / 100;
          const ruleSource = `package ${pkg}

deny[msg] {
  val := ${ref}
  val < ${lower}
  msg := sprintf(${regoString(`${label} value %v is below the observed minimum ${lower}`)}, [val])
}

deny[msg] {
  val := ${ref}
  val > ${upper}
  msg := sprintf(${regoString(`${label} value %v exceeds the observed maximum ${upper}`)}, [val])
}`;
          proposals.push({
            ruleId: `mle_numeric_${ruleNum++}`,
            packageName: pkg,
            ruleSource,
            invariantId: `mle_${field.fieldName}`,
            confidence: 0.85,
            derivedFrom: "mle",
          });
        }
      }

      if (field.fieldType === "enum" && field.mleEnum && field.mleEnum.length > 0) {
        const allowedSet = field.mleEnum.map((v) => regoString(v)).join(", ");
        const ruleSource = `package ${pkg}

deny[msg] {
  val := ${ref}
  allowed := {${allowedSet}}
  not allowed[val]
  msg := sprintf(${regoString(`${label} value '%v' not in observed values`)}, [val])
}`;
        proposals.push({
          ruleId: `mle_enum_${ruleNum++}`,
          packageName: pkg,
          ruleSource,
          invariantId: `mle_${field.fieldName}`,
          confidence: 0.9,
          derivedFrom: "mle",
        });
      }

      if (field.fieldType === "string" && field.mlePattern) {
        const ruleSource = `package ${pkg}

deny[msg] {
  val := ${ref}
  not regex.match(${regoString(field.mlePattern)}, val)
  msg := sprintf(${regoString(`${label} value '%v' does not match MLE-derived pattern`)}, [val])
}`;
        proposals.push({
          ruleId: `mle_string_${ruleNum++}`,
          packageName: pkg,
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
    _schemaId: string,
    packageName: string
  ): RegoRuleProposal[] {
    const pkg = regoPackageName(packageName);
    const proposals: RegoRuleProposal[] = [];
    let ruleNum = 1;

    for (const coupling of spectral.weakestCut.missingCouplings) {
      const parts = coupling.split(" <-> ");
      if (parts.length !== 2) continue;
      const [fieldA, fieldB] = parts;
      if (fieldA === undefined || fieldB === undefined) continue;
      const refA = payloadRef(fieldA);
      const refB = payloadRef(fieldB);
      const ruleSource = `package ${pkg}

# Generated from spectral gap analysis. Review before adoption.
# Fields ${commentText(fieldA)} and ${commentText(fieldB)} are in different constraint clusters
# with no cross-validation rule. Coupled fields must appear together.
deny[msg] {
  a := ${refA}
  not ${refB}
  a
  msg := sprintf(${regoString(`Spectral gap: ${fmt(fieldA)} is set (%v) but coupled field ${fmt(fieldB)} is missing`)}, [a])
}

deny[msg] {
  b := ${refB}
  not ${refA}
  b
  msg := sprintf(${regoString(`Spectral gap: ${fmt(fieldB)} is set (%v) but coupled field ${fmt(fieldA)} is missing`)}, [b])
}`;

      proposals.push({
        ruleId: `spectral_gap_${ruleNum++}`,
        packageName: pkg,
        ruleSource,
        invariantId: `spectral_${fieldA}_${fieldB}`,
        confidence: 0.5,
        derivedFrom: "spectral_gap",
      });
    }

    return proposals;
  }

  private twoFields(inv: DomainInvariant): [string, string] | null {
    const [a, b] = inv.fields;
    return a !== undefined && b !== undefined ? [a, b] : null;
  }

  private generateEqualityRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const pair = this.twoFields(inv);
    if (!pair) return { source: failClosed(pkg, inv, "an equality needs two fields"), closed: true };
    const [a, b] = pair;
    return {
      source: `package ${pkg}

deny[msg] {
  a := ${payloadRef(a)}
  b := ${payloadRef(b)}
  a != b
  msg := sprintf(${regoString(`Invariant violation: ${fmt(a)} (%v) must equal ${fmt(b)} (%v)`)}, [a, b])
}`,
      closed: false,
    };
  }

  private generateInequalityRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const pair = this.twoFields(inv);
    if (!pair) return { source: failClosed(pkg, inv, "an inequality needs two fields"), closed: true };
    const [a, b] = pair;
    return {
      source: `package ${pkg}

deny[msg] {
  a := ${payloadRef(a)}
  b := ${payloadRef(b)}
  a < b
  msg := sprintf(${regoString(`Invariant violation: ${fmt(a)} (%v) must be >= ${fmt(b)} (%v)`)}, [a, b])
}`,
      closed: false,
    };
  }

  private generateMembershipRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const field = inv.fields[0];
    const values = inv.values && inv.values.length > 0 ? inv.values : arrayAfterIn(inv.expression ?? "");
    if (field === undefined || !values) {
      return { source: failClosed(pkg, inv, "the allowed values of the membership are unknown"), closed: true };
    }
    return {
      source: `package ${pkg}

deny[msg] {
  val := ${payloadRef(field)}
  allowed := {${values.map(regoScalar).join(", ")}}
  not allowed[val]
  msg := sprintf(${regoString(`${fmt(field)} value '%v' is not a valid member`)}, [val])
}`,
      closed: false,
    };
  }

  private generateExclusionRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const pair = this.twoFields(inv);
    let excluded = inv.excludedPair;
    if (!excluded) {
      const lits = quotedLiterals(inv.expression ?? "");
      if (lits.length === 2 && lits[0] !== undefined && lits[1] !== undefined) excluded = [lits[0], lits[1]];
    }
    if (!pair || !excluded) {
      return { source: failClosed(pkg, inv, "the exclusion invariant expression could not be parsed"), closed: true };
    }
    const [a, b] = pair;
    const [va, vb] = excluded;
    return {
      source: `package ${pkg}

deny[msg] {
  ${payloadRef(a)} == ${regoString(va)}
  ${payloadRef(b)} == ${regoString(vb)}
  msg := ${regoString(`Forbidden co-occurrence: ${a}='${va}' with ${b}='${vb}'`)}
}`,
      closed: false,
    };
  }

  private generateConditionalRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const pair = this.twoFields(inv);
    let condition = inv.condition;
    let allowed = inv.values && inv.values.length > 0 ? inv.values : null;
    const expr = inv.expression ?? "";
    if (condition === undefined) {
      const head = expr.split(" then ")[0] ?? "";
      const lits = quotedLiterals(head);
      if (lits.length === 1) condition = lits[0];
    }
    if (!allowed) allowed = arrayAfterIn(expr);
    if (!pair || condition === undefined || !allowed) {
      return { source: failClosed(pkg, inv, "the conditional invariant expression could not be parsed"), closed: true };
    }
    const [condField, resultField] = pair;
    return {
      source: `package ${pkg}

deny[msg] {
  ${payloadRef(condField)} == ${regoString(condition)}
  val := ${payloadRef(resultField)}
  allowed := {${allowed.map(regoScalar).join(", ")}}
  not allowed[val]
  msg := sprintf(${regoString(`When ${fmt(condField)}='${fmt(condition)}', ${fmt(resultField)} must be in allowed set; got '%v'`)}, [val])
}`,
      closed: false,
    };
  }

  /** fields[0] is the earlier date and fields[1] the later one. */
  private generateTemporalRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    const pair = this.twoFields(inv);
    if (!pair) return { source: failClosed(pkg, inv, "a temporal invariant needs two fields"), closed: true };
    const [a, b] = pair;
    return {
      source: `package ${pkg}

deny[msg] {
  date_a := time.parse_rfc3339_ns(${payloadRef(a)})
  date_b := time.parse_rfc3339_ns(${payloadRef(b)})
  date_b < date_a
  msg := ${regoString(`Temporal invariant violation: ${b} must not be before ${a}`)}
}`,
      closed: false,
    };
  }

  private generateGenericRule(inv: DomainInvariant, pkg: string): { source: string; closed: boolean } {
    if (inv.fields.length === 0) {
      return { source: failClosed(pkg, inv, "the invariant names no field"), closed: true };
    }
    const blocks = inv.fields
      .map((field) =>
        [
          "deny[msg] {",
          `  not ${payloadRef(field)}`,
          `  msg := ${regoString(`Invariant ${inv.id}: required field ${field} is missing`)}`,
          "}",
        ].join("\n"),
      )
      .join("\n\n");

    const expressionNote = inv.expression ? `\n# Expression hint: ${commentText(inv.expression)}` : "";

    return {
      source: `package ${pkg}

# ${commentText(inv.description)}${expressionNote}
${blocks}`,
      closed: false,
    };
  }
}
