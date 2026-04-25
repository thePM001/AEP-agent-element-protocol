// AEP 2.5 -- Rule Generator
// Analyses violation patterns from eval reports.
// Produces suggested covenant rules and scanner patterns.
// Output is human-reviewable. NEVER auto-adopted.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalReport, ViolationSummary, SuggestedRule, EvalDataset } from "./types.js";

const SUGGESTION_THRESHOLD = 3;

export interface SuggestedRules {
  covenantRules: string[];
  scannerPatterns: string[];
}

export class RuleGenerator {
  fromReport(report: EvalReport): SuggestedRules {
    const covenantRules: string[] = [];
    const scannerPatterns: string[] = [];

    for (const rule of report.suggestedRules) {
      if (rule.type === "covenant") {
        covenantRules.push(rule.rule);
      } else {
        scannerPatterns.push(rule.rule);
      }
    }

    return { covenantRules, scannerPatterns };
  }

  fromViolations(
    violations: ViolationSummary[],
    falseNegatives: number,
    dataset: EvalDataset
  ): SuggestedRule[] {
    const suggestions: SuggestedRule[] = [];

    // Analyse violation patterns for covenant rules
    const prefixCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();

    for (const v of violations) {
      // Check for AEP prefix patterns
      const prefixMatch = v.rule.match(/prefix\s+"([A-Z]{2})"/);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + v.count);
      }

      // Track category frequency
      categoryCounts.set(v.category, (categoryCounts.get(v.category) ?? 0) + v.count);
    }

    // Generate covenant suggestions for prefix-based violations
    for (const [prefix, count] of prefixCounts) {
      if (count >= SUGGESTION_THRESHOLD) {
        suggestions.push({
          type: "covenant",
          rule: `forbid aep:create_element (prefix == "${prefix}") [hard];`,
          confidence: Math.min(count / 10, 1),
          basedOn: `${count} false negatives with prefix "${prefix}"`,
        });
      }
    }

    // Generate scanner suggestions for content-based patterns
    for (const v of violations) {
      if (v.count >= SUGGESTION_THRESHOLD && v.category.includes("content")) {
        const escapedRule = v.rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        suggestions.push({
          type: "scanner",
          rule: escapedRule,
          confidence: Math.min(v.count / 10, 1),
          basedOn: `${v.count} violations in category "${v.category}"`,
        });
      }
    }

    // Generate covenant suggestions from category-based patterns
    for (const [category, count] of categoryCounts) {
      if (count >= SUGGESTION_THRESHOLD && !category.includes("content")) {
        suggestions.push({
          type: "covenant",
          rule: `forbid ${category} [hard];`,
          confidence: Math.min(count / 10, 1),
          basedOn: `${count} violations in category "${category}"`,
        });
      }
    }

    // If many false negatives, suggest a catch-all review
    if (falseNegatives >= SUGGESTION_THRESHOLD) {
      // Collect common patterns from false-negative entries
      const failEntries = dataset.entries.filter(e => e.expectedOutcome === "fail");
      const tagCounts = new Map<string, number>();
      for (const e of failEntries) {
        for (const tag of e.tags ?? []) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }

      for (const [tag, count] of tagCounts) {
        if (count >= SUGGESTION_THRESHOLD) {
          suggestions.push({
            type: "scanner",
            rule: tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            confidence: Math.min(count / falseNegatives, 1),
            basedOn: `${count} false negatives tagged "${tag}"`,
          });
        }
      }
    }

    return suggestions;
  }

  writeSuggestions(report: EvalReport, baseDir: string): string {
    const suggestionsDir = join(baseDir, ".aep", "suggestions");
    if (!existsSync(suggestionsDir)) {
      mkdirSync(suggestionsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${report.datasetName}-${timestamp}.json`;
    const filePath = join(suggestionsDir, filename);

    const output = {
      datasetName: report.datasetName,
      generatedAt: new Date().toISOString(),
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      falsePositives: report.falsePositives,
      falseNegatives: report.falseNegatives,
      violations: report.violations,
      suggestedRules: report.suggestedRules,
    };

    writeFileSync(filePath, JSON.stringify(output, null, 2) + "\n", "utf-8");
    return filePath;
  }
}
