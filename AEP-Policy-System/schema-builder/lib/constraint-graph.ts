// Constraint graph - the one builder of the field coupling graph that the
// spectral analyzer and the module detector both read.

import type { SchemaCandidate } from "./types.js";

/** Fields that one Rego deny rule reads. */
export interface FieldReference {
  ruleId: string;
  fields: string[];
}

/** A dense square matrix of numbers with checked indices. */
export class SquareMatrix {
  readonly size: number;
  private readonly cells: Float64Array;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError(`matrix size must be a non-negative integer, got ${size}`);
    }
    this.size = size;
    this.cells = new Float64Array(size * size);
  }

  private offset(i: number, j: number): number {
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= this.size || j >= this.size) {
      throw new RangeError(`index (${i}, ${j}) is outside a ${this.size} by ${this.size} matrix`);
    }
    return i * this.size + j;
  }

  get(i: number, j: number): number {
    return this.cells[this.offset(i, j)] ?? 0;
  }

  set(i: number, j: number, value: number): void {
    this.cells[this.offset(i, j)] = value;
  }

  add(i: number, j: number, value: number): void {
    const o = this.offset(i, j);
    this.cells[o] = (this.cells[o] ?? 0) + value;
  }

  clone(): SquareMatrix {
    const copy = new SquareMatrix(this.size);
    copy.cells.set(this.cells);
    return copy;
  }

  /** Sum of row i. */
  rowSum(i: number): number {
    let s = 0;
    for (let j = 0; j < this.size; j++) s += this.get(i, j);
    return s;
  }
}

/** Matches input.payload.x, input.x and line.x. */
const DOTTED_FIELD = /(?:input\.payload\.|input\.(?!payload\b)|line\.)([a-zA-Z_][a-zA-Z0-9_]*)/g;
/** Matches data.x, which the spectral and module analyses also count. */
const DATA_FIELD = /data\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
/** Matches input.payload["x"], the form the Rego generator uses for other names. */
const BRACKET_FIELD = /input\.payload\[("(?:[^"\\]|\\.)*")\]/g;

/**
 * Split Rego source into deny rules. A rule starts at a line that opens with
 * deny, which covers deny[msg] and the Rego v1 form deny contains msg if.
 * Text before the first rule is dropped.
 */
export function splitDenyBlocks(regoSource: string): string[] {
  return regoSource.split(/(?=^deny\b)/m).filter((b) => /^deny\b/.test(b));
}

/** The fields one deny rule reads, in order of first use. */
export function fieldsOfBlock(block: string, includeData: boolean): string[] {
  const found: { at: number; name: string }[] = [];
  for (const match of block.matchAll(DOTTED_FIELD)) {
    if (match[1] !== undefined) found.push({ at: match.index, name: match[1] });
  }
  if (includeData) {
    for (const match of block.matchAll(DATA_FIELD)) {
      if (match[1] !== undefined) found.push({ at: match.index, name: match[1] });
    }
  }
  for (const match of block.matchAll(BRACKET_FIELD)) {
    if (match[1] === undefined) continue;
    try {
      const name: unknown = JSON.parse(match[1]);
      if (typeof name === "string") found.push({ at: match.index, name });
    } catch {
      // A literal JSON cannot read is not a field name.
    }
  }
  found.sort((x, y) => x.at - y.at);
  return [...new Set(found.map((f) => f.name))];
}

/** Parse Rego source to extract the fields each deny rule reads. */
export function parseRegoForFieldReferences(regoSource: string): FieldReference[] {
  const refs: FieldReference[] = [];
  splitDenyBlocks(regoSource).forEach((block, i) => {
    const fields = fieldsOfBlock(block, true);
    if (fields.length > 0) refs.push({ ruleId: `deny_${i}`, fields });
  });
  return refs;
}

/** The field names a schema declares, in declaration order. */
export function schemaFieldNames(schema: SchemaCandidate): string[] {
  const properties = schema.definition.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.keys(properties);
}

/** The required list of a schema, keeping string entries only. */
export function schemaRequired(schema: SchemaCandidate): string[] {
  const required = schema.definition.required;
  if (!Array.isArray(required)) return [];
  return required.filter((r): r is string => typeof r === "string");
}

/** Weight of an edge that two fields share by being required together. */
export const REQUIRED_EDGE_WEIGHT = 0.4;
/** Weight of an edge that two fields share by appearing in one deny rule. */
export const RULE_EDGE_WEIGHT = 1.0;

export interface ConstraintGraph {
  fieldNames: string[];
  fieldIndex: Map<string, number>;
  adjacency: SquareMatrix;
}

/**
 * Build the weighted coupling graph: one edge of weight 1 per deny rule that
 * reads both fields and one of weight 0.4 when both fields are required.
 */
export function buildConstraintGraph(schema: SchemaCandidate, regoRules: string[]): ConstraintGraph {
  const fieldNames = schemaFieldNames(schema);
  const fieldIndex = new Map(fieldNames.map((f, i) => [f, i]));
  const adjacency = new SquareMatrix(fieldNames.length);

  const link = (indices: number[], weight: number): void => {
    const unique = [...new Set(indices)];
    for (let a = 0; a < unique.length; a++) {
      for (let b = a + 1; b < unique.length; b++) {
        const i = unique[a];
        const j = unique[b];
        if (i === undefined || j === undefined) continue;
        adjacency.add(i, j, weight);
        adjacency.add(j, i, weight);
      }
    }
  };

  for (const ref of parseRegoForFieldReferences(regoRules.join("\n"))) {
    link(
      ref.fields.map((f) => fieldIndex.get(f)).filter((i): i is number => i !== undefined),
      RULE_EDGE_WEIGHT,
    );
  }

  const required = schemaRequired(schema);
  if (required.length > 1) {
    link(
      required.map((f) => fieldIndex.get(f)).filter((i): i is number => i !== undefined),
      REQUIRED_EDGE_WEIGHT,
    );
  }

  return { fieldNames, fieldIndex, adjacency };
}
