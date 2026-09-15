// AEP 2.8.6 - PII Scanner
// Detects personally identifiable information in agent output.
// The patterns come from the one scan rule table, which the Admit policy crate
// also reads. This module holds no private copy of a rule.

import type { Finding, Scanner, ScannerConfig } from "./types.js";
import { scanRulesForClass } from "./admit-rule-table.js";

interface PIIPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

const PII_PATTERNS: PIIPattern[] = scanRulesForClass("pii").map((rule) => ({
  name: rule.id,
  pattern: new RegExp(rule.ts?.pattern ?? "", rule.ts?.flags ?? "g"),
  category: rule.category,
}));

function luhnCheck(num: string): boolean {
  // M-25: real Luhn validation for card-like digit sequences
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export class PIIScanner implements Scanner {
  name = "pii";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { name: pName, pattern, category } of PII_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        if (pName === "credit_card" && !luhnCheck(match[0])) {
          continue;
        }
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
