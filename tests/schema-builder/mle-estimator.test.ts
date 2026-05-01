import { describe, it, expect } from "vitest";
import { MLEEstimator } from "../../src/schema-builder/mle-estimator.js";
import type {
  MLEEstimation,
  SchemaCandidate,
} from "../../src/schema-builder/types.js";

// ---- Sample data generators ----

const numericData = Array.from({ length: 50 }, (_, i) => ({
  amount: 100 + i * 10,
  quantity: Math.floor(i / 5) + 1,
  price: 9.99 + i * 0.5,
}));

const stringData = Array.from({ length: 30 }, (_, i) => ({
  code: `ABC${String(i).padStart(3, "0")}`,
  name: `Item ${i}`,
}));

const enumData = Array.from({ length: 40 }, (_, i) => ({
  status: ["active", "pending", "closed"][i % 3],
  priority: ["low", "medium", "high"][i % 3],
}));

describe("MLEEstimator", () => {
  const estimator = new MLEEstimator();

  // -----------------------------------------------------------------------
  // Numeric estimation
  // -----------------------------------------------------------------------
  describe("numeric estimation", () => {
    it("should compute correct min and max for numeric fields", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      const amount = result.fields.find((f) => f.fieldName === "amount")!;
      expect(amount).toBeDefined();
      expect(amount.mleMin).toBe(100);
      expect(amount.mleMax).toBe(100 + 49 * 10); // 590
    });

    it("should compute correct mean for numeric fields", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      const amount = result.fields.find((f) => f.fieldName === "amount")!;
      // Mean of 100..590 step 10 = (100+590)/2 = 345
      expect(amount.mleMean).toBeCloseTo(345, 1);
    });

    it("should compute variance using Welford's algorithm", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      const amount = result.fields.find((f) => f.fieldName === "amount")!;
      expect(amount.mleVariance).toBeDefined();
      expect(amount.mleVariance!).toBeGreaterThan(0);
      // Variance of 50 evenly-spaced values from 100 to 590
      // Step = 10, so variance of i*10 for i=0..49 shifted by 100
      // Var(100 + 10*i) = 100 * Var(i) = 100 * (49*50)/(12) ~= 20833.33 (sample)
      // Actually sample variance of 0..49 = (49*50/12)*(50/49) = 50*50/12 = 208.33.. * 100 = 20833..
      // Let's just check it's reasonable
      expect(amount.mleVariance!).toBeGreaterThan(15000);
      expect(amount.mleVariance!).toBeLessThan(25000);
    });

    it("should detect precision from decimal values", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      const price = result.fields.find((f) => f.fieldName === "price")!;
      expect(price.mlePrecision).toBeDefined();
      // price values have 2 decimal places (e.g. 9.99)
      expect(price.mlePrecision!).toBeLessThanOrEqual(0.01);
    });

    it("should produce confidence intervals for numeric fields", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      const amount = result.fields.find((f) => f.fieldName === "amount")!;
      expect(amount.confidenceIntervalLower).toBeDefined();
      expect(amount.confidenceIntervalUpper).toBeDefined();
      expect(amount.confidenceIntervalLower!).toBeLessThan(amount.mleMean!);
      expect(amount.confidenceIntervalUpper!).toBeGreaterThan(amount.mleMean!);
    });
  });

  // -----------------------------------------------------------------------
  // String estimation
  // -----------------------------------------------------------------------
  describe("string estimation", () => {
    it("should compute min and max string lengths", () => {
      const result = estimator.estimateFromData(stringData, "test", "s2");
      const code = result.fields.find((f) => f.fieldName === "code")!;
      expect(code.fieldType).toBe("string");
      expect(code.mleMinLength).toBeDefined();
      expect(code.mleMaxLength).toBeDefined();
      // "ABC000" = 6 chars
      expect(code.mleMinLength).toBe(6);
      expect(code.mleMaxLength).toBe(6);
    });

    it("should derive a pattern from homogeneous strings", () => {
      const result = estimator.estimateFromData(stringData, "test", "s2");
      const code = result.fields.find((f) => f.fieldName === "code")!;
      expect(code.mlePattern).toBeDefined();
      expect(code.mlePattern!.length).toBeGreaterThan(0);
    });

    it("should correctly detect common prefix pattern", () => {
      const result = estimator.estimateFromData(stringData, "test", "s2");
      const code = result.fields.find((f) => f.fieldName === "code")!;
      // All start with "ABC"
      expect(code.mlePattern!).toContain("ABC");
    });
  });

  // -----------------------------------------------------------------------
  // Enum estimation
  // -----------------------------------------------------------------------
  describe("enum estimation", () => {
    it("should detect enum values from data with few unique values", () => {
      const result = estimator.estimateFromData(enumData, "test", "s3");
      const status = result.fields.find((f) => f.fieldName === "status")!;
      expect(status.fieldType).toBe("enum");
      expect(status.mleEnum).toBeDefined();
      expect(status.mleEnum!).toContain("active");
      expect(status.mleEnum!).toContain("pending");
      expect(status.mleEnum!).toContain("closed");
    });

    it("should compute distribution for enum fields", () => {
      const result = estimator.estimateFromData(enumData, "test", "s3");
      const status = result.fields.find((f) => f.fieldName === "status")!;
      expect(status.mleDistribution).toBeDefined();
      // Roughly equal distribution (40 records, 3 values)
      const dist = status.mleDistribution!;
      for (const val of ["active", "pending", "closed"]) {
        expect(dist[val]).toBeGreaterThan(0.2);
        expect(dist[val]).toBeLessThan(0.5);
      }
    });

    it("should have exactly 3 enum values for the status field", () => {
      const result = estimator.estimateFromData(enumData, "test", "s3");
      const status = result.fields.find((f) => f.fieldName === "status")!;
      expect(status.mleEnum!.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Divergence computation
  // -----------------------------------------------------------------------
  describe("divergence computation", () => {
    it("should return low divergence for a tight schema", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      const schema: SchemaCandidate = {
        schemaId: "s1",
        domain: "test",
        definition: {
          properties: {
            amount: { type: "number", minimum: 100, maximum: 590 },
            quantity: { type: "integer", minimum: 1, maximum: 10 },
            price: { type: "number", minimum: 9.99, maximum: 34.49 },
          },
        },
        source: "human",
      };
      const report = estimator.computeDivergence(schema, mle);
      expect(report.aggregateDivergence).toBeLessThan(0.5);
      expect(report.criticalCount).toBe(0);
    });

    it("should return high divergence for a very loose schema", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      const schema: SchemaCandidate = {
        schemaId: "s1",
        domain: "test",
        definition: {
          properties: {
            amount: { type: "number", minimum: -100000, maximum: 100000 },
            quantity: { type: "integer", minimum: -1000, maximum: 1000 },
            price: { type: "number", minimum: 0, maximum: 99999 },
          },
        },
        source: "llm",
      };
      const report = estimator.computeDivergence(schema, mle);
      expect(report.aggregateDivergence).toBeGreaterThan(0.3);
    });

    it("should flag missing fields as warning", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      const schema: SchemaCandidate = {
        schemaId: "s1",
        domain: "test",
        definition: {
          properties: {
            amount: { type: "number", minimum: 100, maximum: 590 },
            // quantity and price missing
          },
        },
        source: "human",
      };
      const report = estimator.computeDivergence(schema, mle);
      expect(report.warningCount).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Online update (Welford's)
  // -----------------------------------------------------------------------
  describe("online update", () => {
    it("should update min/max when new record exceeds bounds", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      const amount = mle.fields.find((f) => f.fieldName === "amount")!;
      expect(amount.mleMax).toBe(590);

      const updated = estimator.updateEstimation(mle, { amount: 1000 });
      const updatedAmount = updated.fields.find(
        (f) => f.fieldName === "amount"
      )!;
      expect(updatedAmount.mleMax).toBe(1000);
      expect(updatedAmount.mleMin).toBe(100);
    });

    it("should increment totalRecords on update", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      expect(mle.totalRecords).toBe(50);
      const updated = estimator.updateEstimation(mle, { amount: 999 });
      expect(updated.totalRecords).toBe(51);
    });

    it("should update mean correctly via Welford's", () => {
      const data = [{ val: 10 }, { val: 20 }, { val: 30 }];
      const mle = estimator.estimateFromData(data, "test", "s1");
      const field = mle.fields.find((f) => f.fieldName === "val")!;
      expect(field.mleMean).toBeCloseTo(20, 5);

      // Adding val=40 -> mean should be 25
      const updated = estimator.updateEstimation(mle, { val: 40 });
      const updField = updated.fields.find((f) => f.fieldName === "val")!;
      expect(updField.mleMean).toBeCloseTo(25, 5);
    });

    it("should discover new fields during online update", () => {
      const mle = estimator.estimateFromData(
        [{ a: 1 }, { a: 2 }],
        "test",
        "s1"
      );
      expect(mle.fields.length).toBe(1);
      const updated = estimator.updateEstimation(mle, { a: 3, b: 100 });
      expect(updated.fields.length).toBe(2);
      expect(updated.fields.find((f) => f.fieldName === "b")).toBeDefined();
    });

    it("should handle enum updates correctly", () => {
      const mle = estimator.estimateFromData(enumData, "test", "s3");
      const updated = estimator.updateEstimation(mle, {
        status: "archived",
        priority: "critical",
      });
      const status = updated.fields.find((f) => f.fieldName === "status")!;
      expect(status.mleEnum).toContain("archived");
      const priority = updated.fields.find((f) => f.fieldName === "priority")!;
      expect(priority.mleEnum).toContain("critical");
    });
  });

  // -----------------------------------------------------------------------
  // Tightening proposals
  // -----------------------------------------------------------------------
  describe("tightening proposals", () => {
    it("should propose tightening when schema max is much larger than MLE max", () => {
      const mle = estimator.estimateFromData(numericData, "test", "s1");
      const schema: SchemaCandidate = {
        schemaId: "s1",
        domain: "test",
        definition: {
          properties: {
            amount: { type: "number", minimum: 0, maximum: 10000 },
          },
        },
        source: "llm",
      };
      const proposals = estimator.proposeTightening(schema, mle);
      expect(proposals.length).toBeGreaterThan(0);
      const amountProp = proposals.find((p) => p.fieldName === "amount");
      expect(amountProp).toBeDefined();
      expect(
        (amountProp!.proposedConstraint as { maximum: number }).maximum
      ).toBeLessThan(10000);
    });

    it("should propose enum tightening when schema has many more enum values", () => {
      const mle = estimator.estimateFromData(enumData, "test", "s3");
      const schema: SchemaCandidate = {
        schemaId: "s3",
        domain: "test",
        definition: {
          properties: {
            status: {
              type: "string",
              enum: [
                "active",
                "pending",
                "closed",
                "draft",
                "archived",
                "deleted",
                "suspended",
              ],
            },
          },
        },
        source: "llm",
      };
      const proposals = estimator.proposeTightening(schema, mle);
      const statusProp = proposals.find((p) => p.fieldName === "status");
      expect(statusProp).toBeDefined();
      const proposed = statusProp!.proposedConstraint as { enum: string[] };
      expect(proposed.enum.length).toBe(3);
    });

    it("should propose adding a pattern when schema lacks one", () => {
      const mle = estimator.estimateFromData(stringData, "test", "s2");
      const schema: SchemaCandidate = {
        schemaId: "s2",
        domain: "test",
        definition: {
          properties: {
            code: { type: "string" },
          },
        },
        source: "llm",
      };
      const proposals = estimator.proposeTightening(schema, mle);
      const codeProp = proposals.find((p) => p.fieldName === "code");
      expect(codeProp).toBeDefined();
      expect(codeProp!.proposedConstraint).toHaveProperty("pattern");
    });
  });

  // -----------------------------------------------------------------------
  // Cold start / edge cases
  // -----------------------------------------------------------------------
  describe("cold start and edge cases", () => {
    it("should return empty fields for empty data", () => {
      const result = estimator.estimateFromData([], "test", "s0");
      expect(result.fields).toEqual([]);
      expect(result.totalRecords).toBe(0);
    });

    it("should handle a single record", () => {
      const result = estimator.estimateFromData(
        [{ x: 42 }],
        "test",
        "s_single"
      );
      expect(result.totalRecords).toBe(1);
      const x = result.fields.find((f) => f.fieldName === "x")!;
      expect(x.mleMin).toBe(42);
      expect(x.mleMax).toBe(42);
      expect(x.mleMean).toBe(42);
      expect(x.mleVariance).toBe(0);
    });

    it("should handle identical values correctly", () => {
      const data = Array.from({ length: 20 }, () => ({ val: 7 }));
      const result = estimator.estimateFromData(data, "test", "s_ident");
      const val = result.fields.find((f) => f.fieldName === "val")!;
      expect(val.mleMin).toBe(7);
      expect(val.mleMax).toBe(7);
      expect(val.mleMean).toBe(7);
      expect(val.mleVariance).toBeCloseTo(0, 10);
    });

    it("should handle null and undefined values gracefully", () => {
      const data = [
        { a: 1, b: null },
        { a: 2, b: undefined },
        { a: 3 },
      ];
      const result = estimator.estimateFromData(data, "test", "s_null");
      expect(result.fields.length).toBeGreaterThanOrEqual(1);
      const a = result.fields.find((f) => f.fieldName === "a")!;
      expect(a.fieldType).toBe("numeric");
    });

    it("should handle boolean fields", () => {
      const data = Array.from({ length: 10 }, (_, i) => ({
        flag: i % 2 === 0,
      }));
      const result = estimator.estimateFromData(data, "test", "s_bool");
      const flag = result.fields.find((f) => f.fieldName === "flag")!;
      expect(flag.fieldType).toBe("boolean");
    });

    it("should set domain and schemaId correctly", () => {
      const result = estimator.estimateFromData(numericData, "orders", "v2");
      expect(result.domain).toBe("orders");
      expect(result.schemaId).toBe("v2");
    });

    it("should set estimatedAt to a valid ISO date", () => {
      const result = estimator.estimateFromData(numericData, "test", "s1");
      expect(() => new Date(result.estimatedAt)).not.toThrow();
      expect(new Date(result.estimatedAt).getFullYear()).toBeGreaterThanOrEqual(
        2024
      );
    });
  });
});
