import type { AgentGateway } from "../gateway.js";
import type {
  FleetPolicy,
  FleetStatus,
  AgentSummary,
  FleetAlert,
  FleetPolicyResult,
  FleetViolation,
  FleetAction,
  RegisterResult,
} from "./types.js";

export class FleetManager {
  private gateway: AgentGateway;
  private policy: NonNullable<FleetPolicy>;
  private registeredAgents: Map<string, { sessionId: string; parentId?: string; registeredAt: number }> = new Map();
  private fleetPaused = false;
  private hourlyStartTime: number = Date.now();

  constructor(gateway: AgentGateway, policy: NonNullable<FleetPolicy>) {
    this.gateway = gateway;
    this.policy = policy;
  }

  getStatus(): FleetStatus {
    const sessions = this.gateway.listActiveSessions();
    const agents: AgentSummary[] = [];
    let totalCost = 0;
    let totalTokens = 0;
    let trustSum = 0;
    let maxDrift = 0;

    for (const session of sessions) {
      const agentId = this.findAgentIdBySession(session.id) ?? session.id;
      const trust = this.gateway.getTrustManager(session.id);
      const ring = this.gateway.getRingManager(session.id);
      const drift = this.gateway.getIntentDetector(session.id);
      const costTotals = this.gateway.getSessionCostTotals(session.id);
      const tokenTotals = this.gateway.getSessionTokenTotals(session.id);

      const trustScore = trust?.getScore() ?? 500;
      const ringLevel = ring?.getRing() ?? 2;
      const driftScore = (drift as any)?.getScore?.() ?? 0;
      const sessionCost = costTotals ? costTotals.input + costTotals.output : 0;
      const sessionTokens = tokenTotals ? tokenTotals.input + tokenTotals.output : 0;

      trustSum += trustScore;
      if (driftScore > maxDrift) maxDrift = driftScore;
      totalCost += sessionCost;
      totalTokens += sessionTokens;

      agents.push({
        agentId,
        sessionId: session.id,
        trust: trustScore,
        ring: ringLevel,
        drift: driftScore,
        actions: {
          total: session.stats.actionsEvaluated,
          allowed: session.stats.actionsAllowed,
          denied: session.stats.actionsDenied,
        },
        cost: sessionCost,
        status: session.state === "paused" ? "paused" : session.state === "terminated" ? "terminated" : "active",
      });
    }

    const fleetTrust = agents.length > 0 ? trustSum / agents.length : 0;
    const alerts = this.generateAlerts(agents, totalCost);

    return {
      activeAgents: agents.filter(a => a.status === "active").length,
      totalSessions: sessions.length,
      agents,
      fleetTrust,
      fleetDrift: maxDrift,
      totalCost,
      totalTokens,
      alerts,
    };
  }

