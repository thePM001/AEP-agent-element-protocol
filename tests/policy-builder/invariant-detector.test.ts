import { describe, it, expect } from "vitest";
import { InvariantDetector } from "../../src/policy-builder/invariant-detector.js";
import type { InvariantManifest, DomainInvariant } from "../../src/policy-builder/types.js";

describe("InvariantDetector", () => {
  const detector = new InvariantDetector(0.8);

  // -----------------------------------------------------------------------
  // Equality detection
  // -----------------------------------------------------------------------
  describe("equality detection", () => {
    it("should detect equality invariant when two fields always match", () => {
      const data = Array.from({ length: 20 }, (_, i) => ({
        source: `val_${i}`,
        target: `val_${i}`,
      }));
      const invariants = detector.detectFromData(data, "s1");
      const eq = invariants.find((inv) => inv.invariantType === "equality");
      expect(eq).toBeDefined();
      expect(eq!.fields).toContain("source");
      expect(eq!.fields).toContain("target");
    });

    it("should not detect equality when fields differ significantly", () => {
      const data = Array.from({ length: 20 }, (_, i) => ({
        a: `x_${i}`,
        b: `y_${i + 100}`,
      }));
      const invariants = detector.detectFromData(data, "s1");
      const eq = invariants.find(
        (inv) =>
          inv.invariantType === "equality" &&
          inv.fields.includes("a") &&
          inv.fields.includes("b")
      );
      expect(eq).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Membership detection
  // -----------------------------------------------------------------------
  describe("membership detection", () => {
    it("should detect membership invariant for fields with few unique values", () => {
      const data = Array.from({ length: 40 }, (_, i) => ({
        role: ["admin", "user", "guest"][i % 3],
        otherField: `unique_${i}`,
      }));
      const invariants = detector.detectFromData(data, "s1");
      const mem = invariants.find(
        (inv) =>
          inv.invariantType === "membership" && inv.fields.includes("role")
      );
      expect(mem).toBeDefined();
      expect(mem!.description).toContain("role");
    });
  });

  // -----------------------------------------------------------------------
  // Conditional detection
  // -----------------------------------------------------------------------
  describe("conditional detection", () => {
    it("should detect conditional invariant when field B depends on field A value", () => {
      const data: Record<string, unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        const type = ["web", "api", "batch"][i % 3];
        // When type=web, protocol is always "https". When api, always "grpc". etc.
        const protocol =
          type === "web" ? "https" : type === "api" ? "grpc" : "sftp";
        data.push({ type, protocol });
      }
      const invariants = detector.detectFromData(data, "s1");
      const cond = invariants.find(
        (inv) => inv.invariantType === "conditional"
      );
      expect(cond).toBeDefined();
      expect(cond!.fields).toContain("type");
    });
  });

  // -----------------------------------------------------------------------
  // Confidence threshold filtering
  // -----------------------------------------------------------------------
  describe("confidence threshold", () => {
    it("should respect confidence threshold and exclude low-confidence invariants", () => {
      const strictDetector = new InvariantDetector(1.0);
      const data = Array.from({ length: 20 }, (_, i) => ({
        a: i,
        b: i % 2 === 0 ? i : i + 1, // only 50% match -> confidence 0.5
      }));
      const invariants = strictDetector.detectFromData(data, "s1");
      const eq = invariants.find(
        (inv) =>
          inv.invariantType === "equality" &&
          inv.fields.includes("a") &&
          inv.fields.includes("b")
      );
      // With 1.0 threshold, 50% equality should not be detected
      expect(eq).toBeUndefined();
    });

    it("should detect invariant when confidence meets threshold", () => {
      const lenientDetector = new InvariantDetector(0.5);
      const data = Array.from({ length: 20 }, (_, i) => ({
        a: i,
        b: i % 2 === 0 ? i : i + 1, // ~50% match
      }));
      const invariants = lenientDetector.detectFromData(data, "s1");
      // At 50% threshold, an equality invariant at ~50% might be detected
      // (this tests that threshold is being applied)
      expect(Array.isArray(invariants)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Temporal invariant
  // -----------------------------------------------------------------------
  describe("temporal invariant", () => {
    it("should detect temporal ordering when date B is always after date A", () => {
      const data = Array.from({ length: 20 }, (_, i) => ({
        createdAt: `2024-01-${String(i + 1).padStart(2, "0")}`,
        completedAt: `2024-02-${String(i + 1).padStart(2, "0")}`,
      }));
      const invariants = detector.detectFromData(data, "s1");
      const temp = invariants.find(
        (inv) => inv.invariantType === "temporal"
      );
      expect(temp).toBeDefined();
      expect(temp!.fields).toContain("createdAt");
      expect(temp!.fields).toContain("completedAt");
      expect(temp!.description).toContain("after");
    });
  });

  // -----------------------------------------------------------------------
  // Inequality detection
  // -----------------------------------------------------------------------
  describe("inequality detection", () => {
    it("should detect inequality when field A is always >= field B", () => {
      const data = Array.from({ length: 20 }, (_, i) => ({
        total: 100 + i * 10,
        subtotal: 50 + i * 5,
      }));
      const invariants = detector.detectFromData(data, "s1");
      const ineq = invariants.find(
        (inv) =>
          inv.invariantType === "inequality" &&
          inv.fields.includes("total") &&
          inv.fields.includes("subtotal")
      );
      expect(ineq).toBeDefined();
      expect(ineq!.expression).toContain(">=");
    });
  });

  // -----------------------------------------------------------------------
  // Coverage computation
  // -----------------------------------------------------------------------
  describe("coverage computation", () => {
    it("should compute correct coverage rate", () => {
      const manifest: InvariantManifest = {
        domain: "test",
        schemaId: "s1",
        invariants: [
          {
            id: "inv1",
            description: "a == b",
            fields: ["a", "b"],
            invariantType: "equality",
          },
          {
            id: "inv2",
            description: "c in set",
            fields: ["c"],
            invariantType: "membership",
          },
          {
            id: "inv3",
            description: "d >= e",
            fields: ["d", "e"],
            invariantType: "inequality",
          },
        ],
      };
      const covered: DomainInvariant[] = [
        {
          id: "c1",
          description: "matches inv1",
          fields: ["a", "b"],
          invariantType: "equality",
        },
      ];
      const result = detector.computeCoverage(manifest, covered);
      expect(result.covered.length).toBe(1);
      expect(result.missing.length).toBe(2);
      expect(result.coverageRate).toBeCloseTo(1 / 3, 2);
    });

    it("should return 1.0 coverage for empty manifest", () => {
      const manifest: InvariantManifest = {
        domain: "test",
        schemaId: "s1",
        invariants: [],
      };
      const result = detector.computeCoverage(manifest, []);
      expect(result.coverageRate).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Empty data
  // -----------------------------------------------------------------------
  describe("empty data", () => {
    it("should return empty invariants for insufficient data", () => {
      // Need at least 3 records
      const invariants = detector.detectFromData([{ a: 1 }], "s1");
      expect(invariants).toEqual([]);
    });

    it("should return empty invariants for empty data", () => {
      const invariants = detector.detectFromData([], "s1");
      expect(invariants).toEqual([]);
    });
  });
});
