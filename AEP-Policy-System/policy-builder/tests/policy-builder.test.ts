import { describe, expect, it } from "vitest";
import {
  RegoGenerator,
  payloadRef,
  regoPackageName,
  regoScalar,
  regoString,
} from "../lib/rego-generator.js";
import { InvariantDetector } from "../lib/invariant-detector.js";
import { PolicyBuilder } from "../lib/policy-builder.js";
import type { DomainInvariant } from "../lib/types.js";
import type { MLEEstimation, SchemaCandidate, SpectralAnalysis } from "../../schema-builder/lib/types.js";
import { parseRegoForFieldReferences } from "../../schema-builder/lib/constraint-graph.js";

const gen = new RegoGenerator();

/** The deny rule heads of a Rego source, which is how many rules it holds. */
function denyCount(src: string): number {
  return src.split("\n").filter((l) => /^deny\b/.test(l)).length;
}

/** The lines of a source that are not inside a string literal: none may start a rule a value wrote. */
function ruleLines(src: string): string[] {
  return src.split("\n").filter((l) => /^(deny|allow|default|package|import)\b/.test(l));
}

describe("Rego literals", () => {
  it("quotes a string with the JSON escapes", () => {
    expect(regoString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
  });

  it("references a plain field with a dot and any other name with a quoted bracket", () => {
    expect(payloadRef("amount")).toBe("input.payload.amount");
    expect(payloadRef("not")).toBe('input.payload["not"]');
    expect(payloadRef('x"]\ndeny[m] {')).toBe('input.payload["x\\"]\\ndeny[m] {"]');
  });

  it("refuses a number Rego cannot hold", () => {
    expect(regoScalar(3)).toBe("3");
    expect(regoScalar(true)).toBe("true");
    expect(() => regoScalar(Infinity)).toThrow(RangeError);
    expect(() => regoScalar(NaN)).toThrow(RangeError);
  });

  it("turns a schema id into a valid package path", () => {
    expect(regoPackageName("aep.schema.orders-v1")).toBe("aep.schema.orders_v1");
    expect(regoPackageName("aep.schema.9x")).toBe("aep.schema.p_9x");
    expect(regoPackageName("aep.schema.a\ndeny")).toBe("aep.schema.a_deny");
  });
});

describe("Rego generator against hostile names and values", () => {
  const hostileField = 'amt"]\n}\nallow { true }\ndeny[msg] { input.payload["x';

  it("a field name cannot add a rule to an equality rule", () => {
    const inv: DomainInvariant = { id: "e1", description: "d", fields: [hostileField, "b"], invariantType: "equality" };
    const p = gen.generateFromInvariant(inv, "s", "aep.schema.s");
    expect(denyCount(p.ruleSource)).toBe(1);
    expect(ruleLines(p.ruleSource)).toEqual(["package aep.schema.s", "deny[msg] {"]);
    expect(parseRegoForFieldReferences(p.ruleSource)[0]?.fields).toEqual([hostileField, "b"]);
  });

  it("a member value cannot widen the allowed set", () => {
    const value = 'ok"} \n allowed := {x | x := input.payload.k';
    const inv: DomainInvariant = { id: "m1", description: "d", fields: ["k"], invariantType: "membership", values: ["a", value] };
    const p = gen.generateFromInvariant(inv, "s", "pkg");
    expect(p.ruleSource).toContain(`allowed := {"a", ${JSON.stringify(value)}}`);
    expect(p.confidence).toBe(0.9);
    expect(ruleLines(p.ruleSource)).toHaveLength(2);
  });

  it("reads the values of a membership expression as JSON and fails closed when it cannot", () => {
    const parsed = gen.generateFromInvariant(
      { id: "m2", description: "d", fields: ["k"], invariantType: "membership", expression: 'k in ["x", "y"]' },
      "s",
      "pkg",
    );
    expect(parsed.ruleSource).toContain('allowed := {"x", "y"}');
    const broken = gen.generateFromInvariant(
      { id: "m3", description: "d", fields: ["k"], invariantType: "membership", expression: "k in [x, y" },
      "s",
      "pkg",
    );
    expect(broken.confidence).toBe(0);
    expect(broken.ruleSource).toContain("fail closed");
    expect(broken.ruleSource).not.toContain("value1");
  });

  it("builds an exclusion for field names with dots and hyphens", () => {
    const p = gen.generateFromInvariant(
      { id: "x1", description: "d", fields: ["a.b", "c-d"], invariantType: "exclusion", expression: 'not (a.b == "p" and c-d == "q")' },
      "s",
      "pkg",
    );
    expect(p.confidence).toBe(0.9);
    expect(p.ruleSource).toContain('input.payload["a.b"] == "p"');
    expect(p.ruleSource).toContain('input.payload["c-d"] == "q"');
  });

  it("a conditional with no readable values fails closed instead of using placeholders", () => {
    const p = gen.generateFromInvariant(
      { id: "c1", description: "d", fields: ["a", "b"], invariantType: "conditional", expression: "nonsense" },
      "s",
      "pkg",
    );
    expect(p.confidence).toBe(0);
    expect(p.ruleSource).not.toMatch(/"X"|"a", "b"/);
  });

  it("a generic rule calls sprintf with no stray argument and keeps a description on one comment line", () => {
    const inv = { id: "g1", description: "line one\ndeny[msg] { true }", fields: ["a"], invariantType: "other" } as unknown as DomainInvariant;
    const p = gen.generateFromInvariant(inv, "s", "pkg");
    expect(p.ruleSource).not.toContain("sprintf(");
    expect(denyCount(p.ruleSource)).toBe(1);
    expect(p.ruleSource).toContain("# line one deny[msg] { true }");
  });

  it("bounds a numeric field by the observed range, not by the interval of the mean", () => {
    const mle: MLEEstimation = {
      domain: "d",
      schemaId: "s",
      totalRecords: 100,
      estimatedAt: "t",
      fields: [{ fieldName: "n", fieldType: "numeric", mleMin: 0, mleMax: 99, confidenceIntervalLower: 47.7, confidenceIntervalUpper: 51.3, sampleCount: 100, confidenceLevel: 0.99 }],
    };
    const [p] = gen.generateFromMLEOutliers(mle, "s", "pkg");
    expect(p?.ruleSource).toContain("val < 0");
    expect(p?.ruleSource).toContain("val > 99");
    expect(p?.ruleSource).not.toContain("47.7");
  });

  it("writes the MLE pattern as one string literal", () => {
    const mle: MLEEstimation = {
      domain: "d",
      schemaId: "s",
      totalRecords: 3,
      estimatedAt: "t",
      fields: [{ fieldName: "s", fieldType: "string", mlePattern: '^a"\\d$', sampleCount: 3, confidenceLevel: 0.99 }],
    };
    const [p] = gen.generateFromMLEOutliers(mle, "s", "pkg");
    expect(p?.ruleSource).toContain(`regex.match(${JSON.stringify('^a"\\d$')}, val)`);
  });

  it("a spectral coupling with a hostile name stays inside its rule", () => {
    const spectral: SpectralAnalysis = {
      fiedlerValue: 0,
      spectralGap: 0,
      spectralScore: 0,
      eigenvalues: [],
      weakestCut: { clusterA: [], clusterB: [], missingCouplings: [`${hostileField} <-> b`] },
    };
    const [p] = gen.generateFromSpectralGap(spectral, "s", "pkg");
    expect(denyCount(p?.ruleSource ?? "")).toBe(2);
    expect(p?.confidence).toBe(0.5);
  });
});

describe("invariant detector", () => {
  const det = new InvariantDetector(0.8);

  it("finds equality, inequality and membership with structured values", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ a: i, b: i, c: i - 1, t: i % 2 ? "x" : "y" }));
    const inv = det.detectFromData(data, "s");
    expect(inv.some((v) => v.invariantType === "equality" && v.fields.join() === "a,b")).toBe(true);
    expect(inv.some((v) => v.invariantType === "inequality" && v.fields.join() === "a,c")).toBe(true);
    const mem = inv.find((v) => v.invariantType === "membership" && v.fields[0] === "t");
    expect(mem?.values?.slice().sort()).toEqual(["x", "y"]);
  });

  it("orders a temporal pair with the earlier field first in both directions", () => {
    const later = Array.from({ length: 4 }, (_, i) => ({ start: `2026-01-0${i + 1}`, end: `2026-02-0${i + 1}` }));
    const t1 = det.detectFromData(later, "s").find((v) => v.invariantType === "temporal");
    expect(t1?.fields).toEqual(["end", "start"].reverse());
    const earlier = later.map((r) => ({ start: r.end, end: r.start }));
    const t2 = det.detectFromData(earlier, "s").find((v) => v.invariantType === "temporal");
    expect(t2?.fields).toEqual(["end", "start"]);
  });

  it("a generated temporal rule denies the later date that comes first", () => {
    const inv: DomainInvariant = { id: "t", description: "d", fields: ["start", "end"], invariantType: "temporal" };
    const src = gen.generateFromInvariant(inv, "s", "pkg").ruleSource;
    expect(src).toContain("date_a := time.parse_rfc3339_ns(input.payload.start)");
    expect(src).toContain("date_b < date_a");
  });

  it("finds exclusions with the value pair as data", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ k: i % 2 ? "p" : "q", m: i % 2 ? "r" : "s" }));
    const ex = det.detectFromData(data, "s").filter((v) => v.invariantType === "exclusion");
    expect(ex.map((v) => v.excludedPair)).toEqual(expect.arrayContaining([["p", "s"], ["q", "r"]]));
  });

  it("keeps two different object values apart", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ k: i % 2 ? "p" : "q", o: i % 2 ? { a: 1 } : { a: 2 } }));
    const cond = det.detectFromData(data, "s").filter((v) => v.invariantType === "conditional" && v.fields[1] === "o");
    expect(cond.map((v) => v.values)).toEqual(expect.arrayContaining([['{"a":1}'], ['{"a":2}']]));
  });

  it("reads covered invariants from Rego with bracketed names", () => {
    const s: SchemaCandidate = { schemaId: "s", domain: "d", definition: { properties: { k: { enum: ["a"] } } }, source: "human" };
    const covered = det.detectFromSchema(s, ['deny[msg] {\n  input.payload["a.b"] < input.payload.c\n}']);
    expect(covered.find((c) => c.id.startsWith("covered_rego"))?.fields).toEqual(["a.b", "c"]);
    expect(covered.find((c) => c.id.startsWith("covered_mem"))?.fields).toEqual(["k"]);
  });

  it("needs three records", () => {
    expect(det.detectFromData([{ a: 1 }, { a: 1 }], "s")).toEqual([]);
  });
});

