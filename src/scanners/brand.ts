// AEP 2.5 -- Brand Compliance Scanner
// Checks generated content against brand guidelines.

import type { Finding, ScannerConfig, BrandScannerConfig } from "./types.js";
import type { Scanner } from "./types.js";

export class BrandScanner implements Scanner {
  name = "brand";
  private severity: ScannerConfig["severity"];
  private requiredPhrases: string[];
  private forbiddenPhrases: string[];
  private toneKeywords: string[];
  private competitors: string[];
  private trademarks: { term: string; suffix: string }[];

  constructor(config?: Partial<BrandScannerConfig>) {
    this.severity = config?.severity ?? "soft";
    this.requiredPhrases = config?.required_phrases ?? [];
    this.forbiddenPhrases = config?.forbidden_phrases ?? [];
    this.toneKeywords = config?.tone_keywords ?? [];
    this.competitors = config?.competitors ?? [];
    this.trademarks = config?.trademarks ?? [];
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    const lower = content.toLowerCase();

    // Rule 1: Missing required phrases
    for (const phrase of this.requiredPhrases) {
      if (!lower.includes(phrase.toLowerCase())) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: phrase,
          position: 0,
          category: "brand:missing_required_phrase",
        });
      }
    }

    // Rule 2: Forbidden phrases (hard severity)
    for (const phrase of this.forbiddenPhrases) {
      const phraseLower = phrase.toLowerCase();
      let idx = lower.indexOf(phraseLower);
      while (idx !== -1) {
        findings.push({
          scanner: this.name,
          severity: "hard",
          match: content.substring(idx, idx + phrase.length),
          position: idx,
          category: "brand:forbidden_phrase",
        });
        idx = lower.indexOf(phraseLower, idx + 1);
      }
    }

    // Rule 3: Off-tone content
    if (this.toneKeywords.length > 0) {
      const hasAnyToneKeyword = this.toneKeywords.some(
        (kw) => lower.includes(kw.toLowerCase())
      );
      if (!hasAnyToneKeyword) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: "content lacks tone keywords",
          position: 0,
          category: "brand:off_tone",
        });
      }
    }

    // Rule 4: Competitor mentions
    for (const competitor of this.competitors) {
      const competitorLower = competitor.toLowerCase();
      let idx = lower.indexOf(competitorLower);
      while (idx !== -1) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: content.substring(idx, idx + competitor.length),
          position: idx,
          category: "brand:competitor_mention",
        });
        idx = lower.indexOf(competitorLower, idx + 1);
      }
    }

    // Rule 5: Trademark enforcement
    for (const tm of this.trademarks) {
      const termPattern = new RegExp(
        tm.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "gi"
      );
      termPattern.lastIndex = 0;
      let tmMatch: RegExpExecArray | null;
      while ((tmMatch = termPattern.exec(content)) !== null) {
        const afterMatch = content.substring(
          tmMatch.index + tmMatch[0].length,
          tmMatch.index + tmMatch[0].length + tm.suffix.length + 2
        );
        if (!afterMatch.includes(tm.suffix)) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: tmMatch[0],
            position: tmMatch.index,
            category: "brand:trademark_missing",
          });
        }
      }
    }

    return findings;
  }
}
