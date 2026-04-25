import { describe, it, expect } from "vitest";
import { PredictionScanner } from "../../src/scanners/prediction.js";

describe("PredictionScanner", () => {
  const scanner = new PredictionScanner();

  it("flags extreme percentage predictions", () => {
    const findings = scanner.scan("Revenue will increase by 500% next year");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "prediction:extreme_percentage")).toBe(true);
  });

  it("allows percentages within the configured maximum", () => {
    const findings = scanner.scan("We expect growth of 15% in Q2");
    expect(findings.some((f) => f.category === "prediction:extreme_percentage")).toBe(false);
  });

  it("flags certainty language", () => {
    const findings = scanner.scan("This stock is guaranteed to double in value");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "prediction:false_certainty")).toBe(true);
  });

  it("flags missing confidence qualifier on numeric predictions", () => {
    const findings = scanner.scan("Sales will reach $5 million by December");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "prediction:no_confidence_qualifier")).toBe(true);
  });

  it("allows numeric predictions with confidence qualifiers", () => {
    const findings = scanner.scan("Sales are projected to reach $5 million by December");
    expect(findings.some((f) => f.category === "prediction:no_confidence_qualifier")).toBe(false);
  });

  it("flags extreme timeframe predictions", () => {
    const findings = scanner.scan("By 2045 all cars will be autonomous");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "prediction:extreme_timeframe")).toBe(true);
  });

  it("respects custom max_percentage config", () => {
    const strict = new PredictionScanner({ max_percentage: 50 });
    const findings = strict.scan("Demand will increase by 75% next quarter");
    expect(findings.some((f) => f.category === "prediction:extreme_percentage")).toBe(true);
  });

  it("returns empty for clean content", () => {
    const findings = scanner.scan("The weather is nice today and the team is performing well.");
    expect(findings).toHaveLength(0);
  });
});
