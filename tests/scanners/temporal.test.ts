import { describe, it, expect } from "vitest";
import { TemporalScanner } from "../../src/scanners/temporal.js";

describe("TemporalScanner", () => {
  // Use a fixed reference date for deterministic tests
  const scanner = new TemporalScanner({ reference_date: "2026-06-01" });

  it("flags stale date references", () => {
    const findings = scanner.scan("The report was published on 2024-03-15 with key insights.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "temporal:stale_reference")).toBe(true);
  });

  it("allows stale dates qualified with 'as of'", () => {
    const findings = scanner.scan("As of 2024-03-15 the rate was 5.2%.");
    expect(findings.some((f) => f.category === "temporal:stale_reference")).toBe(false);
  });

  it("flags dates beyond the configured future horizon", () => {
    const findings = scanner.scan("The project will complete by 2030-12-31.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "temporal:excessive_horizon")).toBe(true);
  });

  it("allows dates within the future horizon", () => {
    const findings = scanner.scan("The next milestone is 2026-09-01.");
    expect(findings.some((f) => f.category === "temporal:excessive_horizon")).toBe(false);
  });

  it("flags undated statistics", () => {
    const findings = scanner.scan("The unemployment rate is 4.2% across the region.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "temporal:undated_statistic")).toBe(true);
  });

  it("allows statistics with nearby date context", () => {
    const findings = scanner.scan("As of 2026-01-01 the unemployment rate is 4.2% across the region.");
    expect(findings.some((f) => f.category === "temporal:undated_statistic")).toBe(false);
  });

  it("flags expired promotional content", () => {
    const findings = scanner.scan("This offer expires 2024-01-15. Register now!");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "temporal:expired_content")).toBe(true);
  });

  it("returns empty for content without dates or statistics", () => {
    const findings = scanner.scan("The team is working on the next release of the platform.");
    expect(findings).toHaveLength(0);
  });
});
