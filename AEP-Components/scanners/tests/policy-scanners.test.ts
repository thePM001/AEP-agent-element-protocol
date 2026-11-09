import { describe, it, expect } from "vitest";
import { BrandScanner } from "../lib/brand.js";
import { RegulatoryScanner } from "../lib/regulatory.js";
import { TemporalScanner } from "../lib/temporal.js";
import { PredictionScanner } from "../lib/prediction.js";
import { DataProfileScanner, DEFAULT_PROFILER_CONFIG } from "../lib/profiler.js";
import type { Finding } from "../lib/types.js";

function categories(findings: Finding[]): string[] {
  return findings.map((f) => f.category);
}

function only(findings: Finding[], category: string): Finding[] {
  return findings.filter((f) => f.category === category);
}

describe("BrandScanner", () => {
  it("reports missing required phrases and passes when present", () => {
    const scanner = new BrandScanner({ required_phrases: ["Powered by Nimbus"] });
    expect(categories(scanner.scan("A short note."))).toEqual(["brand:missing_required_phrase"]);
    expect(scanner.scan("A short note. powered by nimbus")).toEqual([]);
  });

  it("forbidden phrases are always hard, even when the scanner is soft", () => {
    const findings = new BrandScanner({ severity: "soft", forbidden_phrases: ["cheap"] }).scan(
      "Cheap and cheap again",
    );
    expect(findings).toEqual([
      { scanner: "brand", severity: "hard", match: "Cheap", position: 0, category: "brand:forbidden_phrase" },
      { scanner: "brand", severity: "hard", match: "cheap", position: 10, category: "brand:forbidden_phrase" },
    ]);
  });

  it("flags off-tone content only when no tone keyword appears", () => {
    const scanner = new BrandScanner({ tone_keywords: ["reliable", "secure"] });
    expect(categories(scanner.scan("Fast and fun."))).toEqual(["brand:off_tone"]);
    expect(scanner.scan("A Secure platform.")).toEqual([]);
  });

  it("flags competitor mentions with positions", () => {
    const findings = new BrandScanner({ competitors: ["Globex"] }).scan("Better than globex.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "brand:competitor_mention", match: "globex", position: 12 });
    expect(findings[0]?.severity).toBe("soft");
  });

  it("enforces trademark suffixes, allowing whitespace before the suffix", () => {
    const scanner = new BrandScanner({ trademarks: [{ term: "Nimbus", suffix: "TM" }] });
    expect(scanner.scan("NimbusTM and Nimbus TM ship today")).toEqual([]);
    const findings = scanner.scan("Nimbus ships today and so on and on");
    expect(categories(findings)).toEqual(["brand:trademark_missing"]);
    expect(findings[0]?.position).toBe(0);
  });

  it("has no findings with an empty configuration", () => {
    expect(new BrandScanner().scan("anything at all")).toEqual([]);
  });
});

describe("RegulatoryScanner", () => {
  it("requires an ad disclosure on promotional content", () => {
    const scanner = new RegulatoryScanner();
    const findings = scanner.scan("Buy now and save!");
    expect(categories(findings)).toEqual(["regulatory:missing_ad_disclosure"]);
    expect(findings[0]?.severity).toBe("hard");
    expect(scanner.scan("Buy now and save! #ad")).toEqual([]);
    expect(scanner.scan("Sponsored: buy now and save!")).toEqual([]);
  });

  it("does not treat the letters 'ad' inside another word as a disclosure", () => {
    // "today" and "already" contain "ad"; neither is an ad label.
    const findings = new RegulatoryScanner().scan("Order today, stock is already low.");
    expect(categories(findings)).toEqual(["regulatory:missing_ad_disclosure"]);
    expect(new RegulatoryScanner().scan("Order today. Ad.")).toEqual([]);
  });

  it("requires financial and medical disclaimers", () => {
    const scanner = new RegulatoryScanner();
    expect(categories(scanner.scan("You should invest in bonds."))).toEqual([
      "regulatory:missing_financial_disclaimer",
    ]);
    expect(scanner.scan("You should invest in bonds. This is not financial advice.")).toEqual([]);
    expect(categories(scanner.scan("Check the dosage."))).toEqual(["regulatory:missing_medical_disclaimer"]);
    expect(scanner.scan("Check the dosage and consult your doctor.")).toEqual([]);
  });

  it("requires affiliate and age restriction notices", () => {
    const scanner = new RegulatoryScanner();
    expect(categories(scanner.scan("https://shop.example/item?ref=abc"))).toEqual([
      "regulatory:missing_affiliate_disclosure",
    ]);
    expect(scanner.scan("https://shop.example/item?ref=abc (affiliate link)")).toEqual([]);
    expect(categories(scanner.scan("Try our new wine list"))).toEqual(["regulatory:missing_age_restriction"]);
    expect(scanner.scan("Try our new wine list. Adults only.")).toEqual([]);
  });

  it("each check can be switched off and severity configured", () => {
    const off = new RegulatoryScanner({
      check_ad_disclosure: false,
      check_financial_disclaimer: false,
      check_medical_disclaimer: false,
      check_affiliate_disclosure: false,
      check_age_restriction: false,
    });
    expect(off.scan("Buy now, invest in wine, dosage tips, x?ref=1")).toEqual([]);
    expect(new RegulatoryScanner({ severity: "soft" }).scan("Buy now")[0]?.severity).toBe("soft");
  });

  it("applies custom disclosure rules with their own severity", () => {
    const scanner = new RegulatoryScanner({
      custom_disclosures: [{ trigger_patterns: ["crypto"], required_phrases: ["high risk"], severity: "soft" }],
    });
    const findings = scanner.scan("Crypto yields are attractive.");
    expect(findings).toEqual([
      {
        scanner: "regulatory",
        severity: "soft",
        match: "custom disclosure missing for: crypto",
        position: 0,
        category: "regulatory:custom_disclosure",
      },
    ]);
    expect(scanner.scan("Crypto is HIGH RISK.")).toEqual([]);
  });

  it("passes neutral text", () => {
    expect(new RegulatoryScanner().scan("The meeting notes are attached.")).toEqual([]);
  });
});

describe("TemporalScanner", () => {
  const reference_date = "2026-06-01T12:00:00Z";

  it("flags a past date used in a present-tense claim", () => {
    const findings = new TemporalScanner({ reference_date }).scan("The price is 10 USD on 2024-01-15.");
    const stale = only(findings, "temporal:stale_reference");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.match).toBe("2024-01-15");
    expect(stale[0]?.severity).toBe("soft");
  });

  it("does not flag historical narrative or an 'as of' qualifier", () => {
    const scanner = new TemporalScanner({ reference_date });
    expect(only(scanner.scan("The company was founded on 2010-03-04."), "temporal:stale_reference")).toEqual([]);
    expect(only(scanner.scan("As of March 2024 the price is 10 USD."), "temporal:stale_reference")).toEqual([]);
  });

  it("flags dates beyond the future horizon in each supported format", () => {
    const scanner = new TemporalScanner({ reference_date, max_future_days: 365 });
    const content = "Plans: 2030-01-01, March 5, 2031, 15/06/2032, Q3 2033, July 2034, q2 2035.";
    const matches = only(scanner.scan(content), "temporal:excessive_horizon").map((f) => f.match);
    expect(matches).toEqual(
      expect.arrayContaining(["2030-01-01", "March 5, 2031", "15/06/2032", "Q3 2033", "July 2034", "q2 2035"]),
    );
  });

  it("does not flag a date inside the horizon", () => {
    const scanner = new TemporalScanner({ reference_date, max_future_days: 365 });
    expect(scanner.scan("Release window opens 2026-09-01.")).toEqual([]);
  });

  it("flags undated statistics and accepts dated ones", () => {
    const scanner = new TemporalScanner({ reference_date });
    expect(categories(scanner.scan("Unemployment is 4.5% across the region."))).toEqual([
      "temporal:undated_statistic",
    ]);
    expect(scanner.scan("In 2025, unemployment is 4.5% across the region.")).toEqual([]);
    expect(new TemporalScanner({ reference_date, check_undated_statistics: false }).scan("Inflation is 3%")).toEqual(
      [],
    );
  });

  it("flags expired promotions but not future ones", () => {
    const scanner = new TemporalScanner({ reference_date });
    const expired = only(scanner.scan("Offer expires 2025-12-31."), "temporal:expired_content");
    expect(expired).toHaveLength(1);
    expect(expired[0]?.match).toBe("Offer expires 2025-12-31");
    expect(only(scanner.scan("Offer expires 2026-12-31."), "temporal:expired_content")).toEqual([]);
  });

  it("honours disabled checks and configured severity", () => {
    const scanner = new TemporalScanner({
      reference_date,
      severity: "hard",
      check_stale_references: false,
      check_expired_content: false,
    });
    expect(scanner.scan("Offer expires 2025-12-31. The price is 10 USD on 2024-01-15.")).toEqual([]);
    const far = scanner.scan("Due 2040-01-01.");
    expect(far.map((f) => [f.category, f.severity])).toEqual([["temporal:excessive_horizon", "hard"]]);
  });
});

