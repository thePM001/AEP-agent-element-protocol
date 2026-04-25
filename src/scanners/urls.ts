// AEP 2.5 -- URL Scanner
// Detects URLs in output with configurable allowlist/blocklist.
// Also detects obfuscated URL patterns (hxxp, [dot]).

import type { Finding, Scanner, URLScannerConfig } from "./types.js";
import type { ViolationSeverity } from "../recovery/types.js";

// Standard URL pattern
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

// Obfuscated URL patterns
const OBFUSCATED_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /hxxps?:\/\/[^\s<>"')\]]+/gi, name: "hxxp_scheme" },
  { pattern: /\w+\[dot\]\w+/gi, name: "bracket_dot" },
  { pattern: /\w+\[.\]\w+/gi, name: "bracket_period" },
];

function extractDomain(url: string): string {
  try {
    // Handle obfuscated URLs
    const normalized = url
      .replace(/^hxxp/i, "http")
      .replace(/\[dot\]/gi, ".")
      .replace(/\[.\]/g, ".");
    const parsed = new URL(normalized);
    return parsed.hostname;
  } catch {
    // Fallback: extract domain-like pattern
    const match = url.match(/(?:https?:\/\/|hxxps?:\/\/)([^/\s:]+)/i);
    return match?.[1]?.replace(/\[dot\]/gi, ".") ?? url;
  }
}

export class URLScanner implements Scanner {
  name = "urls";
  private severity: ViolationSeverity;
  private allowlist: string[];
  private blocklist: string[];

  constructor(config?: Partial<URLScannerConfig>) {
    this.severity = config?.severity ?? "soft";
    this.allowlist = config?.allowlist ?? [];
    this.blocklist = config?.blocklist ?? [];
  }

  scan(content: string): Finding[] {
    const findings: Finding[] = [];

    // Scan for standard URLs
    URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_PATTERN.exec(content)) !== null) {
      const domain = extractDomain(match[0]);
      const finding = this.evaluateURL(match[0], match.index, domain);
      if (finding) {
        findings.push(finding);
      }
    }

    // Scan for obfuscated URLs
    for (const { pattern, name } of OBFUSCATED_PATTERNS) {
      pattern.lastIndex = 0;
      let obfMatch: RegExpExecArray | null;
      while ((obfMatch = pattern.exec(content)) !== null) {
        findings.push({
          scanner: this.name,
          severity: this.severity,
          match: obfMatch[0],
          position: obfMatch.index,
          category: `url:obfuscated:${name}`,
        });
      }
    }

    return findings;
  }

  private evaluateURL(url: string, position: number, domain: string): Finding | null {
    // If blocklist has entries, check against it
    if (this.blocklist.length > 0) {
      const blocked = this.blocklist.some(
        (b) => domain === b || domain.endsWith(`.${b}`)
      );
      if (blocked) {
        return {
          scanner: this.name,
          severity: this.severity,
          match: url,
          position,
          category: "url:blocklisted",
        };
      }
    }

    // If allowlist has entries, anything not on it is flagged
    if (this.allowlist.length > 0) {
      const allowed = this.allowlist.some(
        (a) => domain === a || domain.endsWith(`.${a}`)
      );
      if (!allowed) {
        return {
          scanner: this.name,
          severity: this.severity,
          match: url,
          position,
          category: "url:not_allowed",
        };
      }
      return null; // Explicitly allowed
    }

    // No allowlist configured - flag all URLs as informational
    return {
      scanner: this.name,
      severity: this.severity,
      match: url,
      position,
      category: "url:detected",
    };
  }
}
