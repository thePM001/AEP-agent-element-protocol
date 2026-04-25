// AEP 2.5 -- Prediction Validator Scanner
// Detects prediction/forecast patterns and validates against configurable bounds.

import type { Finding, ScannerConfig, PredictionScannerConfig } from "./types.js";
import type { Scanner } from "./types.js";

const PERCENTAGE_PATTERN = /(?:increase|decrease|grow(?:th)?|rise|drop|decline|gain|surge|fall|jump|spike|crash|reduce|expand|shrink|boost|plummet|soar)\s+(?:by|of)\s+(\d+(?:\.\d+)?)\s*%/gi;

const CERTAINTY_PATTERNS: RegExp[] = [
  /\bguaranteed\s+to\b/gi,
  /\bwill\s+definitely\b/gi,
  /\bcertain\s+to\b/gi,
  /\bimpossible\s+to\s+fail\b/gi,
  /\bwithout\s+(?:any\s+)?doubt\s+will\b/gi,
  /\babsolutely\s+will\b/gi,
  /\b100%\s+(?:chance|certain|guaranteed|sure)\b/gi,
];

const CONFIDENCE_QUALIFIERS = [
  "approximately",
  "estimated",
  "roughly",
  "confidence interval",
  "margin of error",
  "plus or minus",
  "give or take",
  "likely",
  "probably",
  "projected",
  "forecast",
  "expected",
  "anticipated",
  "uncertain",
  "range of",
];

const NUMERIC_PREDICTION_PATTERN = /(?:will\s+(?:reach|hit|exceed|surpass|achieve)|(?:revenue|demand|sales|profit|growth|output|production|earnings)\s+(?:of|at|reaching))\s+\$?[\d,]+(?:\.\d+)?(?:\s*(?:million|billion|thousand|units|users|customers|subscribers))?/gi;

const YEAR_PATTERN = /\bby\s+(20\d{2})\b/gi;
const WITHIN_YEARS_PATTERN = /\bwithin\s+(\d+)\s+years?\b/gi;
const QUARTER_PATTERN = /\b(?:next|in)\s+(?:Q[1-4]|(?:the\s+)?(?:first|second|third|fourth)\s+quarter)\s+(?:of\s+)?(20\d{2})?\b/gi;

export class PredictionScanner implements Scanner {
  name = "prediction";
  private severity: ScannerConfig["severity"];
  private maxPercentage: number;
  private maxHorizonDays: number;
  private requireConfidence: boolean;
  private blockCertaintyLanguage: boolean;

  constructor(config?: Partial<PredictionScannerConfig>) {
    this.severity = config?.severity ?? "soft";
    this.maxPercentage = config?.max_percentage ?? 100;
    this.maxHorizonDays = config?.max_horizon_days ?? 365;
    this.requireConfidence = config?.require_confidence ?? true;
    this.blockCertaintyLanguage = config?.block_certainty_language ?? true;
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    // Rule 1: Extreme percentage predictions
    PERCENTAGE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PERCENTAGE_PATTERN.exec(content)) !== null) {
      const pct = parseFloat(match[1]);
      if (pct > this.maxPercentage) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category: "prediction:extreme_percentage",
        });
      }
    }

    // Rule 2: Certainty language
    if (this.blockCertaintyLanguage) {
      for (const pattern of CERTAINTY_PATTERNS) {
        pattern.lastIndex = 0;
        let certMatch: RegExpExecArray | null;
        while ((certMatch = pattern.exec(content)) !== null) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: certMatch[0],
            position: certMatch.index,
            category: "prediction:false_certainty",
          });
        }
      }
    }

    // Rule 3: Missing confidence qualifier on numeric predictions
    if (this.requireConfidence) {
      NUMERIC_PREDICTION_PATTERN.lastIndex = 0;
      let numMatch: RegExpExecArray | null;
      while ((numMatch = NUMERIC_PREDICTION_PATTERN.exec(content)) !== null) {
        const hasQualifier = CONFIDENCE_QUALIFIERS.some(
          (q) => content.toLowerCase().includes(q.toLowerCase())
        );
        if (!hasQualifier) {
          findings.push({
            scanner: this.name,
            severity: this.severity,
            match: numMatch[0],
            position: numMatch.index,
            category: "prediction:no_confidence_qualifier",
          });
        }
      }
    }

    // Rule 4: Extreme timeframe
    const now = new Date();
    const maxDate = new Date(now.getTime() + this.maxHorizonDays * 24 * 60 * 60 * 1000);

    YEAR_PATTERN.lastIndex = 0;
    while ((match = YEAR_PATTERN.exec(content)) !== null) {
      const year = parseInt(match[1], 10);
      const targetDate = new Date(year, 0, 1);
      if (targetDate > maxDate) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category: "prediction:extreme_timeframe",
        });
      }
    }

    WITHIN_YEARS_PATTERN.lastIndex = 0;
    while ((match = WITHIN_YEARS_PATTERN.exec(content)) !== null) {
      const years = parseInt(match[1], 10);
      const daysAhead = years * 365;
      if (daysAhead > this.maxHorizonDays) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: match[0],
          position: match.index,
          category: "prediction:extreme_timeframe",
        });
      }
    }

    return findings;
  }
}
