// AEP 2.5 -- Temporal Governance Scanner
// Enforces time-related constraints on agent output.

import type { Finding, ScannerConfig, TemporalScannerConfig } from "./types.js";
import type { Scanner } from "./types.js";

// Date patterns for detection
const ISO_DATE = /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const MONTH_DD_YYYY = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/gi;
const DD_MM_YYYY = /\b(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2])\/(20\d{2})\b/g;
const QUARTER_YEAR = /\bQ([1-4])\s+(20\d{2})\b/gi;
const MONTH_YEAR = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/gi;
const AS_OF_PATTERN = /\bas\s+of\s+/gi;

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3,
  may: 4, june: 5, july: 6, august: 7,
  september: 8, october: 9, november: 10, december: 11,
};

const STATISTIC_PATTERNS: RegExp[] = [
  /\b(?:unemployment|inflation|gdp|growth|rate|percentage|ratio)\s+(?:is|was|stands?\s+at|remains?)\s+\d+(?:\.\d+)?%/gi,
  /\b\d+(?:\.\d+)?%\s+(?:unemployment|inflation|gdp|growth|adoption|penetration|market\s+share)/gi,
  /\b(?:population|revenue|users|customers|subscribers)\s+(?:is|was|reached|hit|stands?\s+at)\s+[\d,.]+/gi,
];

const PROMOTION_PATTERNS: RegExp[] = [
  /\b(?:offer|promotion|deal|coupon|code)\s+(?:expires?|ends?|valid\s+(?:until|through|till))/gi,
  /\b(?:deadline|registration\s+closes?|last\s+day|closing\s+date|submit\s+by)\b/gi,
  /\b(?:event|conference|webinar|workshop|sale)\s+(?:on|at|from)\b/gi,
];

