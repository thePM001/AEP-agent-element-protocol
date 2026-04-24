import { AgentGateway } from "../gateway.js";
import type { AgentAction, Policy } from "../policy/types.js";
import type { Session } from "../session/session.js";

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

    const parts = command.trim().split(/\s+/);
    const binary = parts[0] ?? "";

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

  stop(reason: string = "shell proxy stopped") {
    if (this.session) {
      return this.gateway.terminateSession(this.session.id, reason);
    }
    return null;
  }
}
