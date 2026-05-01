import { describe, it, expect } from "vitest";
import { SpectralAnalyzer } from "../../src/schema-builder/spectral-analyzer.js";
import type { SchemaCandidate } from "../../src/schema-builder/types.js";

/**
 * Helper: build a SchemaCandidate from field names and optional required list.
 */
function makeSchema(
  fields: string[],
  required?: string[]
): SchemaCandidate {
  const properties: Record<string, Record<string, unknown>> = {};
  for (const f of fields) {
    properties[f] = { type: "string" };
  }
  return {
    schemaId: "test",
    domain: "test",
    definition: { properties, ...(required ? { required } : {}) },
    source: "human",
  };
}

/**
 * Helper: build Rego deny rules that reference certain field pairs,
 * creating edges in the constraint graph.
 */
function makeDenyRule(fieldA: string, fieldB: string): string {
  return `deny[msg] {
  a := input.payload.${fieldA}
  b := input.payload.${fieldB}
  a != b
  msg := sprintf("mismatch %v %v", [a, b])
}`;
}

describe("SpectralAnalyzer", () => {
  const analyzer = new SpectralAnalyzer();

  // -----------------------------------------------------------------------
  // Laplacian construction
  // -----------------------------------------------------------------------
  describe("Laplacian construction", () => {
    it("should return all-zero eigenvalues for a graph with no edges", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const result = analyzer.analyze(schema, []);
      // No edges -> all eigenvalues should be 0
      expect(result.eigenvalues.every((e) => Math.abs(e) < 0.01)).toBe(true);
    });

    it("should produce a valid spectral analysis for a connected graph", () => {
      const schema = makeSchema(["x", "y", "z"]);
      const rules = [
        makeDenyRule("x", "y"),
        makeDenyRule("y", "z"),
        makeDenyRule("x", "z"),
      ];
      const result = analyzer.analyze(schema, rules);
      expect(result.eigenvalues.length).toBe(3);
      // First eigenvalue should be ~0
      expect(Math.abs(result.eigenvalues[0])).toBeLessThan(0.1);
      // Second eigenvalue (Fiedler) should be > 0 for a connected graph
      expect(result.fiedlerValue).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Eigenvalue computation
  // -----------------------------------------------------------------------
  describe("eigenvalue computation", () => {
    it("should have the correct number of eigenvalues", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      const rules = [makeDenyRule("a", "b"), makeDenyRule("c", "d")];
      const result = analyzer.analyze(schema, rules);
      expect(result.eigenvalues.length).toBe(4);
    });

    it("should compute eigenvalues for a complete graph (K3)", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
      ];
      const result = analyzer.analyze(schema, rules);
      // K3 Laplacian eigenvalues: 0, 3, 3
      expect(result.eigenvalues[0]).toBeCloseTo(0, 1);
      expect(result.eigenvalues[1]).toBeCloseTo(3, 0);
      expect(result.eigenvalues[2]).toBeCloseTo(3, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Fiedler value
  // -----------------------------------------------------------------------
  describe("Fiedler value", () => {
    it("should be 0 for a disconnected graph", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      // Two disconnected components: (a-b), (c-d) with no cross-edges
      const rules = [makeDenyRule("a", "b"), makeDenyRule("c", "d")];
      const result = analyzer.analyze(schema, rules);
      // Two disconnected components -> Fiedler value = 0
      expect(result.fiedlerValue).toBeCloseTo(0, 1);
    });

    it("should be positive for a connected graph", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const rules = [makeDenyRule("a", "b"), makeDenyRule("b", "c")];
      const result = analyzer.analyze(schema, rules);
      expect(result.fiedlerValue).toBeGreaterThan(0);
    });

    it("should increase when more edges are added", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const sparse = analyzer.analyze(schema, [makeDenyRule("a", "b"), makeDenyRule("b", "c")]);
      const dense = analyzer.analyze(schema, [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
      ]);
      expect(dense.fiedlerValue).toBeGreaterThanOrEqual(sparse.fiedlerValue);
    });
  });

  // -----------------------------------------------------------------------
  // Fiedler vector cut
  // -----------------------------------------------------------------------
  describe("Fiedler vector cut", () => {
    it("should partition fields into two clusters", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("c", "d"),
      ];
      const result = analyzer.analyze(schema, rules);
      const allFields = [
        ...result.weakestCut.clusterA,
        ...result.weakestCut.clusterB,
      ];
      expect(allFields.sort()).toEqual(["a", "b", "c", "d"]);
    });

    it("should detect missing couplings between clusters", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("c", "d"),
      ];
      const result = analyzer.analyze(schema, rules);
      // There should be missing couplings between the two groups
      expect(result.weakestCut.missingCouplings.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Spectral score
  // -----------------------------------------------------------------------
  describe("spectral score", () => {
    it("should be higher for tightly coupled schemas", () => {
      const schemaLoose = makeSchema(["a", "b", "c", "d"]);
      const schemaTight = makeSchema(["a", "b", "c", "d"]);

      const loose = analyzer.analyze(schemaLoose, [
        makeDenyRule("a", "b"),
        makeDenyRule("c", "d"),
      ]);
      const tight = analyzer.analyze(schemaTight, [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("c", "d"),
        makeDenyRule("a", "d"),
      ]);
      expect(tight.spectralScore).toBeGreaterThanOrEqual(loose.spectralScore);
    });

    it("should be 0 for a single field", () => {
      const schema = makeSchema(["only"]);
      const result = analyzer.analyze(schema, []);
      expect(result.spectralScore).toBe(0);
      expect(result.fiedlerValue).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // parseRegoForFieldReferences
  // -----------------------------------------------------------------------
  describe("parseRegoForFieldReferences", () => {
    it("should extract field references from deny blocks", () => {
      const rego = `deny[msg] {
  a := input.payload.amount
  b := input.payload.quantity
  a > b
  msg := "amount > quantity"
}`;
      const refs = analyzer.parseRegoForFieldReferences(rego);
      expect(refs.length).toBe(1);
      expect(refs[0].fields).toContain("amount");
      expect(refs[0].fields).toContain("quantity");
    });

    it("should handle input.field syntax as well as input.payload.field", () => {
      const rego = `deny[msg] {
  x := input.alpha
  y := input.payload.beta
  x != y
  msg := "fail"
}`;
      const refs = analyzer.parseRegoForFieldReferences(rego);
      expect(refs.length).toBe(1);
      expect(refs[0].fields).toContain("alpha");
      expect(refs[0].fields).toContain("beta");
    });

    it("should return empty array for non-deny rego content", () => {
      const rego = `package test
allow { true }`;
      const refs = analyzer.parseRegoForFieldReferences(rego);
      expect(refs.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Star graph
  // -----------------------------------------------------------------------
  describe("star graph", () => {
    it("should produce correct eigenvalues for a star topology", () => {
      // Star graph: center connected to all others
      const schema = makeSchema(["center", "a", "b", "c"]);
      const rules = [
        makeDenyRule("center", "a"),
        makeDenyRule("center", "b"),
        makeDenyRule("center", "c"),
      ];
      const result = analyzer.analyze(schema, rules);
      expect(result.fiedlerValue).toBeGreaterThan(0);
      // Star K_{1,3}: eigenvalues are 0, 1, 1, 4 (for unit-weight)
      // Our weights are 1 each edge
      expect(result.eigenvalues.length).toBe(4);
      expect(result.eigenvalues[0]).toBeCloseTo(0, 0);
    });
  });

  // -----------------------------------------------------------------------
  // Fully connected graph
  // -----------------------------------------------------------------------
  describe("fully connected graph", () => {
    it("should have high Fiedler value for a complete graph", () => {
      const fields = ["a", "b", "c", "d"];
      const schema = makeSchema(fields);
      const rules: string[] = [];
      for (let i = 0; i < fields.length; i++) {
        for (let j = i + 1; j < fields.length; j++) {
          rules.push(makeDenyRule(fields[i], fields[j]));
        }
      }
      const result = analyzer.analyze(schema, rules);
      // K4: Fiedler = n = 4
      expect(result.fiedlerValue).toBeGreaterThanOrEqual(3);
    });

    it("should have zero missing couplings for a fully connected graph", () => {
      const fields = ["a", "b", "c"];
      const schema = makeSchema(fields);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
      ];
      const result = analyzer.analyze(schema, rules);
      expect(result.weakestCut.missingCouplings.length).toBe(0);
    });
  });
});
