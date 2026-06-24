/**
 * Agent discovery registry with capability indexing.
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

  async register(agent: RegisteredAgent): Promise<void> {
    this.agents.set(agent.agentId, { ...agent, lastSeen: Date.now() });
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