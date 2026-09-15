// AEP 2.8.6 - Secrets Scanner
// Detects API keys, private keys and credential patterns in agent output.
// The patterns come from the one scan rule table, which the Admit policy crate
// also reads. This module holds no private copy of a rule.

import type { Finding, Scanner, ScannerConfig } from "./types.js";
import { scanRulesForClass } from "./admit-rule-table.js";

interface SecretPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

const SECRET_PATTERNS: SecretPattern[] = scanRulesForClass("secrets").map((rule) => ({
  name: rule.id,
  pattern: new RegExp(rule.ts?.pattern ?? "", rule.ts?.flags ?? "g"),
  category: rule.category,
}));

export class SecretsScanner implements Scanner {
  name = "secrets";
  private severity: ScannerConfig["severity"];

  constructor(config?: Partial<ScannerConfig>) {
    this.severity = config?.severity ?? "hard";
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    for (const { pattern, category } of SECRET_PATTERNS) {
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
