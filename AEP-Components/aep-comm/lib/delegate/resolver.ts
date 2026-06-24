/**
 * Native task delegation with retry and capability matching.
 */

import type { AgentRegistryImpl } from "../discovery/registry.js";
import type { MessageRouterImpl } from "../messaging/router.js";

export interface DelegateRequest {
  taskId: string;
  targetAgentId?: string;
  capability?: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}

export interface DelegateResult {
  ok: boolean;
  targetAgentId?: string;
  attempts: number;
  reason?: string;
}

export class DelegateResolver {
  constructor(
    private readonly registry: AgentRegistryImpl,
    private readonly router: MessageRouterImpl,
    private readonly localAgentId: string,
  ) {}

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    const maxRetries = request.maxRetries ?? 2;
    let targetId = request.targetAgentId;

    if (!targetId && request.capability) {
      const matches = this.registry.findByCapability(request.capability);
      targetId = matches[0]?.agentId;
    }

    if (!targetId) {
      return { ok: false, attempts: 0, reason: "no_target_agent" };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.router.send({
        to: targetId,
        type: "task:delegate",
        payload: {
          taskId: request.taskId,
          from: this.localAgentId,
          ...request.payload,
        },
        action_path: "agent:delegate",
        priority: 1,
      });

      if (result.delivered) {
        return { ok: true, targetAgentId: targetId, attempts: attempt };
      }
    }

    return { ok: false, targetAgentId: targetId, attempts: maxRetries, reason: "delivery_failed" };
  }
}