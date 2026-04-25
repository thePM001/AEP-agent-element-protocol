// AEP 2.5 -- Recovery Engine Types
// Hard/soft violation distinction with automatic recovery for soft failures.

export type ViolationSeverity = "hard" | "soft";

export type ViolationSource = "covenant" | "policy" | "scanner";

export interface Violation {
  rule: string;
  severity: ViolationSeverity;
  source: ViolationSource;
  details: string;
}

export interface RecoveryAttempt {
  attemptNumber: number;
  violation: Violation;
  correctionPrompt: string;
  newOutput: string;
  result: "recovered" | "failed";
}

export interface RecoveryConfig {
  maxAttempts: number;
  enabled: boolean;
}

export interface RecoveryResult {
  recovered: boolean;
  attempts: RecoveryAttempt[];
  finalOutput?: string;
}

export type RecoveryCallback = (correctionPrompt: string) => string;
