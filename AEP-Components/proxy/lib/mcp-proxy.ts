// @PAD: p0-v275-h31-mcp-proxy-session-lock-v1
// @GCDE: document_sha256=p0-v275-h31-proxy
// BL-04: use in-tree AgentGateway (SDK), not missing ../gateway.js
import { AgentGateway, type AEPElement } from "../../../AEP-SDKs/typescript/aep-protocol/src/gateway.js";
import type { AgentAction, Policy } from "../../policy-engine/lib/policy/types.js";
import type { Session } from "../../session/lib/session.js";
import { AEPassistant } from "../../aepassist/lib/aepassist/assistant.js";
import { scanToolCall } from "../../mcp-security/lib/mcp-security/index.js";

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
  /** When true (default), tools without a configured backend fail closed. */
  requireBackend?: boolean;
}

/**
 * AEP MCP Proxy Server.
 *
 * Sits between an AI agent (Claude Code, Cursor, Codex) and backend MCP
 * servers. Every tool call is intercepted, policy-evaluated and - for
 * AEP-related tools - structurally validated before forwarding.
 */
export class AEPProxyServer {
  private gateway: AgentGateway;
  private policy: Policy;
  private backends: BackendConfig[];
  private requireBackend: boolean;
  private session: Session | null = null;
  private processing = false;
  private eventOrder = 0;

  constructor(options: ProxyOptions) {
    this.policy = options.policy;
    this.backends = options.backends ?? [];
    this.requireBackend = options.requireBackend !== false;
    this.gateway = new AgentGateway({ ledgerDir: options.ledgerDir });
  }

  getEventOrder(): number {
    return this.eventOrder;
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

    // H-31: sequential lock applies to ALL tools including aepassist
    if (this.processing) {
      return {
        content: [
          {
            type: "text",
            text: "Sequential processing violation: concurrent call rejected.",
          },
        ],
        isError: true,
      };
    }

    this.processing = true;
    this.eventOrder++;
    const currentOrder = this.eventOrder;

    try {
      const action: AgentAction = {
        tool: call.name,
        input: call.arguments,
        timestamp: new Date(),
      };

      // Policy evaluation (HIGH: aepassist must not skip policy)
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

      // aepassist runs only after policy allow (same path as other tools)
      if (call.name === "aepassist") {
        const input = typeof call.arguments.command === "string"
          ? call.arguments.command
          : typeof call.arguments.input === "string"
            ? call.arguments.input
            : "";
        const assistant = new AEPassistant(this.gateway);
        const response = assistant.handle(input);
        this.gateway.recordResult(this.session.id, verdict.actionId, {
          success: true,
          output: { accepted: true, forwarded: false, tool: "aepassist" },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(response) }],
        };
      }

      // M-44: validate AEP tools even when id is missing/falsy (use empty string path)
      if (this.isAEPTool(call.name)) {
        if (call.arguments.id === undefined || call.arguments.id === null) {
          return {
            content: [{ type: "text", text: "AEP structural validation failed: element id is required." }],
            isError: true,
          };
        }
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

      // Fail closed: no silent stub success without a registered backend.
      if (this.requireBackend && this.backends.length === 0) {
        this.gateway.recordResult(this.session.id, verdict.actionId, {
          success: false,
          output: {
            accepted: false,
            forwarded: false,
            tool: call.name,
            error: "no backends configured",
          },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                forwarded: false,
                accepted: false,
                isError: true,
                actionId: verdict.actionId,
                eventOrder: currentOrder,
                error: "no MCP backends configured; refusing stub success",
              }),
            },
          ],
          isError: true,
        };
      }

      const mcpScan = scanToolCall(call.name, {
        allow: this.backends.map((b) => b.name).filter(Boolean),
        defaultDeny: this.requireBackend && this.backends.length > 0,
      });
      if (this.backends.length > 0 && !mcpScan.allowed) {
        this.gateway.recordResult(this.session.id, verdict.actionId, {
          success: false,
          output: { accepted: false, forwarded: false, tool: call.name, error: mcpScan.reason },
        });
        return {
          content: [
            {
              type: "text",
              text: `MCP security denied tool ${call.name}: ${mcpScan.reason}`,
            },
          ],
          isError: true,
        };
      }

      const backend = this.backends.find(
        (b) => b.name === call.name || b.name === "*" 
      ) ?? this.backends[0];
      if (!backend || !backend.command) {
        this.gateway.recordResult(this.session.id, verdict.actionId, {
          success: false,
          output: {
            accepted: false,
            forwarded: false,
            tool: call.name,
            error: "no matching backend command",
          },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                forwarded: false,
                accepted: false,
                isError: true,
                actionId: verdict.actionId,
                eventOrder: currentOrder,
                error: "no matching backend; tool not executed",
              }),
            },
          ],
          isError: true,
        };
      }

      this.gateway.recordResult(this.session.id, verdict.actionId, {
        success: false,
        output: {
          accepted: false,
          forwarded: false,
          tool: call.name,
          backend: backend.name,
          transport: backend.transport,
          error: "backend transport not implemented",
        },
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              forwarded: false,
              accepted: false,
              isError: true,
              actionId: verdict.actionId,
              eventOrder: currentOrder,
              backend: backend.name,
              transport: backend.transport,
              error: "policy-allowed but backend transport not implemented (fail closed)",
            }),
          },
        ],
        isError: true,
      };
    } finally {
      this.processing = false;
    }
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
