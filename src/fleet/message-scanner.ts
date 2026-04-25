import type { ScannerPipeline } from "../scanners/pipeline.js";
import type { MessageScanResult } from "./types.js";

/**
 * Scans inter-agent messages through the scanner pipeline.
 * Prevents poisoned instructions, PII leaks and injection
 * attempts between agents in a fleet.
 */
export class MessageScanner {
  private pipeline: ScannerPipeline;

  constructor(pipeline: ScannerPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Scan a message sent between agents.
   * Hard findings block the message. Soft findings flag it.
   */
  scanMessage(from: string, to: string, content: string): MessageScanResult {
    const result = this.pipeline.scan(content);

    if (result.passed) {
      return { passed: true, blocked: false, findings: [] };
    }

    const hardFindings = result.findings.filter(f => f.severity === "hard");
    const blocked = hardFindings.length > 0;

    return {
      passed: result.passed,
      blocked,
      findings: result.findings.map(f => ({
        scanner: f.scanner,
        severity: f.severity,
        category: f.category,
        match: f.match,
      })),
    };
  }
}
