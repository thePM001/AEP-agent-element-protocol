import { describe, expect, it } from "vitest";
import {
  SquareMatrix,
  buildConstraintGraph,
  parseRegoForFieldReferences,
} from "../lib/constraint-graph.js";
import { SpectralAnalyzer, symmetricEigen } from "../lib/spectral-analyzer.js";
import { ModuleDetector } from "../lib/module-detector.js";
import { MLEEstimator } from "../lib/mle-estimator.js";
import { PermissivenessScorer } from "../lib/permissiveness-scorer.js";
import { SchemaBuilder } from "../lib/schema-builder.js";
import type { SchemaCandidate } from "../lib/types.js";

function schema(fields: string[], extra: Record<string, unknown> = {}): SchemaCandidate {
  return {
    schemaId: "s1",
    domain: "orders",
    definition: { type: "object", properties: Object.fromEntries(fields.map((f) => [f, { type: "number" }])), ...extra },
    source: "human",
  };
}

/** One deny rule that reads the two fields. */
function rule(a: string, b: string): string {
  return `deny[msg] {\n  input.payload.${a} > input.payload.${b}\n  msg := "x"\n}`;
}

describe("constraint graph", () => {
  it("a matrix refuses an index outside its size", () => {
    const m = new SquareMatrix(2);
    m.set(1, 1, 3);
    m.add(1, 1, 2);
    expect(m.get(1, 1)).toBe(5);
    expect(() => m.get(2, 0)).toThrow(RangeError);
    expect(() => m.set(-1, 0, 1)).toThrow(RangeError);
    expect(() => new SquareMatrix(-1)).toThrow(RangeError);
  });

  it("reads the fields of deny[ rules, Rego v1 rules and bracketed names", () => {
    const src = [
      "package p",
      "deny[msg] {",
      "  input.payload.a == input.payload.b",
      "}",
      "deny contains msg if {",
      '  input.payload["odd name"] == 1',
      "  input.c > 0",
      "}",
    ].join("\n");
    const refs = parseRegoForFieldReferences(src);
    expect(refs.map((r) => r.fields)).toEqual([["a", "b"], ["odd name", "c"]]);
  });

  it("never reads payload itself as a field of a bracketed reference", () => {
    const refs = parseRegoForFieldReferences('deny[msg] {\n  input.payload["x"] == 1\n}');
    expect(refs[0]?.fields).toEqual(["x"]);
  });

  it("a field named twice in one rule adds no self loop", () => {
    const g = buildConstraintGraph(schema(["a", "b"]), ["deny[msg] {\n  input.payload.a == input.payload.a\n  input.payload.b\n}"]);
    expect(g.adjacency.get(0, 0)).toBe(0);
    expect(g.adjacency.get(0, 1)).toBe(1);
  });

  it("a schema without a properties object has no fields", () => {
    const s: SchemaCandidate = { schemaId: "x", domain: "d", definition: { properties: ["a"] }, source: "human" };
    expect(buildConstraintGraph(s, []).fieldNames).toEqual([]);
  });
});

describe("symmetric eigen system", () => {
  it("finds the eigenvalues and unit eigenvectors of a symmetric matrix", () => {
    const m = new SquareMatrix(3);
    const values = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    values.forEach((row, i) => row.forEach((v, j) => m.set(i, j, v)));
    const eig = symmetricEigen(m);
    expect(eig.values).toHaveLength(3);
    for (let k = 0; k < 3; k++) {
      const lambda = eig.values[k] ?? NaN;
      const vec = eig.vectors[k] ?? [];
      const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 9);
      for (let i = 0; i < 3; i++) {
        let av = 0;
        for (let j = 0; j < 3; j++) av += m.get(i, j) * (vec[j] ?? 0);
        expect(av).toBeCloseTo(lambda * (vec[i] ?? 0), 9);
      }
    }
    expect(eig.values[0]).toBeLessThanOrEqual(eig.values[1] ?? 0);
    expect(eig.values[1]).toBeLessThanOrEqual(eig.values[2] ?? 0);
  });
});

