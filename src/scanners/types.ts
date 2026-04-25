// AEP 2.5 -- Content Scanner Types
// Shared types for the content scanner pipeline.

import type { ViolationSeverity } from "../recovery/types.js";

export interface Finding {
  scanner: string;
  severity: ViolationSeverity;
  match: string;
  position: number;
  category: string;
}

export interface ScanResult {
  passed: boolean;
  findings: Finding[];
}

export interface Scanner {
  name: string;
  scan(content: string): Finding[];
}

export interface ScannerConfig {
  enabled: boolean;
  severity: ViolationSeverity;
}

export interface URLScannerConfig extends ScannerConfig {
  allowlist: string[];
  blocklist: string[];
}

export interface ToxicityScannerConfig extends ScannerConfig {
  custom_words?: string[];
}

export interface DataProfileScannerConfig extends ScannerConfig {
  null_rate_threshold: number;
  duplicate_rate_threshold: number;
  outlier_stddev: number;
  imbalance_ratio: number;
}

export interface PredictionScannerConfig extends ScannerConfig {
  max_percentage: number;
  max_horizon_days: number;
  require_confidence: boolean;
  block_certainty_language: boolean;
}

export interface BrandScannerConfig extends ScannerConfig {
  required_phrases: string[];
  forbidden_phrases: string[];
  tone_keywords: string[];
  competitors: string[];
  trademarks: { term: string; suffix: string }[];
}

export interface CustomDisclosureRule {
  trigger_patterns: string[];
  required_phrases: string[];
  severity: "hard" | "soft";
}

export interface RegulatoryScannerConfig extends ScannerConfig {
  check_ad_disclosure: boolean;
  check_financial_disclaimer: boolean;
  check_medical_disclaimer: boolean;
  check_affiliate_disclosure: boolean;
  check_age_restriction: boolean;
  custom_disclosures: CustomDisclosureRule[];
}

export interface TemporalScannerConfig extends ScannerConfig {
  max_future_days: number;
  check_stale_references: boolean;
  check_undated_statistics: boolean;
  check_expired_content: boolean;
  reference_date?: string;
}

export interface ScannersConfig {
  enabled: boolean;
  pii: ScannerConfig;
  injection: ScannerConfig;
  secrets: ScannerConfig;
  jailbreak: ScannerConfig;
  toxicity: ToxicityScannerConfig;
  urls: URLScannerConfig;
  profiler: DataProfileScannerConfig;
  prediction: PredictionScannerConfig;
  brand: BrandScannerConfig;
  regulatory: RegulatoryScannerConfig;
  temporal: TemporalScannerConfig;
}
