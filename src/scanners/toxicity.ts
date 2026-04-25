// AEP 2.5 -- Toxicity Scanner
// Detects slurs, hate speech patterns and threats.
// Keyword list with configurable word lists.

import type { Finding, Scanner, ToxicityScannerConfig } from "./types.js";
import type { ViolationSeverity } from "../recovery/types.js";

// Default threat patterns (non-exhaustive, configurable)
const DEFAULT_THREAT_PATTERNS: RegExp[] = [
  /\bi\s+will\s+(?:kill|hurt|harm|destroy|attack)\b/gi,
  /\bthreat(?:en|ening)?\b/gi,
  /\bgoing\s+to\s+(?:kill|hurt|harm|destroy|attack)\b/gi,
];

export class ToxicityScanner implements Scanner {
  name = "toxicity";
  private severity: ViolationSeverity;
  private customWords: string[];

  constructor(config?: Partial<ToxicityScannerConfig>) {
    this.severity = config?.severity ?? "soft";
    this.customWords = config?.customWords ?? [];
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    const lower = content.toLowerCase();

    // Check custom word list
    for (const word of this.customWords) {
      const wordLower = word.toLowerCase();
      let idx = lower.indexOf(wordLower);
      while (idx !== -1) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: content.substring(idx, idx + word.length),
          position: idx,
          category: "toxicity:custom_word",
        });
        idx = lower.indexOf(wordLower, idx + 1);
      }
    }

    // Check threat patterns
    for (const pattern of DEFAULT_THREAT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category: "toxicity:threat",
        });
      }
    }

    return findings;
  }
}
