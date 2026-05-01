import { describe, it, expect } from "vitest";
import { PolicyBuilder } from "../../src/policy-builder/policy-builder.js";
import type { SchemaCandidate } from "../../src/schema-builder/types.js";
import type { InvariantManifest } from "../../src/policy-builder/types.js";

// --- Sample data ---

const orderData = Array.from({ length: 50 }, (_, i) => ({
  amount: 100 + i * 10,
  status: ["active", "pending", "closed"][i % 3],
  region: ["US", "EU"][i % 2],
  createdAt: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
  completedAt: `2024-02-${String((i % 28) + 1).padStart(2, "0")}`,
}));

const orderSchema: SchemaCandidate = {
  schemaId: "orders_v1",
  domain: "orders",
  definition: {
    type: "object",
    properties: {
      amount: { type: "number", minimum: 0, maximum: 10000 },
      status: { type: "string", enum: ["active", "pending", "closed"] },
      region: { type: "string", enum: ["US", "EU", "APAC"] },
      createdAt: { type: "string" },
      completedAt: { type: "string" },
    },
    required: ["amount", "status"],
  },
  source: "human",
};

describe("PolicyBuilder", () => {
  // -----------------------------------------------------------------------
  // Full pipeline
  // -----------------------------------------------------------------------
  describe("full pipeline (buildPolicy)", () => {
    it("should produce rules and manifest from schema and data", () => {
      const builder = new PolicyBuilder();
      const result = builder.buildPolicy(orderSchema, "orders", {
        historicalData: orderData,
      });
      expect(result.rules.length).toBeGreaterThan(0);
      expect(result.manifest).toBeDefined();
      expect(result.manifest.invariants.length).toBeGreaterThan(0);
      expect(result.spectral).toBeDefined();
    });

    it("should include invariant-derived and MLE-derived rules", () => {
      const builder = new PolicyBuilder();
      const result = builder.buildPolicy(orderSchema, "orders", {
        historicalData: orderData,
      });
      const derivations = new Set(result.rules.map((r) => r.derivedFrom));
      // Should have at least violation_pattern (from invariants) and mle rules
      expect(derivations.has("violation_pattern")).toBe(true);
      expect(derivations.has("mle")).toBe(true);
    });

    it("should merge external manifest invariants with detected ones", () => {
      const builder = new PolicyBuilder();
      const externalManifest: InvariantManifest = {
        domain: "orders",
        schemaId: "orders_v1",
        invariants: [
          {
            id: "custom_1",
            description: "amount must be positive",
            fields: ["amount"],
            invariantType: "inequality",
            expression: "amount > 0",
          },
        ],
      };
      const result = builder.buildPolicy(orderSchema, "orders", {
        historicalData: orderData,
        manifest: externalManifest,
      });
      const ids = result.manifest.invariants.map((i) => i.id);
      expect(ids).toContain("custom_1");
    });
  });

  // -----------------------------------------------------------------------
  // Coverage computation
  // -----------------------------------------------------------------------
  describe("coverage computation", () => {
    it("should compute coverage rate in validatePolicy", () => {
      const builder = new PolicyBuilder();
      const regoRules = [
        `deny[msg] {
  val := input.payload.amount
  val < 0
  msg := sprintf("amount %v is negative", [val])
}`,
      ];
      const result = builder.validatePolicy(orderSchema, regoRules, undefined, {
        historicalData: orderData,
      });
      expect(result.coverageRate).toBeGreaterThanOrEqual(0);
      expect(result.coverageRate).toBeLessThanOrEqual(1);
      expect(result.invariantsTotal).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Spectral impact projection
  // -----------------------------------------------------------------------
  describe("spectral impact", () => {
    it("should project spectral improvement from proposed rules", () => {
      const builder = new PolicyBuilder();
      const result = builder.validatePolicy(
        orderSchema,
        [], // No existing rules
        undefined,
        { historicalData: orderData }
      );
      // After proposing new rules, Fiedler should improve or stay same
      expect(result.spectralImpact).toBeDefined();
      expect(result.spectralImpact.fiedlerAfter).toBeGreaterThanOrEqual(
        result.spectralImpact.fiedlerBefore
      );
    });
  });

  // -----------------------------------------------------------------------
  // buildPolicy result structure
  // -----------------------------------------------------------------------
  describe("buildPolicy result structure", () => {
    it("should produce rules with valid ruleSource, ruleId, and confidence", () => {
      const builder = new PolicyBuilder();
      const result = builder.buildPolicy(orderSchema, "orders", {
        historicalData: orderData,
      });
      for (const rule of result.rules) {
        expect(rule.ruleId).toBeDefined();
        expect(rule.ruleId.length).toBeGreaterThan(0);
        expect(rule.ruleSource).toContain("package");
        expect(rule.ruleSource).toContain("deny[msg]");
        expect(rule.confidence).toBeGreaterThan(0);
        expect(rule.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // validatePolicy with data
  // -----------------------------------------------------------------------
  describe("validatePolicy", () => {
    it("should auto-propose rules for missing invariants when autoPropose is true", () => {
      const builder = new PolicyBuilder({ autoPropose: true });
      const result = builder.validatePolicy(orderSchema, [], undefined, {
        historicalData: orderData,
      });
      if (result.missingRules.length > 0) {
        expect(result.proposedRules.length).toBeGreaterThan(0);
      }
    });

    it("should not propose rules when autoPropose is false", () => {
      const builder = new PolicyBuilder({ autoPropose: false });
      const result = builder.validatePolicy(orderSchema, [], undefined, {
        historicalData: orderData,
      });
      expect(result.proposedRules.length).toBe(0);
    });

    it("should report correct schemaId in results", () => {
      const builder = new PolicyBuilder();
      const result = builder.validatePolicy(orderSchema, [], undefined, {
        historicalData: orderData,
      });
      expect(result.schemaId).toBe("orders_v1");
    });
  });
});
