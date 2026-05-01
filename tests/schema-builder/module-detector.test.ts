import { describe, it, expect } from "vitest";
import { ModuleDetector } from "../../src/schema-builder/module-detector.js";
import type { SchemaCandidate } from "../../src/schema-builder/types.js";

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

function makeDenyRule(fieldA: string, fieldB: string): string {
  return `deny[msg] {
  a := input.payload.${fieldA}
  b := input.payload.${fieldB}
  a != b
  msg := sprintf("mismatch %v %v", [a, b])
}`;
}

describe("ModuleDetector", () => {
  const detector = new ModuleDetector();

  // -----------------------------------------------------------------------
  // Community detection on a modular graph
  // -----------------------------------------------------------------------
  describe("community detection", () => {
    it("should detect separate communities for disconnected field groups", () => {
      const schema = makeSchema(["a", "b", "c", "d", "e", "f"]);
      // Group 1: a-b-c tightly connected. Group 2: d-e-f tightly connected.
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
        makeDenyRule("d", "e"),
        makeDenyRule("e", "f"),
        makeDenyRule("d", "f"),
      ];
      const result = detector.analyze(schema, rules);
      expect(result.modules.length).toBeGreaterThanOrEqual(2);
      // Check that a, b, c are in the same module
      const moduleOfA = result.modules.find((m) => m.fields.includes("a"))!;
      expect(moduleOfA.fields).toContain("b");
      expect(moduleOfA.fields).toContain("c");
      // And d, e, f in a different module
      const moduleOfD = result.modules.find((m) => m.fields.includes("d"))!;
      expect(moduleOfD.fields).toContain("e");
      expect(moduleOfD.fields).toContain("f");
    });

    it("should put all fields in one module for a fully connected graph", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
      ];
      const result = detector.analyze(schema, rules);
      // Should be a single module containing all fields
      expect(result.modules.length).toBe(1);
      expect(result.modules[0].fields.sort()).toEqual(["a", "b", "c"]);
    });
  });

  // -----------------------------------------------------------------------
  // Modularity score
  // -----------------------------------------------------------------------
  describe("modularity score", () => {
    it("should produce higher modularity for well-separated communities than mixed", () => {
      const schemaA = makeSchema(["a", "b", "c", "d"]);
      // Well-separated: two cliques
      const separated = detector.analyze(schemaA, [
        makeDenyRule("a", "b"),
        makeDenyRule("c", "d"),
      ]);

      // Fully connected: one community
      const schemaB = makeSchema(["a", "b", "c", "d"]);
      const mixed = detector.analyze(schemaB, [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("c", "d"),
        makeDenyRule("a", "d"),
        makeDenyRule("a", "c"),
        makeDenyRule("b", "d"),
      ]);

      expect(separated.modularityScore).toBeGreaterThanOrEqual(
        mixed.modularityScore
      );
    });
  });

  // -----------------------------------------------------------------------
  // Inter-module gap detection
  // -----------------------------------------------------------------------
  describe("inter-module gap detection", () => {
    it("should detect gaps between disconnected modules", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("c", "d"),
      ];
      const result = detector.analyze(schema, rules);
      // There should be an inter-module gap between the two groups
      expect(result.interModuleGaps.length).toBeGreaterThan(0);
    });

    it("should have no gaps when all modules are linked", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("b", "c"),
        makeDenyRule("a", "c"),
      ];
      const result = detector.analyze(schema, rules);
      expect(result.interModuleGaps.length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Single module
  // -----------------------------------------------------------------------
  describe("single module", () => {
    it("should return one module with modularity 1 for a single field", () => {
      const schema = makeSchema(["only"]);
      const result = detector.analyze(schema, []);
      expect(result.modules.length).toBe(1);
      expect(result.modules[0].fields).toEqual(["only"]);
      expect(result.modularityScore).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // No edges
  // -----------------------------------------------------------------------
  describe("no edges", () => {
    it("should assign each field to its own module when there are no edges", () => {
      const schema = makeSchema(["a", "b", "c"]);
      const result = detector.analyze(schema, []);
      expect(result.modules.length).toBe(3);
      expect(result.modularityScore).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Required fields contribute edges
  // -----------------------------------------------------------------------
  describe("required co-occurrence edges", () => {
    it("should create coupling from required fields even without rego rules", () => {
      const schema = makeSchema(["a", "b", "c"], ["a", "b", "c"]);
      const result = detector.analyze(schema, []);
      // Required fields create co-occurrence edges (weight 0.4)
      // So all fields should end up in one module
      expect(result.modules.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Internal and external coupling
  // -----------------------------------------------------------------------
  describe("coupling metrics", () => {
    it("should have positive internal coupling for a module with edges", () => {
      const schema = makeSchema(["a", "b", "c", "d"]);
      const rules = [
        makeDenyRule("a", "b"),
        makeDenyRule("a", "c"),
        makeDenyRule("b", "c"),
        makeDenyRule("d", "a"), // cross-module edge
      ];
      const result = detector.analyze(schema, rules);
      const bigModule = result.modules.find((m) => m.fields.length > 1);
      if (bigModule) {
        expect(bigModule.internalCoupling).toBeGreaterThan(0);
      }
    });
  });
});
