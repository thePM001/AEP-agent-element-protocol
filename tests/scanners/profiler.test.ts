import { describe, it, expect } from "vitest";
import { DataProfileScanner } from "../../src/scanners/profiler.js";
import { createDefaultPipeline } from "../../src/scanners/pipeline.js";

describe("DataProfileScanner", () => {
  it("detects high null rate in CSV data", () => {
    const csv = [
      "name,age,city",
      "Alice,30,London",
      "Bob,,",
      "Charlie,,",
      ",,"
    ].join("\n");

    const scanner = new DataProfileScanner({ null_rate_threshold: 0.3 });
    const findings = scanner.scan(csv);
    const nullFindings = findings.filter((f) => f.category === "profiler:null_rate");
    expect(nullFindings.length).toBeGreaterThan(0);
  });

  it("detects duplicate rows", () => {
    const csv = [
      "x,y",
      "1,2",
      "1,2",
      "1,2",
      "3,4",
    ].join("\n");

    const scanner = new DataProfileScanner({ duplicate_rate_threshold: 0.3 });
    const findings = scanner.scan(csv);
    const dupFindings = findings.filter((f) => f.category === "profiler:duplicate_rate");
    expect(dupFindings.length).toBe(1);
    expect(dupFindings[0].match).toContain("duplicate");
  });

  it("detects outliers beyond stddev threshold", () => {
    const csv = [
      "value",
      "10",
      "11",
      "10",
      "12",
      "11",
      "10",
      "100",
    ].join("\n");

    const scanner = new DataProfileScanner({ outlier_stddev: 2.0 });
    const findings = scanner.scan(csv);
    const outlierFindings = findings.filter((f) => f.category === "profiler:outlier");
    expect(outlierFindings.length).toBe(1);
    expect(outlierFindings[0].match).toContain("outlier");
  });

  it("detects schema inconsistency in JSON data", () => {
    const data = JSON.stringify([
      { a: 1, b: 2 },
      { a: 3, b: 4, c: 5 },
      { a: 6 },
    ]);

    const scanner = new DataProfileScanner();
    const findings = scanner.scan(data);
    const schemaFindings = findings.filter((f) => f.category === "profiler:schema_inconsistency");
    expect(schemaFindings.length).toBe(1);
    expect(schemaFindings[0].match).toContain("inconsistent schema");
  });

  it("detects class imbalance", () => {
    const rows = [
      "feature,label",
      ...Array.from({ length: 100 }, () => "1,positive"),
      ...Array.from({ length: 2 }, () => "1,negative"),
    ];
    const csv = rows.join("\n");

    const scanner = new DataProfileScanner({ imbalance_ratio: 5.0 });
    const findings = scanner.scan(csv);
    const imbalanceFindings = findings.filter((f) => f.category === "profiler:class_imbalance");
    expect(imbalanceFindings.length).toBe(1);
    expect(imbalanceFindings[0].match).toContain("class imbalance");
  });

  it("returns no findings for clean data", () => {
    const csv = [
      "x,y,label",
      "1,10,a",
      "2,20,b",
      "3,30,a",
      "4,40,b",
    ].join("\n");

    const scanner = new DataProfileScanner();
    const findings = scanner.scan(csv);
    expect(findings.length).toBe(0);
  });

  it("handles empty content", () => {
    const scanner = new DataProfileScanner();
    expect(scanner.scan("").length).toBe(0);
    expect(scanner.scan("  ").length).toBe(0);
  });

  it("parses JSON array input", () => {
    const data = JSON.stringify([
      { name: "Alice", score: 95 },
      { name: "Bob", score: 88 },
      { name: null, score: null },
      { name: null, score: null },
    ]);

    const scanner = new DataProfileScanner({ null_rate_threshold: 0.3 });
    const findings = scanner.scan(data);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("is disabled by default in createDefaultPipeline", () => {
    const pipeline = createDefaultPipeline();
    const scannerNames = pipeline.getScanners().map((s) => s.name);
    expect(scannerNames).not.toContain("profiler");
  });

  it("is enabled when profiler.enabled is true in pipeline config", () => {
    const pipeline = createDefaultPipeline({
      profiler: {
        enabled: true,
        severity: "soft",
        null_rate_threshold: 0.3,
        duplicate_rate_threshold: 0.5,
        outlier_stddev: 3.0,
        imbalance_ratio: 10.0,
      },
    });
    const scannerNames = pipeline.getScanners().map((s) => s.name);
    expect(scannerNames).toContain("profiler");
  });
});
