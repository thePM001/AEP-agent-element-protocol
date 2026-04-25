// AEP 2.5 -- Scanner Pipeline
// Orchestrates all content scanners in sequence.
// Runs AFTER structural validation, BEFORE final approval.

import type { Scanner, ScanResult, Finding, ScannersConfig } from "./types.js";
import { PIIScanner } from "./pii.js";
import { InjectionScanner } from "./injection.js";
import { SecretsScanner } from "./secrets.js";
import { JailbreakScanner } from "./jailbreak.js";
import { ToxicityScanner } from "./toxicity.js";
import { URLScanner } from "./urls.js";

export class ScannerPipeline {
  private scanners: Scanner[];

  constructor(scanners: Scanner[]) {
    this.scanners = scanners;
  }

  getScanners(): Scanner[] {
    return [...this.scanners];
  }

  /**
   * Run all scanners against content.
   * Returns combined results with pass/fail and all findings.
   */
  scan(content: string): ScanResult {
    const findings: Finding[] = [];

    for (const scanner of this.scanners) {
      const scannerFindings = scanner.scan(content);
      findings.push(...scannerFindings);
    }

    // Pipeline fails if any finding exists
    return {
      passed: findings.length === 0,
      findings,
    };
  }
}

/**
 * Creates a scanner pipeline with default configuration.
 * Scanners that are disabled in config are excluded from the pipeline.
 */
export function createDefaultPipeline(config?: Partial<ScannersConfig>): ScannerPipeline {
  const scanners: Scanner[] = [];

  // PII scanner
  if (config?.pii?.enabled !== false) {
    scanners.push(new PIIScanner({ severity: config?.pii?.severity ?? "hard" }));
  }

  // Injection scanner
  if (config?.injection?.enabled !== false) {
    scanners.push(new InjectionScanner({ severity: config?.injection?.severity ?? "hard" }));
  }

  // Secrets scanner
  if (config?.secrets?.enabled !== false) {
    scanners.push(new SecretsScanner({ severity: config?.secrets?.severity ?? "hard" }));
  }

  // Jailbreak scanner
  if (config?.jailbreak?.enabled !== false) {
    scanners.push(new JailbreakScanner({ severity: config?.jailbreak?.severity ?? "hard" }));
  }

  // Toxicity scanner
  if (config?.toxicity?.enabled !== false) {
    scanners.push(
      new ToxicityScanner({
        severity: config?.toxicity?.severity ?? "soft",
        custom_words: config?.toxicity?.custom_words,
      })
    );
  }

  // URL scanner
  if (config?.urls?.enabled !== false) {
    scanners.push(
      new URLScanner({
        severity: config?.urls?.severity ?? "soft",
        allowlist: config?.urls?.allowlist ?? [],
        blocklist: config?.urls?.blocklist ?? [],
      })
    );
  }

  return new ScannerPipeline(scanners);
}