describe("PredictionScanner", () => {
  it("flags percentages above the configured maximum", () => {
    const scanner = new PredictionScanner({ max_percentage: 100 });
    const findings = only(scanner.scan("Sales will increase by 250% next quarter."), "prediction:extreme_percentage");
    expect(findings.map((f) => f.match)).toEqual(["increase by 250%"]);
    expect(only(scanner.scan("Sales may increase by 20%."), "prediction:extreme_percentage")).toEqual([]);
  });

  it("flags certainty language unless disabled", () => {
    const content = "This plan is guaranteed to work.";
    expect(categories(new PredictionScanner().scan(content))).toEqual(["prediction:false_certainty"]);
    expect(new PredictionScanner({ block_certainty_language: false }).scan(content)).toEqual([]);
  });

  it("requires a nearby confidence qualifier on numeric predictions", () => {
    const scanner = new PredictionScanner();
    const findings = scanner.scan("Revenue will reach $5 million.");
    expect(categories(findings)).toEqual(["prediction:no_confidence_qualifier"]);
    expect(findings[0]?.match).toBe("will reach $5 million");
    expect(scanner.scan("Revenue is projected and will reach $5 million.")).toEqual([]);
    expect(new PredictionScanner({ require_confidence: false }).scan("Revenue will reach $5 million.")).toEqual([]);
  });

  it("only accepts a qualifier near the prediction, not anywhere in the document", () => {
    const far = "Our figures are approximately right." + " filler".repeat(40) + " Revenue will reach $5 million.";
    expect(categories(new PredictionScanner().scan(far))).toEqual(["prediction:no_confidence_qualifier"]);
  });

  it("flags timeframes beyond the horizon", () => {
    const scanner = new PredictionScanner({ max_horizon_days: 365 });
    const found = only(scanner.scan("We expect this by 2099 or within 5 years."), "prediction:extreme_timeframe");
    expect(found.map((f) => f.match)).toEqual(["by 2099", "within 5 years"]);
    expect(only(scanner.scan("Likely within 1 year."), "prediction:extreme_timeframe")).toEqual([]);
  });

  it("uses the configured severity", () => {
    const findings = new PredictionScanner({ severity: "hard" }).scan("It will definitely happen.");
    expect(findings.map((f) => f.severity)).toEqual(["hard"]);
  });
});

