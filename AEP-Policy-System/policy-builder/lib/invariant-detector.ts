// Invariant Detector - detects domain invariants from data and schema
// Statistical analysis of field relationships to discover constraints

import type { SchemaCandidate } from "../../schema-builder/lib/types.js";
import { fieldsOfBlock, splitDenyBlocks } from "../../schema-builder/lib/constraint-graph.js";
import type { DomainInvariant, InvariantManifest } from "./types.js";

/**
 * The text of a data value for grouping. A string stays as it is and any
 * other value is written as JSON, so two different objects never share a key.
 */
function valueKey(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return JSON.stringify(v) ?? "undefined";
}

/** Every unordered pair of distinct items, in list order. */
function pairs<T>(items: readonly T[]): [T, T][] {
  const out: [T, T][] = [];
  items.forEach((a, i) => {
    for (const b of items.slice(i + 1)) out.push([a, b]);
  });
  return out;
}

/**
 * Detects domain invariants from data patterns and existing schema/policy.
 */
export class InvariantDetector {
  private confidenceThreshold: number;

  constructor(confidenceThreshold = 0.8) {
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Detect invariants from observed data.
   * @param data Array of records to analyze
   * @param _schemaId Schema identifier
   * @returns Array of detected invariants above confidence threshold
   */
  detectFromData(data: Record<string, unknown>[], _schemaId: string): DomainInvariant[] {
    if (data.length < 3) return [];

    const invariants: DomainInvariant[] = [];
    const fieldNames = this.getFieldNames(data);
    let nextId = 1;

    // Equality invariants (field pairs where values always match)
    for (const [a, b] of pairs(fieldNames)) {
      const confidence = this.checkEquality(data, a, b);
      if (confidence >= this.confidenceThreshold) {
        invariants.push({
          id: `inv_eq_${nextId++}`,
          description: `${a} must equal ${b}`,
          fields: [a, b],
          invariantType: "equality",
          expression: `${a} == ${b}`,
        });
      }
    }

    // Inequality invariants (f_a always >= f_b or f_b always >= f_a)
    const numericFields = fieldNames.filter((f) =>
      data.every((r) => r[f] === undefined || typeof r[f] === "number"),
    );
    for (const [a, b] of pairs(numericFields)) {
      const confAB = this.checkInequality(data, a, b);
      if (confAB >= this.confidenceThreshold) {
        invariants.push({
          id: `inv_ineq_${nextId++}`,
          description: `${a} must be >= ${b}`,
          fields: [a, b],
          invariantType: "inequality",
          expression: `${a} >= ${b}`,
        });
      }
      const confBA = this.checkInequality(data, b, a);
      // M-50: emit BA independently when supported by data
      if (confBA >= this.confidenceThreshold) {
        invariants.push({
          id: `inv_ineq_${nextId++}`,
          description: `${b} must be >= ${a}`,
          fields: [b, a],
          invariantType: "inequality",
          expression: `${b} >= ${a}`,
        });
      }
    }

    // Membership invariants (field always in fixed set)
    for (const field of fieldNames) {
      const values = new Set(data.map((r) => r[field]).filter((v) => v !== undefined));
      // M-41: skip single-value membership (not a meaningful set constraint)
      if (values.size >= 2 && values.size <= 20 && values.size < data.length * 0.5) {
        const strings = [...values].filter((v): v is string => typeof v === "string");
        if (strings.length === values.size) {
          invariants.push({
            id: `inv_mem_${nextId++}`,
            description: `${field} must be one of: ${strings.join(", ")}`,
            fields: [field],
            invariantType: "membership",
            expression: `${field} in ${JSON.stringify(strings)}`,
            values: strings,
          });
        }
      }
    }

    // Exclusion invariants (value pairs that never co-occur)
    const enumFields = fieldNames.filter((f) => {
      const vals = new Set(data.map((r) => r[f]).filter((v) => v !== undefined));
      return vals.size <= 10 && vals.size > 1;
    });

    for (const [a, b] of pairs(enumFields)) {
      for (const [va, vb] of this.findExclusions(data, a, b)) {
        invariants.push({
          id: `inv_excl_${nextId++}`,
          description: `${a}="${va}" and ${b}="${vb}" never co-occur`,
          fields: [a, b],
          invariantType: "exclusion",
          expression: `not (${a} == ${JSON.stringify(va)} and ${b} == ${JSON.stringify(vb)})`,
          excludedPair: [va, vb],
        });
      }
    }

    // Conditional invariants (if f_a == X then f_b always in Y)
    for (const a of enumFields) {
      for (const b of fieldNames) {
        if (a === b) continue;
        for (const { condition, consequent } of this.findConditionals(data, a, b)) {
          invariants.push({
            id: `inv_cond_${nextId++}`,
            description: `If ${a}="${condition}" then ${b} must be in {${consequent.join(", ")}}`,
            fields: [a, b],
            invariantType: "conditional",
            expression: `if ${a} == ${JSON.stringify(condition)} then ${b} in ${JSON.stringify(consequent)}`,
            condition,
            values: consequent,
          });
        }
      }
    }

    // Temporal invariants (one date field always on or after the other)
    const dateFields = fieldNames.filter((f) =>
      data.some((r) => {
        const v = r[f];
        return typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
      }),
    );
    for (const [a, b] of pairs(dateFields)) {
      const temporal = this.checkTemporalRelation(data, a, b);
      if (temporal) {
        invariants.push({
          id: `inv_temp_${nextId++}`,
          description: temporal.description,
          // The earlier field comes first, as the Rego generator reads it.
          fields: temporal.fields,
          invariantType: "temporal",
          expression: temporal.expression,
        });
      }
    }

    return invariants;
  }

  /**
   * Detect invariants already covered by existing schema and Rego rules.
   */
  detectFromSchema(schema: SchemaCandidate, regoRules: string[]): DomainInvariant[] {
    const invariants: DomainInvariant[] = [];
    let nextId = 1;
    const rawProps = schema.definition.properties;
    const properties =
      rawProps !== null && typeof rawProps === "object" && !Array.isArray(rawProps)
        ? (rawProps as Record<string, unknown>)
        : {};

    // Membership invariants from enum constraints
    for (const [name, prop] of Object.entries(properties)) {
      if (prop !== null && typeof prop === "object" && Array.isArray((prop as { enum?: unknown }).enum)) {
        invariants.push({
          id: `covered_mem_${nextId++}`,
          description: `${name} constrained to enum values`,
          fields: [name],
          invariantType: "membership",
        });
      }
    }

    // Invariants from Rego deny rules
    for (const rule of regoRules) {
      for (const block of splitDenyBlocks(rule)) {
        const fields = fieldsOfBlock(block, false);
        if (fields.length >= 2) {
          // Detect type from rule content
          let itype: DomainInvariant["invariantType"] = "equality";
          if (block.includes("!=") || block.includes("not ")) itype = "exclusion";
          if (block.includes(">=") || block.includes("<=") || block.includes(">") || block.includes("<")) itype = "inequality";

          invariants.push({
            id: `covered_rego_${nextId++}`,
            description: `Rego rule constrains ${fields.join(", ")}`,
            fields,
            invariantType: itype,
          });
        }
      }
    }

    return invariants;
  }

  /**
   * Compute coverage of a manifest against detected invariants.
   */
  computeCoverage(
    manifest: InvariantManifest,
    coveredInvariants: DomainInvariant[]
  ): { covered: DomainInvariant[]; missing: DomainInvariant[]; coverageRate: number } {
    const covered: DomainInvariant[] = [];
    const missing: DomainInvariant[] = [];

    for (const inv of manifest.invariants) {
      const isCovered = coveredInvariants.some(
        (ci) => ci.invariantType === inv.invariantType && inv.fields.every((f) => ci.fields.includes(f)),
      );
      if (isCovered) covered.push(inv);
      else missing.push(inv);
    }

    return {
      covered,
      missing,
      coverageRate: manifest.invariants.length > 0 ? covered.length / manifest.invariants.length : 1,
    };
  }

  private getFieldNames(data: Record<string, unknown>[]): string[] {
    const fields = new Set<string>();
    for (const record of data) {
      for (const key of Object.keys(record)) fields.add(key);
    }
    return [...fields].sort();
  }

  private checkEquality(data: Record<string, unknown>[], a: string, b: string): number {
    let matches = 0;
    let total = 0;
    for (const r of data) {
      if (r[a] !== undefined && r[b] !== undefined) {
        total++;
        if (r[a] === r[b]) matches++;
      }
    }
    return total > 0 ? matches / total : 0;
  }

  private checkInequality(data: Record<string, unknown>[], a: string, b: string): number {
    let matches = 0;
    let total = 0;
    for (const r of data) {
      const va = r[a];
      const vb = r[b];
      if (typeof va === "number" && typeof vb === "number") {
        total++;
        if (va >= vb) matches++;
      }
    }
    return total > 0 ? matches / total : 0;
  }

  private findExclusions(data: Record<string, unknown>[], a: string, b: string): [string, string][] {
    const coOccurrences = new Map<string, Set<string>>();
    const allA = new Set<string>();
    const allB = new Set<string>();

    for (const r of data) {
      if (r[a] === undefined || r[b] === undefined) continue;
      const va = valueKey(r[a]);
      const vb = valueKey(r[b]);
      allA.add(va);
      allB.add(vb);
      const seen = coOccurrences.get(va) ?? new Set<string>();
      seen.add(vb);
      coOccurrences.set(va, seen);
    }

    const exclusions: [string, string][] = [];
    if (data.length <= 10) return exclusions;
    for (const va of allA) {
      const seen = coOccurrences.get(va) ?? new Set<string>();
      for (const vb of allB) {
        if (!seen.has(vb)) exclusions.push([va, vb]);
      }
    }
    return exclusions.slice(0, 5); // Limit to top 5
  }

  private findConditionals(
    data: Record<string, unknown>[],
    condField: string,
    resultField: string
  ): { condition: string; consequent: string[] }[] {
    const groupedValues = new Map<string, Set<string>>();

    for (const r of data) {
      const cv = r[condField];
      const rv = r[resultField];
      if (cv !== undefined && rv !== undefined) {
        const key = valueKey(cv);
        const group = groupedValues.get(key) ?? new Set<string>();
        group.add(valueKey(rv));
        groupedValues.set(key, group);
      }
    }

    const results: { condition: string; consequent: string[] }[] = [];
    for (const [condition, values] of groupedValues) {
      // Only report if the consequent set is restrictive
      if (values.size <= 3 && values.size < data.length * 0.3) {
        results.push({ condition, consequent: [...values] });
      }
    }
    return results;
  }

  /**
   * The order of two date fields when the data always keeps it. fields names
   * the earlier field first.
   */
  private checkTemporalRelation(
    data: Record<string, unknown>[],
    a: string,
    b: string
  ): { description: string; expression: string; fields: [string, string] } | null {
    const diffs: number[] = [];

    for (const r of data) {
      const da = r[a];
      const db = r[b];
      if (typeof da === "string" && typeof db === "string") {
        const ta = Date.parse(da);
        const tb = Date.parse(db);
        if (!isNaN(ta) && !isNaN(tb)) {
          diffs.push((tb - ta) / (1000 * 60 * 60 * 24)); // days
        }
      }
    }

    if (diffs.length < 3) return null;

    const allPositive = diffs.every((d) => d >= 0);
    const allNegative = diffs.every((d) => d <= 0);
    const maxDiff = Math.max(...diffs.map(Math.abs));

    if (allPositive) {
      return {
        description: `${b} is always on or after ${a} (max ${Math.round(maxDiff)} days)`,
        expression: `date(${b}) >= date(${a})`,
        fields: [a, b],
      };
    }

    if (allNegative) {
      return {
        description: `${a} is always on or after ${b} (max ${Math.round(maxDiff)} days)`,
        expression: `date(${a}) >= date(${b})`,
        fields: [b, a],
      };
    }

    return null;
  }
}
