// Invariant Detector - detects domain invariants from data and schema
// Statistical analysis of field relationships to discover constraints

import type { SchemaCandidate } from "../../schema-builder/lib/types.js";
import type { DomainInvariant, InvariantManifest } from "./types.js";

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
   * @param schemaId Schema identifier
   * @returns Array of detected invariants above confidence threshold
   */
  detectFromData(data: Record<string, unknown>[], schemaId: string): DomainInvariant[] {
    if (data.length < 3) return [];

    const invariants: DomainInvariant[] = [];
    const fieldNames = this.getFieldNames(data);
    let nextId = 1;

    // Detect equality invariants (field pairs where values always match)
    for (let i = 0; i < fieldNames.length; i++) {
      for (let j = i + 1; j < fieldNames.length; j++) {
        const a = fieldNames[i];
        const b = fieldNames[j];
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
    }

    // Detect inequality invariants (f_a always >= f_b or f_b always >= f_a)
    const numericFields = fieldNames.filter(f =>
      data.every(r => r[f] === undefined || typeof r[f] === "number")
    );
    for (let i = 0; i < numericFields.length; i++) {
      for (let j = i + 1; j < numericFields.length; j++) {
        const a = numericFields[i];
        const b = numericFields[j];
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
        if (confBA >= this.confidenceThreshold && confAB < this.confidenceThreshold) {
          invariants.push({
            id: `inv_ineq_${nextId++}`,
            description: `${b} must be >= ${a}`,
            fields: [b, a],
            invariantType: "inequality",
            expression: `${b} >= ${a}`,
          });
        }
      }
    }

    // Detect membership invariants (field always in fixed set)
    for (const field of fieldNames) {
      const values = new Set(data.map(r => r[field]).filter(v => v !== undefined));
      if (values.size > 0 && values.size <= 20 && values.size < data.length * 0.5) {
        const allStrings = [...values].every(v => typeof v === "string");
        if (allStrings) {
          invariants.push({
            id: `inv_mem_${nextId++}`,
            description: `${field} must be one of: ${[...values].join(", ")}`,
            fields: [field],
            invariantType: "membership",
            expression: `${field} in [${[...values].map(v => `"${v}"`).join(", ")}]`,
          });
        }
      }
    }

    // Detect exclusion invariants (value pairs that never co-occur)
    const enumFields = fieldNames.filter(f => {
      const vals = new Set(data.map(r => r[f]).filter(v => v !== undefined));
      return vals.size <= 10 && vals.size > 1;
    });

    for (let i = 0; i < enumFields.length; i++) {
      for (let j = i + 1; j < enumFields.length; j++) {
        const a = enumFields[i];
        const b = enumFields[j];
        const exclusions = this.findExclusions(data, a, b);
        for (const [va, vb] of exclusions) {
          invariants.push({
            id: `inv_excl_${nextId++}`,
            description: `${a}="${va}" and ${b}="${vb}" never co-occur`,
            fields: [a, b],
            invariantType: "exclusion",
            expression: `not (${a} == "${va}" and ${b} == "${vb}")`,
          });
        }
      }
    }

    // Detect conditional invariants (if f_a == X then f_b always in Y)
    for (let i = 0; i < enumFields.length; i++) {
      for (let j = 0; j < fieldNames.length; j++) {
        if (enumFields[i] === fieldNames[j]) continue;
        const a = enumFields[i];
        const b = fieldNames[j];
        const conditionals = this.findConditionals(data, a, b);
        for (const { condition, consequent } of conditionals) {
          invariants.push({
            id: `inv_cond_${nextId++}`,
            description: `If ${a}="${condition}" then ${b} must be in {${consequent.join(", ")}}`,
            fields: [a, b],
            invariantType: "conditional",
            expression: `if ${a} == "${condition}" then ${b} in [${consequent.map(v => `"${v}"`).join(", ")}]`,
          });
        }
      }
    }

    // Detect temporal invariants (date fields always within range)
    const dateFields = fieldNames.filter(f =>
      data.some(r => typeof r[f] === "string" && /^\d{4}-\d{2}-\d{2}/.test(r[f] as string))
    );
    for (let i = 0; i < dateFields.length; i++) {
      for (let j = i + 1; j < dateFields.length; j++) {
        const a = dateFields[i];
        const b = dateFields[j];
        const temporal = this.checkTemporalRelation(data, a, b);
        if (temporal) {
          invariants.push({
            id: `inv_temp_${nextId++}`,
            description: temporal.description,
            fields: [a, b],
            invariantType: "temporal",
            expression: temporal.expression,
          });
        }
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
    const properties = (schema.definition.properties ?? {}) as Record<string, Record<string, unknown>>;

    // Extract membership invariants from enum constraints
    for (const [name, prop] of Object.entries(properties)) {
      if (prop.enum && Array.isArray(prop.enum)) {
        invariants.push({
          id: `covered_mem_${nextId++}`,
          description: `${name} constrained to enum values`,
          fields: [name],
          invariantType: "membership",
        });
      }
    }

    // Extract invariants from Rego deny rules
    for (const rule of regoRules) {
      const denyBlocks = rule.split(/(?=deny\[)/);
      for (const block of denyBlocks) {
        if (!block.startsWith("deny[") && !block.startsWith("deny ")) continue;

        const fields: string[] = [];
        const fieldMatches = block.matchAll(/(?:input\.payload\.|input\.|line\.)([a-zA-Z_][a-zA-Z0-9_]*)/g);
        for (const m of fieldMatches) {
          if (!fields.includes(m[1])) fields.push(m[1]);
        }

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
      const isCovered = coveredInvariants.some(ci =>
        ci.invariantType === inv.invariantType &&
        inv.fields.every(f => ci.fields.includes(f))
      );
      if (isCovered) {
        covered.push(inv);
      } else {
        missing.push(inv);
      }
    }

    return {
      covered,
      missing,
      coverageRate: manifest.invariants.length > 0
        ? covered.length / manifest.invariants.length
        : 1,
    };
  }

  private getFieldNames(data: Record<string, unknown>[]): string[] {
    const fields = new Set<string>();
    for (const record of data) {
      for (const key of Object.keys(record)) {
        fields.add(key);
      }
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
      const va = String(r[a] ?? "");
      const vb = String(r[b] ?? "");
      if (r[a] !== undefined && r[b] !== undefined) {
        allA.add(va);
        allB.add(vb);
        const key = `${va}|${vb}`;
        if (!coOccurrences.has(va)) coOccurrences.set(va, new Set());
        coOccurrences.get(va)!.add(vb);
      }
    }

    const exclusions: [string, string][] = [];
    for (const va of allA) {
      const seen = coOccurrences.get(va) ?? new Set();
      for (const vb of allB) {
        if (!seen.has(vb) && data.length > 10) {
          exclusions.push([va, vb]);
        }
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
        const key = String(cv);
        if (!groupedValues.has(key)) groupedValues.set(key, new Set());
        groupedValues.get(key)!.add(String(rv));
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

  private checkTemporalRelation(
    data: Record<string, unknown>[],
    a: string,
    b: string
  ): { description: string; expression: string } | null {
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

    const allPositive = diffs.every(d => d >= 0);
    const allNegative = diffs.every(d => d <= 0);
    const maxDiff = Math.max(...diffs.map(Math.abs));

    if (allPositive) {
      return {
        description: `${b} is always on or after ${a} (max ${Math.round(maxDiff)} days)`,
        expression: `date(${b}) >= date(${a})`,
      };
    }

    if (allNegative) {
      return {
        description: `${a} is always on or after ${b} (max ${Math.round(maxDiff)} days)`,
        expression: `date(${a}) >= date(${b})`,
      };
    }

    return null;
  }
}
