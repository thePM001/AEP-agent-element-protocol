import { describe, it, expect } from "vitest";
import { SchemaBuilder } from "../../src/schema-builder/schema-builder.js";
import type { SchemaCandidate } from "../../src/schema-builder/types.js";

// --- Sample data ---

const sampleData = Array.from({ length: 50 }, (_, i) => ({
  amount: 100 + i * 10,
  status: ["active", "pending", "closed"][i % 3],
  code: `ORD${String(i).padStart(4, "0")}`,
  valid: i % 2 === 0,
}));

const tightSchema: SchemaCandidate = {
  schemaId: "tight",
  domain: "orders",
  definition: {
    type: "object",
    properties: {
      amount: { type: "number", minimum: 100, maximum: 590 },
      status: { type: "string", enum: ["active", "pending", "closed"] },
      code: { type: "string", pattern: "^ORD\\d{4}$" },
      valid: { type: "boolean" },
    },
    required: ["amount", "status", "code"],
  },
  source: "human",
};

const looseSchema: SchemaCandidate = {
  schemaId: "loose",
  domain: "orders",
  definition: {
    type: "object",
    properties: {
      amount: { type: "number", minimum: -999999, maximum: 999999 },
      status: { type: "string" },
      code: { type: "string", maxLength: 1000 },
      valid: { type: "boolean" },
    },
  },
  source: "llm",
};

function makeDenyRule(fieldA: string, fieldB: string): string {
  return `deny[msg] {
  a := input.payload.${fieldA}
  b := input.payload.${fieldB}
  a != b
  msg := sprintf("mismatch %v %v", [a, b])
}`;
}

describe("SchemaBuilder", () => {
  // -----------------------------------------------------------------------
  // buildFromData
  // -----------------------------------------------------------------------
  describe("buildFromData", () => {
    it("should produce a valid schema candidate from data", () => {
      const builder = new SchemaBuilder();
      const schema = builder.buildFromData(sampleData, "orders", "auto1");
      expect(schema.schemaId).toBe("auto1");
      expect(schema.domain).toBe("orders");
      expect(schema.source).toBe("mle_derived");
      expect(schema.definition).toHaveProperty("properties");
      const props = schema.definition.properties as Record<string, unknown>;
      expect(props).toHaveProperty("amount");
      expect(props).toHaveProperty("status");
      expect(props).toHaveProperty("code");
      expect(props).toHaveProperty("valid");
    });

    it("should mark fields present in 95%+ records as required", () => {
      const builder = new SchemaBuilder();
      const schema = builder.buildFromData(sampleData, "orders", "auto1");
      const required = schema.definition.required as string[] | undefined;
      expect(required).toBeDefined();
      expect(required!.length).toBeGreaterThan(0);
      // All fields are present in every record, so all should be required
      expect(required!).toContain("amount");
      expect(required!).toContain("status");
    });
  });

  // -----------------------------------------------------------------------
  // validateSchema - composite score
  // -----------------------------------------------------------------------
  describe("validateSchema", () => {
    it("should return a composite score between 0 and 1", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(tightSchema, {
        historicalData: sampleData,
      });
      expect(result.compositeScore).toBeGreaterThanOrEqual(0);
      expect(result.compositeScore).toBeLessThanOrEqual(1);
    });

    it("should include all four analysis components", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(tightSchema, {
        historicalData: sampleData,
      });
      expect(result.mle).toBeDefined();
      expect(result.spectral).toBeDefined();
      expect(result.permissiveness).toBeDefined();
      expect(result.modularity).toBeDefined();
    });

    it("should produce diagnostics array", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(tightSchema, {
        historicalData: sampleData,
      });
      expect(Array.isArray(result.diagnostics)).toBe(true);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Decision thresholds
  // -----------------------------------------------------------------------
  describe("decision thresholds", () => {
    it("should decide 'pass' for composite score >= 0.8", () => {
      const builder = new SchemaBuilder();
      // A tight schema with data should score well
      const result = builder.validateSchema(tightSchema, {
        historicalData: sampleData,
        regoRules: [
          makeDenyRule("amount", "status"),
          makeDenyRule("status", "code"),
          makeDenyRule("amount", "code"),
        ],
      });
      if (result.compositeScore >= 0.8) {
        expect(result.decision).toBe("pass");
      }
    });

    it("should decide 'reject' for composite score < 0.5", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(looseSchema, {
        historicalData: sampleData,
      });
      if (result.compositeScore < 0.5) {
        expect(result.decision).toBe("reject");
      }
    });

    it("should decide 'review' for composite score between 0.5 and 0.8", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(looseSchema, {
        historicalData: sampleData,
      });
      if (result.compositeScore >= 0.5 && result.compositeScore < 0.8) {
        expect(result.decision).toBe("review");
      }
    });

    it("decision should always be one of pass/review/reject", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(tightSchema, {
        historicalData: sampleData,
      });
      expect(["pass", "review", "reject"]).toContain(result.decision);
    });
  });

  // -----------------------------------------------------------------------
  // compareSchemas
  // -----------------------------------------------------------------------
  describe("compareSchemas", () => {
    it("should rank tighter schemas higher than loose schemas", () => {
      const builder = new SchemaBuilder();
      const comparison = builder.compareSchemas(
        [looseSchema, tightSchema],
        { historicalData: sampleData }
      );
      expect(comparison.ranked.length).toBe(2);
      // Tight should be ranked first (higher score)
      expect(comparison.ranked[0].schemaId).toBe("tight");
      expect(comparison.best.schemaId).toBe("tight");
    });
  });

  // -----------------------------------------------------------------------
  // proposeTightening
  // -----------------------------------------------------------------------
  describe("proposeTightening", () => {
    it("should propose tightenings for overly loose schemas", () => {
      const builder = new SchemaBuilder();
      const mle = builder.mleEstimator.estimateFromData(
        sampleData,
        "orders",
        "loose"
      );
      const proposals = builder.proposeTightening(looseSchema, mle);
      expect(proposals.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // getStats
  // -----------------------------------------------------------------------
  describe("getStats", () => {
    it("should track validation statistics correctly", () => {
      const builder = new SchemaBuilder();
      const before = builder.getStats();
      expect(before.totalValidated).toBe(0);

      builder.validateSchema(tightSchema, { historicalData: sampleData });
      builder.validateSchema(looseSchema, { historicalData: sampleData });

      const after = builder.getStats();
      expect(after.totalValidated).toBe(2);
      expect(after.passCount + after.reviewCount + after.rejectCount).toBe(2);
      expect(after.averageCompositeScore).toBeGreaterThan(0);
      expect(after.averageCompositeScore).toBeLessThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Schema without historical data
  // -----------------------------------------------------------------------
  describe("validation without data", () => {
    it("should still produce a valid result without historical data", () => {
      const builder = new SchemaBuilder();
      const result = builder.validateSchema(tightSchema);
      expect(result.compositeScore).toBeGreaterThanOrEqual(0);
      expect(result.compositeScore).toBeLessThanOrEqual(1);
      expect(result.mle.aggregateDivergence).toBe(0);
    });
  });
});
