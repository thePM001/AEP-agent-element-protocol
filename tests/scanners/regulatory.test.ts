import { describe, it, expect } from "vitest";
import { RegulatoryScanner } from "../../src/scanners/regulatory.js";

describe("RegulatoryScanner", () => {
  const scanner = new RegulatoryScanner();

  it("flags promotional content without ad disclosure", () => {
    const findings = scanner.scan("Buy now and get free shipping on all orders!");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "regulatory:missing_ad_disclosure")).toBe(true);
  });

  it("passes promotional content with ad disclosure", () => {
    const findings = scanner.scan("#ad Buy now and get free shipping on all orders!");
    expect(findings.some((f) => f.category === "regulatory:missing_ad_disclosure")).toBe(false);
  });

  it("flags financial content without disclaimer", () => {
    const findings = scanner.scan("You should invest in this stock for great returns of 20%.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "regulatory:missing_financial_disclaimer")).toBe(true);
  });

  it("passes financial content with disclaimer", () => {
    const content = "Consider this portfolio option. This is not financial advice. Consult a financial advisor.";
    const findings = scanner.scan(content);
    expect(findings.some((f) => f.category === "regulatory:missing_financial_disclaimer")).toBe(false);
  });

  it("flags medical content without disclaimer", () => {
    const findings = scanner.scan("Take this medication for your symptoms twice daily.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "regulatory:missing_medical_disclaimer")).toBe(true);
  });

  it("flags affiliate links without disclosure", () => {
    const findings = scanner.scan("Check out this product at https://example.com?ref=abc123");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "regulatory:missing_affiliate_disclosure")).toBe(true);
  });

  it("flags age-restricted content without age notice", () => {
    const findings = scanner.scan("Try our new premium beer and wine selection.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "regulatory:missing_age_restriction")).toBe(true);
  });

  it("supports custom disclosure rules", () => {
    const custom = new RegulatoryScanner({
      custom_disclosures: [{
        trigger_patterns: ["weight loss"],
        required_phrases: ["results may vary"],
        severity: "hard",
      }],
    });
    const findings = custom.scan("This supplement promotes weight loss quickly.");
    expect(findings.some((f) => f.category === "regulatory:custom_disclosure")).toBe(true);
  });
});
