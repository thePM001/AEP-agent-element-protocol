// AEP 2.8.6 - Injection Scanner
// Detects SQL injection, XSS, SSTI and command injection patterns.
// The patterns come from the one scan rule table, which the Admit policy crate
// also reads. This module holds no private copy of a rule.

import type { Finding, Scanner, ScannerConfig } from "./types.js";
import { scanRulesForClass } from "./admit-rule-table.js";

interface InjectionPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

/**
 * BM-16: heuristic denylist only - not complete injection coverage.
 * Combine with fail-closed policy; do not claim complete security from this list alone.
 */
const INJECTION_PATTERNS: InjectionPattern[] = scanRulesForClass("injection").map((rule) => ({
  name: rule.id,
  pattern: new RegExp(rule.ts?.pattern ?? "", rule.ts?.flags ?? "g"),
  category: rule.category,
}));

export const INJECTION_SCANNER_HEURISTIC_ONLY = true;

export class InjectionScanner implements Scanner {
  name = "injection";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { pattern, category } of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category,
        });
      }
    }

    return findings;
  }
}