  enforceFleetPolicy(): FleetPolicyResult {
    const status = this.getStatus();
    const violations: FleetViolation[] = [];
    const actions: FleetAction[] = [];

    const maxAgents = this.policy.max_agents ?? 10;
    const maxCostPerHour = this.policy.max_total_cost_per_hour ?? 100;
    const maxRing0 = this.policy.max_ring0_agents ?? 1;
    const driftPauseThreshold = this.policy.drift_pause_threshold ?? 3;

    // Check agent count
    if (status.activeAgents > maxAgents) {
      violations.push({
        type: "agent_limit",
        message: `Active agents (${status.activeAgents}) exceed limit (${maxAgents}).`,
        current: status.activeAgents,
        limit: maxAgents,
      });
      actions.push({
        type: "reject_new_agent",
        reason: `Fleet at capacity: ${status.activeAgents}/${maxAgents}`,
        affectedAgents: [],
      });
    }

    // Check hourly cost
    if (status.totalCost > maxCostPerHour) {
      violations.push({
        type: "cost_exceeded",
        message: `Total cost (${status.totalCost.toFixed(2)}) exceeds hourly limit (${maxCostPerHour}).`,
        current: status.totalCost,
        limit: maxCostPerHour,
      });
      actions.push({
        type: "pause_all",
        reason: `Cost limit exceeded: ${status.totalCost.toFixed(2)}/${maxCostPerHour}`,
        affectedAgents: status.agents.map(a => a.agentId),
      });
    }

    // Check ring 0 saturation
    const ring0Agents = status.agents.filter(a => a.ring === 0 && a.status === "active");
    if (ring0Agents.length > maxRing0) {
      violations.push({
        type: "ring_saturation",
        message: `Ring 0 agents (${ring0Agents.length}) exceed limit (${maxRing0}).`,
        current: ring0Agents.length,
        limit: maxRing0,
      });
      // Demote newest ring 0 agent(s)
      const sorted = [...ring0Agents].sort((a, b) => {
        const aReg = this.registeredAgents.get(a.agentId)?.registeredAt ?? 0;
        const bReg = this.registeredAgents.get(b.agentId)?.registeredAt ?? 0;
        return bReg - aReg; // newest first
      });
      const toDemote = sorted.slice(0, ring0Agents.length - maxRing0);
      actions.push({
        type: "demote_ring0",
        reason: `Ring 0 saturated: ${ring0Agents.length}/${maxRing0}`,
        affectedAgents: toDemote.map(a => a.agentId),
      });
    }

    // Check drift cluster
    const driftingAgents = status.agents.filter(a => a.drift > 0.5);
    if (driftingAgents.length >= driftPauseThreshold) {
      violations.push({
        type: "drift_cluster",
        message: `Drifting agents (${driftingAgents.length}) reached pause threshold (${driftPauseThreshold}).`,
        current: driftingAgents.length,
        limit: driftPauseThreshold,
      });
      actions.push({
        type: "pause_swarm",
        reason: `Drift cluster detected: ${driftingAgents.length} agents drifting`,
        affectedAgents: driftingAgents.map(a => a.agentId),
      });
    }

    return { violations, actions };
  }

  registerAgent(agentId: string, parentId?: string): RegisterResult {
    const maxAgents = this.policy.max_agents ?? 10;
    const currentCount = this.registeredAgents.size;

    if (currentCount >= maxAgents) {
      return {
        registered: false,
        agentId,
        reason: `Fleet at capacity: ${currentCount}/${maxAgents}`,
      };
    }

    // Find the session for this agent (most recently created unregistered session)
    const sessions = this.gateway.listActiveSessions();
    const sessionId = sessions.length > 0 ? sessions[sessions.length - 1].id : agentId;

    this.registeredAgents.set(agentId, {
      sessionId,
      parentId,
      registeredAt: Date.now(),
    });

    // Log to ledger
    const ledger = this.gateway.getLedger(sessionId);
    ledger?.append("fleet:agent_register", {
      agentId,
      parentId: parentId ?? null,
      fleetSize: this.registeredAgents.size,
    });

    return {
      registered: true,
      agentId,
    };
  }

  deregisterAgent(agentId: string): void {
    const entry = this.registeredAgents.get(agentId);
    if (entry) {
      const ledger = this.gateway.getLedger(entry.sessionId);
      ledger?.append("fleet:agent_deregister", {
        agentId,
        fleetSize: this.registeredAgents.size - 1,
      });
    }
    this.registeredAgents.delete(agentId);
  }

  pauseFleet(reason: string): void {
    this.fleetPaused = true;
    const sessions = this.gateway.listActiveSessions();

    for (const session of sessions) {
      if (session.state === "active") {
        try {
          session.pause();
        } catch {
          // Session may not be in a pausable state
        }
      }
    }

    // Log to first available ledger
    if (sessions.length > 0) {
      const ledger = this.gateway.getLedger(sessions[0].id);
      ledger?.append("fleet:pause", {
        reason,
        sessionsPaused: sessions.length,
      });
    }
  }

  resumeFleet(): void {
    this.fleetPaused = false;
    const sessions = this.gateway.listActiveSessions();

    for (const session of sessions) {
      if (session.state === "paused") {
        try {
          this.gateway.resumeSession(session.id);
        } catch {
          // Session may not be resumable
        }
      }
    }

    // Log
    if (sessions.length > 0) {
      const ledger = this.gateway.getLedger(sessions[0].id);
      ledger?.append("fleet:resume", {
        sessionsResumed: sessions.length,
      });
    }
  }

