/**
 * A2A-like message routing with optional lattice action_path validation.
 */

import type { AgentRegistryImpl } from "../discovery/registry.js";
import { createEnvelope, validateEnvelope, type MessageEnvelope } from "./envelope.js";
import { AgentInbox } from "./inbox.js";

export type MessageHandler = (envelope: MessageEnvelope) => void | Promise<void>;

export interface RouteResult {
  delivered: boolean;
  reason?: string;
}

export class MessageRouterImpl {
  private inboxes = new Map<string, AgentInbox>();
  private handlers = new Map<string, MessageHandler>();
  private delivered: MessageEnvelope[] = [];

  constructor(
    private readonly registry: AgentRegistryImpl,
    private readonly localAgentId: string,
  ) {}

  onMessage(agentId: string, handler: MessageHandler): void {
    this.handlers.set(agentId, handler);
  }

  getInbox(agentId: string): AgentInbox {
    let inbox = this.inboxes.get(agentId);
    if (!inbox) {
      inbox = new AgentInbox();
      this.inboxes.set(agentId, inbox);
    }
    return inbox;
  }

  async route(envelope: MessageEnvelope): Promise<RouteResult> {
    if (!validateEnvelope(envelope)) {
      return { delivered: false, reason: "invalid_envelope" };
    }

    if (envelope.action_path && !envelope.action_path.includes(":")) {
      return { delivered: false, reason: "invalid_action_path" };
    }

    const target = this.registry.get(envelope.to);
    if (!target || target.status === "offline") {
      return { delivered: false, reason: "target_offline" };
    }

    const inbox = this.getInbox(envelope.to);
    inbox.enqueue(envelope);
    this.delivered.push(envelope);

    const handler = this.handlers.get(envelope.to);
    if (handler) {
      await handler(envelope);
    }

    return { delivered: true };
  }

  async send(params: {
    to: string;
    type: string;
    payload?: Record<string, unknown>;
    action_path?: string;
    priority?: number;
  }): Promise<RouteResult> {
    const envelope = createEnvelope({
      from: this.localAgentId,
      to: params.to,
      type: params.type,
      payload: params.payload,
      action_path: params.action_path,
    });
    return this.route(envelope);
  }

  getDelivered(): MessageEnvelope[] {
    return [...this.delivered];
  }
}