describe("spectral analyzer", () => {
  it("cuts a graph of two tight pairs at their one weak link", () => {
    const rules = [rule("a", "b"), rule("a", "b"), rule("a", "b"), rule("c", "d"), rule("c", "d"), rule("c", "d"), rule("b", "c")];
    const r = new SpectralAnalyzer().analyze(schema(["a", "b", "c", "d"]), rules);
    const sides = [r.weakestCut.clusterA.slice().sort(), r.weakestCut.clusterB.slice().sort()].sort();
    expect(sides).toEqual([["a", "b"], ["c", "d"]]);
    expect(r.fiedlerValue).toBeGreaterThan(0);
    expect(r.weakestCut.missingCouplings).toEqual(expect.arrayContaining(["a <-> c"]));
    expect(r.weakestCut.missingCouplings).not.toContain("b <-> c");
  });

  it("reports a Fiedler value of zero for a disconnected graph", () => {
    const r = new SpectralAnalyzer().analyze(schema(["a", "b", "c"]), [rule("a", "b")]);
    expect(r.fiedlerValue).toBe(0);
    expect(r.eigenvalues[0]).toBeCloseTo(0, 6);
  });

  it("handles one field and no field", () => {
    expect(new SpectralAnalyzer().analyze(schema(["a"]), []).eigenvalues).toEqual([0]);
    expect(new SpectralAnalyzer().analyze(schema([]), []).eigenvalues).toEqual([]);
  });

  it("couples required fields", () => {
    const r = new SpectralAnalyzer().analyze(schema(["a", "b"], { required: ["a", "b"] }), []);
    expect(r.fiedlerValue).toBeCloseTo(0.8, 3);
  });
});

describe("module detector", () => {
  it("splits two unconnected cliques into two modules with a gap", () => {
    const rules = [rule("a", "b"), rule("b", "c"), rule("a", "c"), rule("d", "e"), rule("e", "f"), rule("d", "f")];
    const r = new ModuleDetector().analyze(schema(["a", "b", "c", "d", "e", "f"]), rules);
    expect(r.modules.map((m) => m.fields.slice().sort())).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
    expect(r.modularityScore).toBeCloseTo(0.5, 3);
    expect(r.interModuleGaps).toHaveLength(1);
  });

  it("gives every field its own module when no rule couples them", () => {
    const r = new ModuleDetector().analyze(schema(["a", "b"]), []);
    expect(r.modules).toHaveLength(2);
    expect(r.modularityScore).toBe(0);
  });

  it("keeps a fully coupled triangle in one module", () => {
    const r = new ModuleDetector().analyze(schema(["a", "b", "c"]), [rule("a", "b"), rule("b", "c"), rule("a", "c")]);
    expect(r.modules).toHaveLength(1);
    expect(r.interModuleGaps).toEqual([]);
  });
});

