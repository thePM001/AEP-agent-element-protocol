import { AgentGateway, type AEPElement } from "../gateway.js";
import type { AgentAction, Policy } from "../policy/types.js";
import type { Session } from "../session/session.js";

export interface BackendConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  transport: "stdio" | "sse";
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface ProxyOptions {
  policy: Policy;
  backends: BackendConfig[];
  ledgerDir: string;
}

/**
 * AEP MCP Proxy Server.
 *
 * Sits between an AI agent (Claude Code, Cursor, Codex) and backend MCP
 * servers. Every tool call is intercepted, policy-evaluated and -- for
 * AEP-related tools -- structurally validated before forwarding.
 */
export class AEPProxyServer {
  private gateway: AgentGateway;
  private policy: Policy;
  private session: Session | null = null;

  constructor(options: ProxyOptions) {
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

  async handleToolCall(call: MCPToolCall): Promise<MCPToolResult> {
    if (!this.session) {
      return {
        content: [{ type: "text", text: "No active session. Call start() first." }],
        isError: true,
      };
    }

    const action: AgentAction = {
      tool: call.name,
      input: call.arguments,
      timestamp: new Date(),
    };

    // Policy evaluation
    const verdict = this.gateway.evaluate(this.session.id, action);

    if (verdict.decision === "deny") {
      return {
        content: [
          {
            type: "text",
            text: `Action denied by AEP policy: ${verdict.reasons.join("; ")}`,
          },
        ],
        isError: true,
      };
    }

    if (verdict.decision === "gate") {
      return {
        content: [
          {
            type: "text",
            text: `Action requires approval: ${verdict.reasons.join("; ")}. Session paused.`,
          },
        ],
        isError: true,
      };
    }

    // AEP structural validation for element mutations
    if (this.isAEPTool(call.name) && call.arguments.id) {
      const element: AEPElement = {
        id: String(call.arguments.id),
        type: String(call.arguments.type ?? "component"),
        z: Number(call.arguments.z ?? 0),
        parent: call.arguments.parent as string | null,
        label: call.arguments.label as string | undefined,
        skin_binding: call.arguments.skin_binding as string | undefined,
      };

      const validation = this.gateway.validateAEP(
        this.session.id,
        verdict.actionId,
        element
      );

      if (!validation.valid) {
        return {
          content: [
            {
              type: "text",
              text: `AEP structural validation failed: ${validation.errors.join("; ")}`,
            },
          ],
          isError: true,
        };
      }

      // Store compensation for rollback
      this.gateway.storeCompensation(
        this.session.id,
        verdict.actionId,
        call.name,
        call.arguments
      );
    }

    // Forward to backend (in a real proxy this forwards via stdio/SSE)
    // For now, record success
    this.gateway.recordResult(this.session.id, verdict.actionId, {
      success: true,
      output: { forwarded: true, tool: call.name },
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ forwarded: true, actionId: verdict.actionId }),
        },
      ],
    };
  }

  stop(reason: string = "session ended") {
    if (this.session) {
      return this.gateway.terminateSession(this.session.id, reason);
    }
    return null;
  }

  resumeSession(): void {
    if (this.session) {
      this.gateway.resumeSession(this.session.id);
    }
  }

  getGateway(): AgentGateway {
    return this.gateway;
  }

  private isAEPTool(name: string): boolean {
    return name.startsWith("aep:");
  }
}
