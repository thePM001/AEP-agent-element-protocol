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
import { DataProfileScanner } from "./profiler.js";
import { PredictionScanner } from "./prediction.js";
import { BrandScanner } from "./brand.js";
import { RegulatoryScanner } from "./regulatory.js";
import { TemporalScanner } from "./temporal.js";

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

  // Data profiler scanner (disabled by default -- opt-in)
  if (config?.profiler?.enabled === true) {
    scanners.push(
      new DataProfileScanner({
        severity: config.profiler.severity ?? "soft",
        null_rate_threshold: config.profiler.null_rate_threshold,
        duplicate_rate_threshold: config.profiler.duplicate_rate_threshold,
        outlier_stddev: config.profiler.outlier_stddev,
        imbalance_ratio: config.profiler.imbalance_ratio,
      })
    );
  }

  // Prediction scanner (disabled by default -- opt-in)
  if (config?.prediction?.enabled === true) {
    scanners.push(
      new PredictionScanner({
        severity: config.prediction.severity ?? "soft",
        max_percentage: config.prediction.max_percentage,
        max_horizon_days: config.prediction.max_horizon_days,
        require_confidence: config.prediction.require_confidence,
        block_certainty_language: config.prediction.block_certainty_language,
      })
    );
  }

  // Brand scanner (disabled by default -- opt-in)
  if (config?.brand?.enabled === true) {
    scanners.push(
      new BrandScanner({
        severity: config.brand.severity ?? "soft",
        required_phrases: config.brand.required_phrases,
        forbidden_phrases: config.brand.forbidden_phrases,
        tone_keywords: config.brand.tone_keywords,
        competitors: config.brand.competitors,
        trademarks: config.brand.trademarks,
      })
    );
  }

  // Regulatory scanner (disabled by default -- opt-in)
  if (config?.regulatory?.enabled === true) {
    scanners.push(
      new RegulatoryScanner({
        severity: config.regulatory.severity ?? "hard",
        check_ad_disclosure: config.regulatory.check_ad_disclosure,
        check_financial_disclaimer: config.regulatory.check_financial_disclaimer,
        check_medical_disclaimer: config.regulatory.check_medical_disclaimer,
        check_affiliate_disclosure: config.regulatory.check_affiliate_disclosure,
        check_age_restriction: config.regulatory.check_age_restriction,
        custom_disclosures: config.regulatory.custom_disclosures,
      })
    );
  }

  // Temporal scanner (disabled by default -- opt-in)
  if (config?.temporal?.enabled === true) {
    scanners.push(
      new TemporalScanner({
        severity: config.temporal.severity ?? "soft",
        max_future_days: config.temporal.max_future_days,
        check_stale_references: config.temporal.check_stale_references,
        check_undated_statistics: config.temporal.check_undated_statistics,
        check_expired_content: config.temporal.check_expired_content,
        reference_date: config.temporal.reference_date,
      })
    );
  }

  return new ScannerPipeline(scanners);
}
