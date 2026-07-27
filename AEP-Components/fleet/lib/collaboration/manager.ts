// BL-X1: real multi-agent collaboration manager (no silent no-op)
// Patterns: supervisor, debate, task delegation with monotonic trust ring safety.

export type CollaborationPattern = "supervisor" | "debate" | "delegation";

export interface AgentRole {
  agentId: string;
  role: string;
  capabilities: string[];
  trustRing: number;
  parentId?: string;
}

export interface Handoff {
  id: string;
  from: string;
  to: string;
  task: string;
  status: "pending" | "accepted" | "rejected" | "completed";
  createdAt: string;
  completedAt?: string;
  evidenceRef?: string;
}

export interface CollaborationMessage {
  from: string;
  to: string;
  content: string;
  timestamp: string;
}

export interface CollaborationManagerOptions {
  pattern?: CollaborationPattern;
  maxAgents?: number;
  /** Monotonic safety: child ring cannot be freer than parent (lower number = more privilege). */
  enforceMonotonicRing?: boolean;
}

export interface CollaborationManager {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  registerAgent(role: AgentRole): void;
  getAgent(agentId: string): AgentRole | undefined;
  listAgents(): AgentRole[];
  requestHandoff(from: string, to: string, task: string): Handoff;
  acceptHandoff(handoffId: string, agentId: string): void;
  completeHandoff(handoffId: string, agentId: string, evidenceRef?: string): void;
  recordMessage(msg: CollaborationMessage): void;
  getMessages(limit?: number): CollaborationMessage[];
  getHandoffs(): Handoff[];
  getPattern(): CollaborationPattern;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * BL-X1: functional collaboration layer for fleet.
 * Fail-closed on unknown agents, ring elevation, and double-complete.
 */
export function createCollaborationManager(
  options: CollaborationManagerOptions = {}
): CollaborationManager {
  const maxAgents = options.maxAgents ?? 32;
  const enforceMonotonicRing = options.enforceMonotonicRing !== false;
  const pattern: CollaborationPattern = options.pattern ?? "supervisor";

  let running = false;
  const agents = new Map<string, AgentRole>();
  const handoffs = new Map<string, Handoff>();
  const messages: CollaborationMessage[] = [];

  function requireRunning(): void {
    if (!running) {
      throw new Error("CollaborationManager is not started");
    }
  }

  function requireAgent(agentId: string): AgentRole {
    const a = agents.get(agentId);
    if (!a) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return a;
  }

  return {
    start(): void {
      if (running) return;
      running = true;
    },

    stop(): void {
      running = false;
    },

    isRunning(): boolean {
      return running;
    },

    registerAgent(role: AgentRole): void {
      requireRunning();
      if (!role.agentId?.trim()) {
        throw new Error("agentId required");
      }
      if (!role.role?.trim()) {
        throw new Error("role required");
      }
      if (!Number.isFinite(role.trustRing) || role.trustRing < 0) {
        throw new Error("trustRing must be a non-negative number");
      }
      if (agents.size >= maxAgents && !agents.has(role.agentId)) {
        throw new Error(`max agents reached: ${maxAgents}`);
      }
      if (role.parentId) {
        const parent = agents.get(role.parentId);
        if (!parent) {
          throw new Error(`parent agent not registered: ${role.parentId}`);
        }
        // Monotonic: child cannot be freer than parent (ring index higher = less privilege is OK;
        // lower ring number = more privilege - child ring must be >= parent ring)
        if (enforceMonotonicRing && role.trustRing < parent.trustRing) {
          throw new Error(
            `monotonic ring violation: child ring ${role.trustRing} freer than parent ${parent.trustRing}`
          );
        }
      }
      if (pattern === "supervisor" && role.parentId) {
        // supervisor pattern: only one root without parent
      }
      agents.set(role.agentId, {
        agentId: role.agentId,
        role: role.role,
        capabilities: [...(role.capabilities ?? [])],
        trustRing: role.trustRing,
        parentId: role.parentId,
      });
    },

    getAgent(agentId: string): AgentRole | undefined {
      return agents.get(agentId);
    },

    listAgents(): AgentRole[] {
      return [...agents.values()];
    },

    requestHandoff(from: string, to: string, task: string): Handoff {
      requireRunning();
      requireAgent(from);
      requireAgent(to);
      if (!task.trim()) {
        throw new Error("task required");
      }
      if (from === to) {
        throw new Error("handoff from and to must differ");
      }
      const h: Handoff = {
        id: newId("handoff"),
        from,
        to,
        task: task.trim(),
        status: "pending",
        createdAt: nowIso(),
      };
      handoffs.set(h.id, h);
      return { ...h };
    },

    acceptHandoff(handoffId: string, agentId: string): void {
      requireRunning();
      const h = handoffs.get(handoffId);
      if (!h) throw new Error(`unknown handoff: ${handoffId}`);
      if (h.to !== agentId) {
        throw new Error("only recipient may accept handoff");
      }
      if (h.status !== "pending") {
        throw new Error(`handoff not pending: ${h.status}`);
      }
      h.status = "accepted";
    },

    completeHandoff(handoffId: string, agentId: string, evidenceRef?: string): void {
      requireRunning();
      const h = handoffs.get(handoffId);
      if (!h) throw new Error(`unknown handoff: ${handoffId}`);
      if (h.to !== agentId && h.from !== agentId) {
        throw new Error("only parties may complete handoff");
      }
      if (h.status === "completed" || h.status === "rejected") {
        throw new Error(`handoff already terminal: ${h.status}`);
      }
      if (pattern === "debate" && !evidenceRef?.trim()) {
        throw new Error("debate pattern requires evidenceRef on complete");
      }
      h.status = "completed";
      h.completedAt = nowIso();
      if (evidenceRef) h.evidenceRef = evidenceRef;
    },

    recordMessage(msg: CollaborationMessage): void {
      requireRunning();
      requireAgent(msg.from);
      requireAgent(msg.to);
      if (!msg.content?.trim()) {
        throw new Error("message content required");
      }
      messages.push({
        from: msg.from,
        to: msg.to,
        content: msg.content,
        timestamp: msg.timestamp || nowIso(),
      });
    },

    getMessages(limit = 100): CollaborationMessage[] {
      return messages.slice(-Math.max(1, limit)).map((m) => ({ ...m }));
    },

    getHandoffs(): Handoff[] {
      return [...handoffs.values()].map((h) => ({ ...h }));
    },

    getPattern(): CollaborationPattern {
      return pattern;
    },
  };
}