function parseDate(dateStr: string, format: string): Date | null {
  try {
    switch (format) {
      case "iso": {
        const [y, m, d] = dateStr.split("-").map(Number);
        return new Date(y, m - 1, d);
      }
      case "month_dd_yyyy": {
        const parts = dateStr.match(
          /(\w+)\s+(\d+),?\s+(\d+)/
        );
        if (!parts) return null;
        const month = MONTH_MAP[parts[1].toLowerCase()];
        if (month === undefined) return null;
        return new Date(parseInt(parts[3]), month, parseInt(parts[2]));
      }
      case "dd_mm_yyyy": {
        const [d, m, y] = dateStr.split("/").map(Number);
        return new Date(y, m - 1, d);
      }
      case "quarter": {
        const qParts = dateStr.match(/Q(\d)\s+(\d{4})/);
        if (!qParts) return null;
        const q = parseInt(qParts[1]);
        const year = parseInt(qParts[2]);
        return new Date(year, (q - 1) * 3, 1);
      }
      case "month_year": {
        const mParts = dateStr.match(/(\w+)\s+(\d{4})/);
        if (!mParts) return null;
        const mo = MONTH_MAP[mParts[1].toLowerCase()];
        if (mo === undefined) return null;
        return new Date(parseInt(mParts[2]), mo, 1);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

interface DetectedDate {
  date: Date;
  match: string;
  position: number;
}

export class TemporalScanner implements Scanner {
  name = "temporal";
  private severity: ScannerConfig["severity"];
  private maxFutureDays: number;
  private checkStaleReferences: boolean;
  private checkUndatedStatistics: boolean;
  private checkExpiredContent: boolean;
  private referenceDate: Date;

  constructor(config?: Partial<TemporalScannerConfig>) {
    this.severity = config?.severity ?? "soft";
    this.maxFutureDays = config?.max_future_days ?? 365;
    this.checkStaleReferences = config?.check_stale_references ?? true;
    this.checkUndatedStatistics = config?.check_undated_statistics ?? true;
    this.checkExpiredContent = config?.check_expired_content ?? true;
    this.referenceDate = config?.reference_date
      ? new Date(config.reference_date)
      : new Date();
  }

  private detectDates(content: string): DetectedDate[] {
    const dates: DetectedDate[] = [];

    ISO_DATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ISO_DATE.exec(content)) !== null) {
      const d = parseDate(m[0], "iso");
      if (d) dates.push({ date: d, match: m[0], position: m.index });
    }

    MONTH_DD_YYYY.lastIndex = 0;
    while ((m = MONTH_DD_YYYY.exec(content)) !== null) {
      const d = parseDate(m[0], "month_dd_yyyy");
      if (d) dates.push({ date: d, match: m[0], position: m.index });
    }

    DD_MM_YYYY.lastIndex = 0;
    while ((m = DD_MM_YYYY.exec(content)) !== null) {
      const d = parseDate(m[0], "dd_mm_yyyy");
      if (d) dates.push({ date: d, match: m[0], position: m.index });
    }

    QUARTER_YEAR.lastIndex = 0;
    while ((m = QUARTER_YEAR.exec(content)) !== null) {
      const d = parseDate(m[0], "quarter");
      if (d) dates.push({ date: d, match: m[0], position: m.index });
    }

    MONTH_YEAR.lastIndex = 0;
    while ((m = MONTH_YEAR.exec(content)) !== null) {
      const d = parseDate(m[0], "month_year");
      if (d) dates.push({ date: d, match: m[0], position: m.index });
    }

    return dates;
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];
    const now = this.referenceDate;
    const maxFutureDate = new Date(
      now.getTime() + this.maxFutureDays * 24 * 60 * 60 * 1000
    );

    const detectedDates = this.detectDates(content);

    // Rule 1: Stale date references
    if (this.checkStaleReferences) {
      for (const dd of detectedDates) {
        if (dd.date < now) {
          // Check for "as of" qualifier nearby (within 50 chars before)
          const contextStart = Math.max(0, dd.position - 50);
          const context = content.substring(contextStart, dd.position + dd.match.length);
          AS_OF_PATTERN.lastIndex = 0;
          const hasAsOf = AS_OF_PATTERN.test(context);

          // Only flag if not qualified with "as of"
          if (!hasAsOf) {
            findings.push({
              scanner: this.name,
              severity: this.severity,
              match: dd.match,
              position: dd.position,
              category: "temporal:stale_reference",
            });
          }
        }
      }
    }

    // Rule 2: Excessive future horizon
    for (const dd of detectedDates) {
      if (dd.date > maxFutureDate) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: dd.match,
          position: dd.position,
          category: "temporal:excessive_horizon",
        });
      }
    }

    // Rule 3: Undated statistics
    if (this.checkUndatedStatistics) {
      for (const pattern of STATISTIC_PATTERNS) {
        pattern.lastIndex = 0;
        let statMatch: RegExpExecArray | null;
        while ((statMatch = pattern.exec(content)) !== null) {
          // Check if there is any date reference within 100 chars
          const start = Math.max(0, statMatch.index - 100);
          const end = Math.min(
            content.length,
            statMatch.index + statMatch[0].length + 100
          );
          const surrounding = content.substring(start, end);

          const hasDatedContext = this.detectDates(surrounding).length > 0 ||
            /\bas\s+of\b/i.test(surrounding) ||
            /\bin\s+20\d{2}\b/i.test(surrounding) ||
            /\bcurrent(?:ly)?\b/i.test(surrounding);

          if (!hasDatedContext) {
            findings.push({
              scanner: this.name,
              severity: this.severity,
              match: statMatch[0],
              position: statMatch.index,
              category: "temporal:undated_statistic",
            });
          }
        }
      }
    }

    // Rule 4: Expired content
    if (this.checkExpiredContent) {
      for (const pattern of PROMOTION_PATTERNS) {
        pattern.lastIndex = 0;
        let promoMatch: RegExpExecArray | null;
        while ((promoMatch = pattern.exec(content)) !== null) {
          // Look for dates near this promotion reference
          const start = Math.max(0, promoMatch.index - 50);
          const end = Math.min(
            content.length,
            promoMatch.index + promoMatch[0].length + 100
          );
          const surrounding = content.substring(start, end);
          const nearbyDates = this.detectDates(surrounding);

          for (const nd of nearbyDates) {
            if (nd.date < now) {
              findings.push({
                scanner: this.name,
                severity: this.severity,
                match: promoMatch[0] + " " + nd.match,
                position: promoMatch.index,
                category: "temporal:expired_content",
              });
            }
          }
        }
      }
    }

    return findings;
  }
}
