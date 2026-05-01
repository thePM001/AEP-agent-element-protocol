import { describe, it, expect } from "vitest";
import { RegoGenerator } from "../../src/policy-builder/rego-generator.js";
import type { DomainInvariant } from "../../src/policy-builder/types.js";
import type {
  MLEEstimation,
  SpectralAnalysis,
} from "../../src/schema-builder/types.js";

describe("RegoGenerator", () => {
  const generator = new RegoGenerator();
  const pkg = "aep.schema.test";
  const schemaId = "test";

  // -----------------------------------------------------------------------
  // Rule generation per invariant type
  // -----------------------------------------------------------------------
  describe("equality rule", () => {
    it("should generate a valid deny rule for equality invariant", () => {
      const inv: DomainInvariant = {
        id: "eq1",
        description: "a must equal b",
        fields: ["a", "b"],
        invariantType: "equality",
        expression: "a == b",
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain("package");
      expect(proposal.ruleSource).toContain("input.payload.a");
      expect(proposal.ruleSource).toContain("input.payload.b");
      expect(proposal.ruleSource).toContain("a != b");
      expect(proposal.ruleSource).toContain("sprintf");
      expect(proposal.invariantId).toBe("eq1");
    });
  });

  describe("inequality rule", () => {
    it("should generate a deny rule that checks a < b", () => {
      const inv: DomainInvariant = {
        id: "ineq1",
        description: "total must be >= subtotal",
        fields: ["total", "subtotal"],
        invariantType: "inequality",
        expression: "total >= subtotal",
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain("input.payload.total");
      expect(proposal.ruleSource).toContain("input.payload.subtotal");
      expect(proposal.ruleSource).toContain("a < b");
    });
  });

  describe("membership rule", () => {
    it("should generate a deny rule checking membership in allowed set", () => {
      const inv: DomainInvariant = {
        id: "mem1",
        description: "status must be one of: active, pending",
        fields: ["status"],
        invariantType: "membership",
        expression: 'status in ["active", "pending"]',
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain("allowed");
      expect(proposal.ruleSource).toContain("not allowed[val]");
      expect(proposal.ruleSource).toContain("input.payload.status");
    });
  });

  describe("exclusion rule", () => {
    it("should generate a deny rule for forbidden co-occurrence", () => {
      const inv: DomainInvariant = {
        id: "excl1",
        description: 'type="admin" and role="guest" never co-occur',
        fields: ["type", "role"],
        invariantType: "exclusion",
        expression: 'not (type == "admin" and role == "guest")',
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain('"admin"');
      expect(proposal.ruleSource).toContain('"guest"');
      expect(proposal.ruleSource).toContain("input.payload.type");
      expect(proposal.ruleSource).toContain("input.payload.role");
    });
  });

  describe("conditional rule", () => {
    it("should generate a deny rule for conditional invariant", () => {
      const inv: DomainInvariant = {
        id: "cond1",
        description:
          'If region="EU" then currency must be in {"EUR", "GBP"}',
        fields: ["region", "currency"],
        invariantType: "conditional",
        expression: 'if region == "EU" then currency in ["EUR", "GBP"]',
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain('"EU"');
      expect(proposal.ruleSource).toContain("input.payload.region");
      expect(proposal.ruleSource).toContain("input.payload.currency");
      expect(proposal.ruleSource).toContain("allowed");
    });
  });

  describe("temporal rule", () => {
    it("should generate a deny rule for temporal ordering", () => {
      const inv: DomainInvariant = {
        id: "temp1",
        description: "endDate must not be before startDate",
        fields: ["startDate", "endDate"],
        invariantType: "temporal",
        expression: "date(endDate) >= date(startDate)",
      };
      const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
      expect(proposal.ruleSource).toContain("deny[msg]");
      expect(proposal.ruleSource).toContain("time.parse_rfc3339_ns");
      expect(proposal.ruleSource).toContain("input.payload.startDate");
      expect(proposal.ruleSource).toContain("input.payload.endDate");
      expect(proposal.ruleSource).toContain("date_b < date_a");
    });
  });

  // -----------------------------------------------------------------------
  // Generated Rego syntax validity
  // -----------------------------------------------------------------------
  describe("syntax validity", () => {
    it("every generated rule should contain 'deny[msg]', 'package', and 'sprintf' (or msg :=)", () => {
      const invariants: DomainInvariant[] = [
        {
          id: "eq",
          description: "x == y",
          fields: ["x", "y"],
          invariantType: "equality",
          expression: "x == y",
        },
        {
          id: "mem",
          description: "z in set",
          fields: ["z"],
          invariantType: "membership",
          expression: 'z in ["a"]',
        },
      ];
      for (const inv of invariants) {
        const proposal = generator.generateFromInvariant(inv, schemaId, pkg);
        expect(proposal.ruleSource).toContain("deny[msg]");
        expect(proposal.ruleSource).toContain("package");
        expect(proposal.ruleSource).toMatch(/sprintf|msg :=/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // MLE outlier rules
  // -----------------------------------------------------------------------
  describe("MLE outlier rules", () => {
    it("should generate numeric outlier rules from MLE estimation", () => {
      const mle: MLEEstimation = {
        domain: "test",
        schemaId: "s1",
        totalRecords: 50,
        estimatedAt: new Date().toISOString(),
        fields: [
          {
            fieldName: "amount",
            fieldType: "numeric",
            mleMin: 100,
            mleMax: 590,
            mleMean: 345,
            mleVariance: 21000,
            sampleCount: 50,
            confidenceLevel: 0.99,
            confidenceIntervalLower: 290,
            confidenceIntervalUpper: 400,
          },
        ],
      };
      const rules = generator.generateFromMLEOutliers(mle, schemaId, pkg);
      expect(rules.length).toBeGreaterThan(0);
      const numRule = rules.find((r) => r.ruleId.startsWith("mle_numeric"));
      expect(numRule).toBeDefined();
      expect(numRule!.ruleSource).toContain("deny[msg]");
      expect(numRule!.ruleSource).toContain("amount");
      expect(numRule!.derivedFrom).toBe("mle");
    });

    it("should generate enum outlier rules from MLE estimation", () => {
      const mle: MLEEstimation = {
        domain: "test",
        schemaId: "s1",
        totalRecords: 40,
        estimatedAt: new Date().toISOString(),
        fields: [
          {
            fieldName: "status",
            fieldType: "enum",
            mleEnum: ["active", "pending", "closed"],
            mleDistribution: { active: 0.33, pending: 0.33, closed: 0.34 },
            sampleCount: 40,
            confidenceLevel: 0.99,
          },
        ],
      };
      const rules = generator.generateFromMLEOutliers(mle, schemaId, pkg);
      const enumRule = rules.find((r) => r.ruleId.startsWith("mle_enum"));
      expect(enumRule).toBeDefined();
      expect(enumRule!.ruleSource).toContain("deny[msg]");
      expect(enumRule!.ruleSource).toContain("active");
      expect(enumRule!.ruleSource).toContain("allowed");
    });
  });

  // -----------------------------------------------------------------------
  // Spectral gap rules
  // -----------------------------------------------------------------------
  describe("spectral gap rules", () => {
    it("should generate placeholder rules for missing couplings", () => {
      const spectral: SpectralAnalysis = {
        fiedlerValue: 0.1,
        spectralGap: 0.05,
        spectralScore: 0.005,
        weakestCut: {
          clusterA: ["amount", "status"],
          clusterB: ["code", "valid"],
          missingCouplings: ["amount <-> code", "status <-> valid"],
        },
        eigenvalues: [0, 0.1, 1.5, 2],
      };
      const rules = generator.generateFromSpectralGap(spectral, schemaId, pkg);
      expect(rules.length).toBe(2);
      for (const rule of rules) {
        expect(rule.ruleSource).toContain("deny[msg]");
        expect(rule.ruleSource).toContain("package");
        expect(rule.ruleSource).toContain("spectral gap");
        expect(rule.derivedFrom).toBe("spectral_gap");
        expect(rule.confidence).toBe(0.5);
      }
    });

    it("should return empty array when no missing couplings", () => {
      const spectral: SpectralAnalysis = {
        fiedlerValue: 3,
        spectralGap: 1,
        spectralScore: 3,
        weakestCut: {
          clusterA: ["a"],
          clusterB: ["b"],
          missingCouplings: [],
        },
        eigenvalues: [0, 3, 3],
      };
      const rules = generator.generateFromSpectralGap(spectral, schemaId, pkg);
      expect(rules.length).toBe(0);
    });
  });
});