describe("MLE estimator", () => {
  const est = new MLEEstimator();

  it("estimates numeric bounds, mean and sample variance", () => {
    const data = [1, 2, 3, 4, 5].map((x) => ({ x }));
    const f = est.estimateFromData(data, "d", "s").fields[0];
    expect(f?.mleMin).toBe(1);
    expect(f?.mleMax).toBe(5);
    expect(f?.mleMean).toBeCloseTo(3, 12);
    expect(f?.mleVariance).toBeCloseTo(2.5, 12);
    expect(f?.confidenceIntervalLower).toBeLessThan(3);
    expect(f?.confidenceIntervalUpper).toBeGreaterThan(3);
  });

  it("an online update equals the batch estimate and leaves its input unchanged", () => {
    const first = est.estimateFromData([{ x: 1 }, { x: 4 }, { x: 9 }], "d", "s");
    const before = JSON.stringify(first);
    const updated = est.updateEstimation(first, { x: 16 });
    const batch = est.estimateFromData([{ x: 1 }, { x: 4 }, { x: 9 }, { x: 16 }], "d", "s");
    expect(JSON.stringify(first)).toBe(before);
    const u = updated.fields[0];
    const b = batch.fields[0];
    expect(u?.mleVariance).toBeCloseTo(b?.mleVariance ?? NaN, 9);
    expect(u?.mleMean).toBeCloseTo(b?.mleMean ?? NaN, 9);
    expect(u?.confidenceIntervalUpper).toBeCloseTo(b?.confidenceIntervalUpper ?? NaN, 9);
  });

  it("keeps the enum distribution a set of shares that sums to one", () => {
    const data = Array.from({ length: 30 }, (_, i) => ({ k: i % 3 === 0 ? "a" : "b" }));
    const first = est.estimateFromData(data, "d", "s");
    expect(first.fields[0]?.fieldType).toBe("enum");
    const enumBefore = [...(first.fields[0]?.mleEnum ?? [])];
    const updated = est.updateEstimation(first, { k: "c" });
    const dist = updated.fields[0]?.mleDistribution ?? {};
    const total = Object.values(dist).reduce((s, x) => s + x, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(dist.c).toBeCloseTo(1 / 31, 12);
    expect(first.fields[0]?.mleEnum).toEqual(enumBefore);
    expect(updated.fields[0]?.mleEnum).toContain("c");
  });

  it("derives a pattern that accepts every value it learned from", () => {
    const cases = [["a_b", "c-d"], ["", "abc", "abd"], ["x1", "y22", "z"], ["A b", "c.D"]];
    for (const values of cases) {
      const f = est.estimateFromData(values.map((v) => ({ s: v })), "d", "s").fields[0];
      const re = new RegExp(f?.mlePattern ?? "^$");
      for (const v of values) expect(re.test(v), `${f?.mlePattern} on ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("flags a schema bound far wider than the data and proposes a tighter one", () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ n: i + 1 }));
    const mle = est.estimateFromData(data, "d", "s");
    const wide: SchemaCandidate = { schemaId: "s", domain: "d", definition: { properties: { n: { type: "number", minimum: 0, maximum: 1000 } } }, source: "llm" };
    const report = est.computeDivergence(wide, mle);
    expect(report.criticalCount).toBe(1);
    const proposals = est.proposeTightening(wide, mle);
    expect(proposals[0]?.proposedConstraint).toEqual({ maximum: 10.5 });
  });

  it("returns an empty estimation for no data", () => {
    expect(est.estimateFromData([], "d", "s").fields).toEqual([]);
  });
});

describe("permissiveness scorer", () => {
  it("names an open object as a weaker constraint than a bounded string", () => {
    const s: SchemaCandidate = {
      schemaId: "s",
      domain: "d",
      definition: { properties: { blob: { type: "object" }, name: { type: "string", maxLength: 20 }, ok: { type: "boolean" } } },
      source: "human",
    };
    const r = new PermissivenessScorer().analyze(s);
    expect(r.weakestConstraints[0]).toBe("blob");
    expect(r.principalComponents[0]?.fieldName).toBe("blob");
  });

  it("counts a boolean as one bit and an empty schema as zero", () => {
    const one: SchemaCandidate = { schemaId: "s", domain: "d", definition: { properties: { ok: { type: "boolean" } } }, source: "human" };
    expect(new PermissivenessScorer().analyze(one).entropy).toBe(1);
    expect(new PermissivenessScorer().analyze(schema([])).entropy).toBe(0);
  });
});

describe("schema builder", () => {
  const data = Array.from({ length: 40 }, (_, i) => ({ id: i, status: i % 2 ? "open" : "closed", note: `n${i}` }));

  it("builds a closed schema from data", () => {
    const built = new SchemaBuilder().buildFromData(data, "orders", "o1");
    expect(built.definition.additionalProperties).toBe(false);
    expect(built.definition.required).toEqual(["id", "status", "note"]);
    const props = built.definition.properties as Record<string, Record<string, unknown>>;
    expect(props.id?.type).toBe("integer");
    expect(props.status?.enum).toEqual(expect.arrayContaining(["open", "closed"]));
  });

  it("scores a schema built from data above a loose one and counts both", () => {
    const b = new SchemaBuilder();
    const tight = b.buildFromData(data, "orders", "tight");
    const loose: SchemaCandidate = {
      schemaId: "loose",
      domain: "orders",
      definition: { properties: { id: { type: "number", minimum: -1e9, maximum: 1e9 }, status: { type: "string" }, note: { type: "string" } } },
      source: "llm",
    };
    const ranked = b.compareSchemas([loose, tight], { historicalData: data });
    expect(ranked.best.schemaId).toBe("tight");
    expect(b.getStats().totalValidated).toBe(2);
  });

  it("refuses to compare no candidate", () => {
    expect(() => new SchemaBuilder().compareSchemas([])).toThrow(/at least one candidate/);
  });

  it("always returns a decision and at least one diagnostic", () => {
    const r = new SchemaBuilder().validateSchema(schema(["a", "b"]));
    expect(["pass", "review", "reject"]).toContain(r.decision);
    expect(r.diagnostics.length).toBeGreaterThan(0);
  });
});