describe("DataProfileScanner", () => {
  it("exposes an opt-in default configuration", () => {
    expect(DEFAULT_PROFILER_CONFIG.enabled).toBe(false);
    expect(DEFAULT_PROFILER_CONFIG.severity).toBe("soft");
  });

  it("returns nothing for empty or non-tabular content", () => {
    const scanner = new DataProfileScanner();
    expect(scanner.scan("")).toEqual([]);
    expect(scanner.scan("   ")).toEqual([]);
    expect(scanner.scan("just a sentence")).toEqual([]);
  });

  it("reports high null rate per CSV column", () => {
    const findings = only(new DataProfileScanner().scan("a,b\n1,\n2,NA\n3,x"), "profiler:null_rate");
    expect(findings.map((f) => f.match)).toEqual(["b: 66.7% null"]);
  });

  it("reports duplicate rows from a JSON array", () => {
    const row = { a: 1, b: "x" };
    const data = JSON.stringify([row, row, row, row, { a: 2, b: "y" }]);
    const findings = only(new DataProfileScanner().scan(data), "profiler:duplicate_rate");
    expect(findings.map((f) => f.match)).toEqual(["60.0% duplicate rows"]);
  });

  it("reports numeric outliers beyond the stddev threshold", () => {
    const values = [...Array.from({ length: 20 }, (_, i) => String(10 + (i % 2))), "1000"];
    const csv = "v,label\n" + values.map((v, i) => `${v},${i % 2 === 0 ? "a" : "b"}`).join("\n");
    const findings = only(new DataProfileScanner().scan(csv), "profiler:outlier");
    expect(findings.map((f) => f.match)).toEqual(["v: 1 outlier(s) beyond 3 stddev"]);
  });

  it("reports rows whose schema differs from the first row", () => {
    const data = JSON.stringify([{ a: 1, b: 2 }, { a: 2 }, { a: 3, c: 4 }]);
    const findings = only(new DataProfileScanner().scan(data), "profiler:schema_inconsistency");
    expect(findings.map((f) => f.match)).toEqual(["2 row(s) with inconsistent schema"]);
  });

  it("reports class imbalance on the last column", () => {
    const rows = Array.from({ length: 24 }, (_, i) => `${i + 1},${i < 22 ? "yes" : "no"}`);
    const findings = only(new DataProfileScanner().scan("id,label\n" + rows.join("\n")), "profiler:class_imbalance");
    expect(findings.map((f) => f.match)).toEqual(["label: class imbalance ratio 11.0:1"]);
  });

  it("passes a healthy dataset and wraps a single JSON object", () => {
    const scanner = new DataProfileScanner();
    const rows = Array.from({ length: 10 }, (_, i) => `${i + 1},${i % 2 === 0 ? "a" : "b"}`);
    expect(scanner.scan("id,label\n" + rows.join("\n"))).toEqual([]);
    expect(scanner.scan(JSON.stringify({ a: 1, b: "x" }))).toEqual([]);
  });

  it("honours thresholds and severity from config", () => {
    const strict = new DataProfileScanner({ null_rate_threshold: 0.1, severity: "hard" });
    const findings = only(strict.scan("a,b\n1,x\n2,x\n3,x\n4,x\n5,"), "profiler:null_rate");
    expect(findings.map((f) => [f.match, f.severity])).toEqual([["b: 20.0% null", "hard"]]);
  });
});
