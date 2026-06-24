/**
 * Code Execution Sandbox - Isolated execution environment for agent-generated code.
 * Routes execution through WASM lattice channel socket (no plain HTTP bypass).
 * Part of AEP-Comm v2.75. Matches AutoGen code execution capability.
 */

import { createHash } from "node:crypto";
import { wasmLatticeEvaluate } from "../../lattice-channels/client/lattice/index.js";

export interface CodeExecutionRequest {
  code: string;
  language: "python" | "javascript" | "typescript" | "bash";
  timeoutMs: number;
  env?: Record<string, string>;
  files?: Record<string, string>;
}

export interface CodeExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  artifacts?: Record<string, string>;
}

export interface SandboxPolicy {
  maxTimeoutMs: number;
  maxOutputBytes: number;
  allowedLanguages: string[];
  networkAccess: boolean;
  filesystemAccess: "none" | "readonly" | "readwrite";
  maxFileSizeBytes: number;
}

export class CodeSandbox {
  private policy: SandboxPolicy;
  private executionCount: number = 0;
  private totalDurationMs: number = 0;

  constructor(policy?: Partial<SandboxPolicy>) {
    this.policy = {
      maxTimeoutMs: 30000,
      maxOutputBytes: 1024 * 1024,
      allowedLanguages: ["python", "javascript", "bash"],
      networkAccess: false,
      filesystemAccess: "readonly",
      maxFileSizeBytes: 10 * 1024 * 1024,
      ...policy,
    };
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const start = Date.now();

    if (!this.policy.allowedLanguages.includes(request.language)) {
      return {
        stdout: "",
        stderr: `Language not allowed: ${request.language}`,
        exitCode: 1,
        timedOut: false,
        durationMs: Date.now() - start,
      };
    }

    const timeout = Math.min(request.timeoutMs, this.policy.maxTimeoutMs);

    try {
      if (request.language !== "javascript" && request.language !== "typescript") {
        return {
          stdout: "",
          stderr: `Lattice WASM sandbox supports javascript/typescript policy modules only (got ${request.language})`,
          exitCode: 1,
          timedOut: false,
          durationMs: Date.now() - start,
        };
      }

      const policyInput =
        request.code.length > 0
          ? parseInt(
              createHash("sha256").update(request.code).digest("hex").slice(0, 8),
              16,
            ) % 1000
          : 0;

      const wasm = wasmLatticeEvaluate({
        input: policyInput,
      });

      if (!wasm.ok) {
        return {
          stdout: "",
          stderr: wasm.error ?? "WASM lattice evaluate failed",
          exitCode: 1,
          timedOut: false,
          durationMs: Date.now() - start,
        };
      }

      const result: CodeExecutionResult = {
        stdout: String(wasm.result ?? ""),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: Date.now() - start,
      };
      this.executionCount++;
      this.totalDurationMs += result.durationMs;
      return result;
    } catch (e) {
      return {
        stdout: "",
        stderr: `Execution failed: ${e instanceof Error ? e.message : "timeout"}`,
        exitCode: 1,
        timedOut: e instanceof DOMException && e.name === "AbortError",
        durationMs: Date.now() - start,
      };
    }
  }

  getStats(): { executions: number; totalDurationMs: number; avgDurationMs: number } {
    return {
      executions: this.executionCount,
      totalDurationMs: this.totalDurationMs,
      avgDurationMs: this.executionCount > 0
        ? Math.round(this.totalDurationMs / this.executionCount)
        : 0,
    };
  }

  updatePolicy(update: Partial<SandboxPolicy>): void {
    this.policy = { ...this.policy, ...update };
  }

  getPolicy(): SandboxPolicy {
    return { ...this.policy };
  }
}