  killFleet(rollback: boolean): void {
    const killSwitch = this.gateway.getKillSwitch();
    const sessions = this.gateway.listActiveSessions();

    // Log before kill
    if (sessions.length > 0) {
      const ledger = this.gateway.getLedger(sessions[0].id);
      ledger?.append("fleet:kill", {
        rollback,
        sessionsToKill: sessions.length,
      });
    }

    killSwitch.killAll("Fleet kill switch activated", { rollback });
    this.registeredAgents.clear();
    this.fleetPaused = false;
  }

  isFleetPaused(): boolean {
    return this.fleetPaused;
  }

  getRegisteredCount(): number {
    return this.registeredAgents.size;
  }

  getPolicy(): NonNullable<FleetPolicy> {
    return this.policy;
  }

  getParentId(agentId: string): string | undefined {
    return this.registeredAgents.get(agentId)?.parentId;
  }

  getSessionForAgent(agentId: string): string | undefined {
    return this.registeredAgents.get(agentId)?.sessionId;
  }

  private findAgentIdBySession(sessionId: string): string | undefined {
    for (const [agentId, entry] of this.registeredAgents) {
      if (entry.sessionId === sessionId) return agentId;
    }
    return undefined;
  }

  private generateAlerts(agents: AgentSummary[], totalCost: number): FleetAlert[] {
    const alerts: FleetAlert[] = [];
    const maxCostPerHour = this.policy.max_total_cost_per_hour ?? 100;
    const driftPauseThreshold = this.policy.drift_pause_threshold ?? 3;

    // Cost threshold warning at 80%
    if (totalCost > maxCostPerHour * 0.8) {
      const severity = totalCost > maxCostPerHour ? "critical" : "warning";
      alerts.push({
        type: "cost_threshold",
        message: `Fleet cost at ${((totalCost / maxCostPerHour) * 100).toFixed(0)}% of hourly limit.`,
        severity,
        timestamp: new Date().toISOString(),
        affectedAgents: agents.map(a => a.agentId),
      });
    }

    // Drift cluster
    const driftingAgents = agents.filter(a => a.drift > 0.5);
    if (driftingAgents.length >= driftPauseThreshold) {
      alerts.push({
        type: "drift_cluster",
        message: `${driftingAgents.length} agents drifting beyond threshold.`,
        severity: "critical",
        timestamp: new Date().toISOString(),
        affectedAgents: driftingAgents.map(a => a.agentId),
      });
    }

    // Ring saturation
    const ring0Count = agents.filter(a => a.ring === 0 && a.status === "active").length;
    const maxRing0 = this.policy.max_ring0_agents ?? 1;
    if (ring0Count > maxRing0) {
      alerts.push({
        type: "ring_saturation",
        message: `${ring0Count} agents in Ring 0 (limit: ${maxRing0}).`,
        severity: "warning",
        timestamp: new Date().toISOString(),
        affectedAgents: agents.filter(a => a.ring === 0).map(a => a.agentId),
      });
    }

    // Trust erosion cluster
    const lowTrustAgents = agents.filter(a => a.trust < 200);
    if (lowTrustAgents.length >= 2) {
      alerts.push({
        type: "trust_erosion_cluster",
        message: `${lowTrustAgents.length} agents below trust threshold 200.`,
        severity: "warning",
        timestamp: new Date().toISOString(),
        affectedAgents: lowTrustAgents.map(a => a.agentId),
      });
    }

    // Agent limit warning
    const maxAgents = this.policy.max_agents ?? 10;
    const activeCount = agents.filter(a => a.status === "active").length;
    if (activeCount >= maxAgents) {
      alerts.push({
        type: "agent_limit",
        message: `Fleet at agent capacity: ${activeCount}/${maxAgents}.`,
        severity: "critical",
        timestamp: new Date().toISOString(),
        affectedAgents: agents.map(a => a.agentId),
      });
    }

    return alerts;
  }
}
