import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SCAN_RULES,
  SCAN_RULE_TABLE_ID,
  SCAN_RULE_TABLE_SOURCE,
  compileRulePattern,
  scanRulesForClass,
} from "../lib/admit-rule-table.js";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(here, "..", "rules", "scan-rule-table.json");

describe("admit rule table", () => {
  it("matches the source JSON table row for row", () => {
    const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { id: string; rules: unknown[] };
    expect(SCAN_RULE_TABLE_ID).toBe(source.id);
    expect(SCAN_RULES).toEqual(source.rules);
    expect(SCAN_RULE_TABLE_SOURCE).toBe("AEP-Components/scanners/rules/scan-rule-table.json");
  });

  it("has unique ids and complete rows", () => {
    const ids = SCAN_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of SCAN_RULES) {
      expect(rule.class.length).toBeGreaterThan(0);
      expect(rule.category.length).toBeGreaterThan(0);
    }
  });

  it("returns only rows of the requested class that carry a package pattern", () => {
    const injection = scanRulesForClass("injection");
    expect(injection.length).toBeGreaterThan(0);
    expect(injection.every((r) => r.class === "injection" && r.ts !== undefined)).toBe(true);
    // path_traversal is an injection row without a package pattern.
    expect(injection.map((r) => r.id)).not.toContain("path_traversal");
    expect(scanRulesForClass("no-such-class")).toEqual([]);
  });

  it("compiles each pattern into a fresh RegExp and returns null without one", () => {
    const email = SCAN_RULES.find((r) => r.id === "email");
    const traversal = SCAN_RULES.find((r) => r.id === "path_traversal");
    expect(email).toBeDefined();
    expect(traversal).toBeDefined();
    if (email === undefined || traversal === undefined) return;

    const first = compileRulePattern(email);
    const second = compileRulePattern(email);
    expect(first).toBeInstanceOf(RegExp);
    expect(first).not.toBe(second);
    expect(first?.flags).toBe("g");
    expect(first?.test("x@example.com")).toBe(true);
    expect(compileRulePattern(traversal)).toBeNull();
  });

  it("every package pattern compiles", () => {
    for (const rule of SCAN_RULES) {
      if (rule.ts === undefined) continue;
      expect(() => compileRulePattern(rule)).not.toThrow();
    }
  });

  it("allows a null admit matcher", () => {
    const nif = SCAN_RULES.find((r) => r.id === "nif");
    expect(nif?.admit).toBeNull();
  });
});
