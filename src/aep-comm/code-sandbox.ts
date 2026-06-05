/**
 * Code Execution Sandbox - Isolated execution environment for agent-generated code.
 * Uses microVM pattern for hardware-level isolation.
 * Part of AEP-Comm v2.75. Matches AutoGen code execution capability.
 */

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch("http://127.0.0.1:8423/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: request.code,
          language: request.language,
          env: request.env,
          files: request.files,
          policy: this.policy,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          stdout: "",
          stderr: `Sandbox error: HTTP ${response.status}`,
          exitCode: 1,
          timedOut: false,
          durationMs: Date.now() - start,
        };
      }

      const result: CodeExecutionResult = await response.json();
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
