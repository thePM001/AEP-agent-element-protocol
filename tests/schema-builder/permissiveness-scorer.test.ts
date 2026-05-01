import { describe, it, expect } from "vitest";
import { PermissivenessScorer } from "../../src/schema-builder/permissiveness-scorer.js";
import { MLEEstimator } from "../../src/schema-builder/mle-estimator.js";
import type { SchemaCandidate } from "../../src/schema-builder/types.js";

function makeSchema(
  properties: Record<string, Record<string, unknown>>
): SchemaCandidate {
  return {
    schemaId: "test",
    domain: "test",
    definition: { properties },
    source: "human",
  };
}

describe("PermissivenessScorer", () => {
  const scorer = new PermissivenessScorer();

  // -----------------------------------------------------------------------
  // Entropy computation
  // -----------------------------------------------------------------------
  describe("entropy computation", () => {
    it("should give lower entropy for a tightly constrained schema", () => {
      const tight = makeSchema({
        age: { type: "integer", minimum: 18, maximum: 65 },
        status: { type: "string", enum: ["active", "inactive"] },
      });
      const loose = makeSchema({
        age: { type: "integer", minimum: -1000000, maximum: 1000000 },
        status: { type: "string", maxLength: 256 },
      });
      const tightResult = scorer.analyze(tight);
      const looseResult = scorer.analyze(loose);
      expect(tightResult.entropy).toBeLessThan(looseResult.entropy);
    });

    it("should return 0 entropy for an empty schema", () => {
      const empty = makeSchema({});
      const result = scorer.analyze(empty);
      expect(result.entropy).toBe(0);
    });

    it("should compute positive entropy for schemas with constrained fields", () => {
      const schema = makeSchema({
        count: { type: "integer", minimum: 0, maximum: 100 },
      });
      const result = scorer.analyze(schema);
      expect(result.entropy).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Excess permissiveness
  // -----------------------------------------------------------------------
  describe("excess permissiveness", () => {
    it("should produce positive excess when schema is looser than MLE data", () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        amount: 100 + i * 2,
      }));
      const estimator = new MLEEstimator();
      const mle = estimator.estimateFromData(data, "test", "s1");

      // Schema that is much wider than the data
      const schema = makeSchema({
        amount: { type: "number", minimum: -10000, maximum: 100000 },
      });
      const result = scorer.analyze(schema, mle);
      expect(result.excessPermissiveness).toBeGreaterThan(0);
    });

    it("should produce zero excess when no MLE is provided", () => {
      const schema = makeSchema({
        x: { type: "number", minimum: 0, maximum: 100 },
      });
      const result = scorer.analyze(schema);
      expect(result.excessPermissiveness).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Principal components
  // -----------------------------------------------------------------------
  describe("principal components", () => {
    it("should rank the most constrained field with highest weight", () => {
      const schema = makeSchema({
        flag: { type: "boolean" },
        bigNumber: { type: "number", minimum: 0, maximum: 1000000000 },
      });
      const result = scorer.analyze(schema);
      // bigNumber has vastly more acceptance volume -> higher entropy -> higher weight
      expect(result.principalComponents.length).toBe(2);
      expect(result.principalComponents[0].fieldName).toBe("bigNumber");
      expect(result.principalComponents[0].informationWeight).toBeGreaterThan(
        result.principalComponents[1].informationWeight
      );
    });

    it("should have weights that sum to approximately 1", () => {
      const schema = makeSchema({
        a: { type: "integer", minimum: 1, maximum: 10 },
        b: { type: "integer", minimum: 1, maximum: 100 },
        c: { type: "integer", minimum: 1, maximum: 1000 },
      });
      const result = scorer.analyze(schema);
      const totalWeight = result.principalComponents.reduce(
        (sum, pc) => sum + pc.informationWeight,
        0
      );
      expect(totalWeight).toBeCloseTo(1, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Unconstrained field detection
  // -----------------------------------------------------------------------
  describe("unconstrained field detection", () => {
    it("should flag unconstrained string fields as weakest constraints", () => {
      const schema = makeSchema({
        name: { type: "string" }, // no maxLength, no pattern, no enum
        id: { type: "integer", minimum: 1, maximum: 100 },
      });
      const result = scorer.analyze(schema);
      expect(result.weakestConstraints).toContain("name");
    });
  });

  // -----------------------------------------------------------------------
  // Boolean fields
  // -----------------------------------------------------------------------
  describe("boolean fields", () => {
    it("should produce exactly log2(2)=1 bit of entropy per boolean field", () => {
      const schema = makeSchema({
        flag: { type: "boolean" },
      });
      const result = scorer.analyze(schema);
      // log2(2) = 1
      expect(result.entropy).toBeCloseTo(1, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Enum fields
  // -----------------------------------------------------------------------
  describe("enum fields", () => {
    it("should have lower entropy for enum with fewer values", () => {
      const small = makeSchema({
        status: { type: "string", enum: ["a", "b"] },
      });
      const large = makeSchema({
        status: { type: "string", enum: ["a", "b", "c", "d", "e", "f", "g", "h"] },
      });
      expect(scorer.analyze(small).entropy).toBeLessThan(
        scorer.analyze(large).entropy
      );
    });
  });
});
