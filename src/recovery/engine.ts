// AEP 2.5 -- Recovery Engine
// Attempts automatic recovery for soft violations before final reject.
// Hard violations bypass recovery entirely.

import type {
  Violation,
  RecoveryConfig,
  RecoveryResult,
  RecoveryAttempt,
  RecoveryCallback,
} from "./types.js";

export class RecoveryEngine {
  private config: RecoveryConfig;

  constructor(config: RecoveryConfig) {
    this.config = config;
  }

  getConfig(): RecoveryConfig {
    return { ...this.config };
  }

  /**
   * Builds a corrective prompt instructing the agent to regenerate
   * output without the violation.
   */
  buildCorrectionPrompt(violation: Violation): string {
    const parts: string[] = [
      `Your previous output was flagged for a soft violation.`,
      ``,
      `Violation type: ${violation.source}`,
      `Rule: ${violation.rule}`,
      `Details: ${violation.details}`,
      ``,
      `Regenerate your output to avoid this violation.`,
      `Do not include the content that triggered this rule.`,
    ];
    return parts.join("\n");
  }

  /**
   * Attempts recovery for a soft violation.
   *
   * @param violation - The soft violation that triggered recovery
   * @param regenerate - Callback that takes a correction prompt and returns new output
   * @param validate - Callback that validates new output, returning null if clean
   *                   or a Violation if still failing
   * @returns RecoveryResult indicating whether recovery succeeded
   */
  attemptRecovery(
    violation: Violation,
    regenerate: RecoveryCallback,
    validate: (output: string) => Violation | null
  ): RecoveryResult {
    if (!this.config.enabled) {
      return { recovered: false, attempts: [] };
    }

    if (violation.severity === "hard") {
      return { recovered: false, attempts: [] };
    }

    const attempts: RecoveryAttempt[] = [];

    let currentViolation = violation;
    for (let i = 1; i <= this.config.maxAttempts; i++) {
      const correctionPrompt = this.buildCorrectionPrompt(currentViolation);
      const newOutput = regenerate(correctionPrompt);

      const revalidation = validate(newOutput);

      if (revalidation === null) {
        // Recovery succeeded - output is clean
        attempts.push({
          attemptNumber: i,
          violation: currentViolation,
          correctionPrompt,
          newOutput,
          result: "recovered",
        });
        return {
          recovered: true,
          attempts,
          finalOutput: newOutput,
        };
      }

      // Still failing - record attempt and try again
      attempts.push({
        attemptNumber: i,
        violation: currentViolation,
        correctionPrompt,
        newOutput,
        result: "failed",
      });
      currentViolation = revalidation;
    }

    // All attempts exhausted - escalate to hard reject
    return {
      recovered: false,
      attempts,
    };
  }
}
