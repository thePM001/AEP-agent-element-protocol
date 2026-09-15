// Generator for the scanners package view of the one scan rule table.
// Source table: AEP-Components/scanners/rules/scan-rule-table.json
// Output: AEP-Components/scanners/lib/admit-rule-table.ts
// The Admit policy crate reads the same source table, so one table serves both
// consumers and no second copy of these rules exists.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "rules", "scan-rule-table.json");
const target = join(here, "..", "lib", "admit-rule-table.ts");

const table = JSON.parse(readFileSync(source, "utf8"));
if (!Array.isArray(table.rules) || table.rules.length === 0) {
  throw new Error("the scan rule table carries no rules");
}
for (const rule of table.rules) {
  if (!rule.id || !rule.class || !rule.category) {
    throw new Error(`scan rule row is incomplete: ${JSON.stringify(rule)}`);
  }
  if (rule.ts !== undefined) {
    new RegExp(rule.ts.pattern, rule.ts.flags);
  }
}

const rows = table.rules.map((rule) => JSON.stringify(rule)).join(",\n  ");

const head = [
  "// GENERATED FILE. Do not edit by hand.",
  "// Source table: AEP-Components/scanners/rules/scan-rule-table.json",
  "// Generator: AEP-Components/scanners/tools/generate-admit-rule-table.mjs",
  "// This module is the scanners package view of the one scan rule table. The",
  "// Admit policy crate reads the same table, so the rules have one source.",
  "",
  "export interface ScanRulePattern {",
  "  pattern: string;",
  "  flags: string;",
  "}",
  "",
  "export interface ScanRule {",
  "  id: string;",
  "  class: string;",
  "  category: string;",
  "  ts?: ScanRulePattern;",
  "  admit?: Record<string, unknown>;",
  "}",
  "",
  `export const SCAN_RULE_TABLE_ID = ${JSON.stringify(table.id)};`,
  `export const SCAN_RULE_TABLE_SOURCE = ${JSON.stringify("AEP-Components/scanners/rules/scan-rule-table.json")};`,
  "",
  "export const SCAN_RULES: ScanRule[] = [",
  "  " + rows,
  "];",
  "",
  "/** Rows of one class that carry a package pattern. */",
  "export function scanRulesForClass(name: string): ScanRule[] {",
  "  return SCAN_RULES.filter((rule) => rule.class === name && rule.ts !== undefined);",
  "}",
  "",
  "/** Compile one row pattern into a fresh RegExp so the caller own lastIndex is used. */",
  "export function compileRulePattern(rule: ScanRule): RegExp | null {",
  "  if (rule.ts === undefined) {",
  "    return null;",
  "  }",
  "  return new RegExp(rule.ts.pattern, rule.ts.flags);",
  "}",
  "",
].join("\n");

writeFileSync(target, head, "utf8");
console.log(`wrote ${target} rules=${table.rules.length}`);