describe("policy builder", () => {
  const s: SchemaCandidate = {
    schemaId: "orders-v1",
    domain: "orders",
    definition: { properties: { a: { type: "number" }, b: { type: "number" }, c: { type: "string" } } },
    source: "human",
  };

  it("keeps invariant rules and moves inferred rules below the threshold aside", () => {
    const data = Array.from({ length: 12 }, (_, i) => ({ a: i, b: i, c: `v${i}` }));
    const built = new PolicyBuilder().buildPolicy(s, "orders", { historicalData: data });
    expect(built.rules.every((r) => r.packageName === "aep.schema.orders_v1")).toBe(true);
    expect(built.rules.some((r) => r.invariantId.startsWith("inv_eq"))).toBe(true);
    for (const r of built.rules.filter((x) => x.derivedFrom !== "violation_pattern")) {
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    }
    expect(built.belowThreshold.every((r) => r.confidence < 0.8)).toBe(true);
    expect(built.belowThreshold.some((r) => r.derivedFrom === "mle")).toBe(true);
  });

  it("a manifest invariant that cannot compile stays as a closed rule", () => {
    const built = new PolicyBuilder().buildPolicy(s, "orders", {
      manifest: { domain: "orders", schemaId: "orders-v1", invariants: [{ id: "m", description: "d", fields: ["c"], invariantType: "membership" }] },
    });
    expect(built.rules).toHaveLength(1);
    expect(built.rules[0]?.ruleSource).toContain("fail closed");
  });

  it("measures coverage and proposes rules for missing invariants", () => {
    const r = new PolicyBuilder().validatePolicy(s, [], {
      domain: "orders",
      schemaId: "orders-v1",
      invariants: [{ id: "i", description: "d", fields: ["a", "b"], invariantType: "inequality" }],
    });
    expect(r.coverageRate).toBe(0);
    expect(r.proposedRules).toHaveLength(1);
    expect(r.spectralImpact.fiedlerAfter).toBeGreaterThanOrEqual(r.spectralImpact.fiedlerBefore);
    const covered = new PolicyBuilder().validatePolicy(s, [r.proposedRules[0]?.ruleSource ?? ""], {
      domain: "orders",
      schemaId: "orders-v1",
      invariants: [{ id: "i", description: "d", fields: ["a", "b"], invariantType: "inequality" }],
    });
    expect(covered.coverageRate).toBe(1);
  });
});
