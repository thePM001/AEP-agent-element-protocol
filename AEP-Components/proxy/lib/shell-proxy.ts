// BL-04: use in-tree AgentGateway (SDK), not non-local ../gateway.js
import { AgentGateway } from "../../../AEP-SDKs/typescript/aep-protocol/src/gateway.js";
import type { AgentAction, Policy } from "../../policy-engine/lib/policy/types.js";
import type { Session } from "../../session/lib/session.js";

export interface ShellProxyOptions {
  policy: Policy;
  ledgerDir: string;
}

export interface ShellResult {
  allowed: boolean;
  command: string;
  reasons: string[];
  actionId?: string;
}

/**
 * Shell Proxy validates commands against policy before execution.
 * Wraps command execution with forbidden pattern and capability checks.
 */
export class ShellProxy {
  private gateway: AgentGateway;
  private policy: Policy;
  private session: Session | null = null;

  constructor(options: ShellProxyOptions) {
    this.policy = options.policy;
    this.gateway = new AgentGateway({ ledgerDir: options.ledgerDir });
  }

  start(metadata?: Record<string, string>): Session {
    this.session = this.gateway.createSessionFromPolicy(
      this.policy,
      metadata
    );
    return this.session;
  }

  evaluateCommand(command: string): ShellResult {
    if (!this.session) {
      return {
        allowed: false,
        command,
        reasons: ["No active session."],
      };
    }

    const parts = command.trim()/* L-16 */ .match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(t=>t.replace(/^["']|["']$/g,"")) ?? [];
    const binary = parts[0] ?? "";

    // Absolute binary only; refuse shell metacharacters and relative PATH lookups.
    if (!binary.startsWith("/") || binary.includes("..")) {
      return {
        allowed: false,
        command,
        reasons: ["ShellProxy requires absolute binary path (no PATH lookup)."],
      };
    }

    const action: AgentAction = {
      tool: "command:run",
      input: { command: binary, args: parts.slice(1), raw: command },
      timestamp: new Date(),
    };

    const verdict = this.gateway.evaluate(this.session.id, action);

    return {
      allowed: verdict.decision === "allow",
      command,
      reasons: verdict.reasons,
      actionId: verdict.actionId,
    };
  }

  /**
   * Dry-run only by default. Execution requires AEP_SHELL_PROXY_EXECUTE=1
   * and prior evaluate allow with absolute argv (no shell string).
   */
  executeCommand(command: string): ShellResult & { executed?: boolean; stdout?: string } {
    const evalResult = this.evaluateCommand(command);
    if (!evalResult.allowed) {
      return { ...evalResult, executed: false };
    }
    if (process.env.AEP_SHELL_PROXY_EXECUTE !== "1") {
      return {
        ...evalResult,
        executed: false,
        reasons: [
          ...evalResult.reasons,
          "execution disabled (set AEP_SHELL_PROXY_EXECUTE=1 after policy allow)",
        ],
      };
    }
    const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((t) => t.replace(/^["']|["']$/g, "")) ?? [];
    const binary = parts[0] ?? "";
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require("node:child_process") as {
        execFileSync: (f: string, a: string[], o: Record<string, unknown>) => Buffer;
      };
      const out = execFileSync(binary, parts.slice(1), {
        encoding: "utf-8",
        timeout: 30_000,
      }) as unknown as string;
      return { ...evalResult, executed: true, stdout: out };
    } catch (err) {
      return {
        ...evalResult,
        allowed: false,
        executed: false,
        reasons: [
          ...evalResult.reasons,
          `execution failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
  }

  stop(reason: string = "shell proxy stopped") {
    if (this.session) {
      return this.gateway.terminateSession(this.session.id, reason);
    }
    return null;
  }
}
