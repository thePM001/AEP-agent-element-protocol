/**
 * Agent discovery registry with capability indexing.
 * HIGH: first-seen public key is pinned; rebind requires forceRebindKey.
 */

export interface AgentEndpoint {
  protocol: string;
  url: string;
  priority: number;
}

export interface RegisteredAgent {
  agentId: string;
  identity: { publicKey: string };
  status: "online" | "offline" | "degraded";
  endpoints: AgentEndpoint[];
  capabilities: string[];
  trustTier: number;
  lastSeen: number;
  registeredAt: number;
}

export class AgentRegistryImpl {
  private agents = new Map<string, RegisteredAgent>();
  private running = false;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Register or refresh an agent. Public key is pinned on first insert.
   * Replacing an existing key throws (prevents identity takeover).
   */
  async register(agent: RegisteredAgent): Promise<void> {
    const existing = this.agents.get(agent.agentId);
    const nextKey = String(agent.identity?.publicKey ?? "").trim();
    if (!nextKey) {
      throw new Error(`Agent registry: publicKey required for ${agent.agentId}`);
    }
    if (existing) {
      const prevKey = String(existing.identity?.publicKey ?? "").trim();
      if (prevKey && prevKey !== nextKey) {
        throw new Error(
          `Agent registry: public key rebind denied for ${agent.agentId} (use forceRebindKey)`,
        );
      }
      this.agents.set(agent.agentId, {
        ...agent,
        identity: { publicKey: prevKey || nextKey },
        registeredAt: existing.registeredAt,
        lastSeen: Date.now(),
      });
      return;
    }
    this.agents.set(agent.agentId, {
      ...agent,
      identity: { publicKey: nextKey },
      lastSeen: Date.now(),
      registeredAt: agent.registeredAt || Date.now(),
    });
  }

  /**
   * Explicit dual-control style rebind: only when caller passes previous key match.
   */
  async forceRebindKey(
    agentId: string,
    previousPublicKey: string,
    nextPublicKey: string,
  ): Promise<void> {
    const existing = this.agents.get(agentId);
    if (!existing) {
      throw new Error(`Agent registry: unknown agent ${agentId}`);
    }
    const prev = String(existing.identity.publicKey ?? "").trim();
    const expect = String(previousPublicKey ?? "").trim();
    const next = String(nextPublicKey ?? "").trim();
    if (!next) throw new Error("Agent registry: next publicKey required");
    if (prev !== expect) {
      throw new Error(`Agent registry: previous publicKey mismatch for ${agentId}`);
    }
    this.agents.set(agentId, {
      ...existing,
      identity: { publicKey: next },
      lastSeen: Date.now(),
    });
  }

  async deregister(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  get(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  list(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  findByCapability(capability: string): RegisteredAgent[] {
    return this.list().filter((a) => a.capabilities.includes(capability));
  }

  touch(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.lastSeen = Date.now();
      this.agents.set(agentId, agent);
    }
  }
}
