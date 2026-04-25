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

export interface ScannersConfig {
  enabled: boolean;
  pii: ScannerConfig;
  injection: ScannerConfig;
  secrets: ScannerConfig;
  jailbreak: ScannerConfig;
  toxicity: ToxicityScannerConfig;
  urls: URLScannerConfig;
}
