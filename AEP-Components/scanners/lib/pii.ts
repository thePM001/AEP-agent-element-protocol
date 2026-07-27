// AEP 2.75 - PII Scanner
// Detects personally identifiable information in agent output.
// Regex-based detection - no LLM needed.

import type { Finding, Scanner, ScannerConfig } from "./types.js";

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// Luhn-valid credit card number patterns (13-19 digits with optional separators)
const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g;

// US Social Security Number
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;

// Spanish NIF/NIE
const NIF_PATTERN = /\b[XYZ]?\d{7,8}[A-Z]\b/g;

// UK National Insurance Number
const NINO_PATTERN = /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g;

interface PIIPattern {
  name: string;
  pattern: RegExp;
  category: string;
}

const PII_PATTERNS: PIIPattern[] = [
  { name: "email", pattern: EMAIL_PATTERN, category: "email" },
  { name: "phone", pattern: PHONE_PATTERN, category: "phone" },
  { name: "credit_card", pattern: CREDIT_CARD_PATTERN, category: "credit_card" },
  { name: "ssn", pattern: SSN_PATTERN, category: "national_id" },
  { name: "nif", pattern: NIF_PATTERN, category: "national_id" },
  { name: "nino", pattern: NINO_PATTERN, category: "national_id" },
];

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
          category: `pii:${category}`,
        });
      }
    }

    return findings;
  }
}
