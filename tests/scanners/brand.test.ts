import { describe, it, expect } from "vitest";
import { BrandScanner } from "../../src/scanners/brand.js";

describe("BrandScanner", () => {
  it("flags missing required phrases", () => {
    const scanner = new BrandScanner({
      required_phrases: ["Powered by Acme"],
    });
    const findings = scanner.scan("This is a great product for everyone.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.category === "brand:missing_required_phrase")).toBe(true);
  });

  it("passes when required phrases are present", () => {
    const scanner = new BrandScanner({
      required_phrases: ["Powered by Acme"],
    });
    const findings = scanner.scan("This product is Powered by Acme technology.");
    expect(findings.some((f) => f.category === "brand:missing_required_phrase")).toBe(false);
  });

  it("flags forbidden phrases with hard severity", () => {
    const scanner = new BrandScanner({
      forbidden_phrases: ["cheap knockoff"],
    });
    const findings = scanner.scan("This is not a cheap knockoff product.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].category).toBe("brand:forbidden_phrase");
    expect(findings[0].severity).toBe("hard");
  });

  it("flags off-tone content when tone keywords are configured", () => {
    const scanner = new BrandScanner({
      tone_keywords: ["innovative", "premium", "elegant"],
    });
    const findings = scanner.scan("This basic tool does simple things.");
    expect(findings.some((f) => f.category === "brand:off_tone")).toBe(true);
  });

  it("passes when tone keywords are present", () => {
    const scanner = new BrandScanner({
      tone_keywords: ["innovative", "premium"],
    });
    const findings = scanner.scan("Our innovative platform delivers results.");
    expect(findings.some((f) => f.category === "brand:off_tone")).toBe(false);
  });

  it("flags competitor mentions", () => {
    const scanner = new BrandScanner({
      competitors: ["CompetitorCorp"],
    });
    const findings = scanner.scan("Unlike CompetitorCorp we deliver on time.");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].category).toBe("brand:competitor_mention");
  });

  it("flags trademark violations", () => {
    const scanner = new BrandScanner({
      trademarks: [{ term: "SuperWidget", suffix: "\u2122" }],
    });
    const findings = scanner.scan("The SuperWidget device is available now.");
    expect(findings.some((f) => f.category === "brand:trademark_missing")).toBe(true);
  });

  it("returns empty for clean content with no rules configured", () => {
    const scanner = new BrandScanner();
    const findings = scanner.scan("A perfectly normal sentence about nothing specific.");
    expect(findings).toHaveLength(0);
  });
});
