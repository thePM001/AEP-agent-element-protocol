// @PAD: p0-v275-h-sec3-fleet-pause-hourly-v1
// @GCDE: document_sha256=p0-v275-sec3-h14-h15-fleet
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
  private hourlyCostBaseline: number = 0;

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

      const trustScore = trust?.getScore() ?? 0; // unknown manager: untrusted, do not invent mid-tier
      const ringLevel = ring?.getRing() ?? 2;
      // L-8: typed drift access
      const driftScore =
        drift && typeof (drift as { getScore?: () => number }).getScore === "function"
          ? (drift as { getScore: () => number }).getScore()
          : 0;
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

    // H-15: rolling-hour cost (not lifetime) vs max_total_cost_per_hour
    this.rollHourlyWindow(status.totalCost);
    const costThisHour = Math.max(0, status.totalCost - this.hourlyCostBaseline);
    if (costThisHour > maxCostPerHour) {
      violations.push({
        type: "cost_exceeded",
        message: `Hourly cost (${costThisHour.toFixed(2)}) exceeds limit (${maxCostPerHour}).`,
        current: costThisHour,
        limit: maxCostPerHour,
      });
      actions.push({
        type: "pause_all",
        reason: `Hourly cost limit exceeded: ${costThisHour.toFixed(2)}/${maxCostPerHour}`,
        affectedAgents: status.agents.map(a => a.agentId),
      });
      this.fleetPaused = true;
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

    // HIGH: apply policy actions to sessions (not report-only)
    this.applyFleetActions(actions);

    return { violations, actions };
  }

  /** Apply demote/pause actions returned by policy evaluation. */
  private applyFleetActions(actions: FleetAction[]): void {
    for (const action of actions) {
      if (action.type === "pause_all" || action.type === "pause_swarm") {
        this.pauseFleet(action.reason);
        continue;
      }
      if (action.type === "demote_ring0") {
        for (const agentId of action.affectedAgents) {
          const entry = this.registeredAgents.get(agentId);
          if (!entry) continue;
          try {
            const ring = this.gateway.getRingManager(entry.sessionId);
            ring?.demote?.(1 as never);
          } catch {
            // Ring manager may not allow demote if already >= 1; pause as fallback
            try {
              const sessions = this.gateway.listActiveSessions();
              const s = sessions.find((x) => x.id === entry.sessionId);
              if (s && s.state === "active") s.pause();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  /**
   * Register an agent to an active session (TASK-H-14).
   * Never binds to "most recent session" - that mis-registers under concurrency.
   * Resolve order: explicit sessionId arg → session.metadata agent keys → session.id === agentId.
   * Fail closed if zero or multiple matches.
   */
  registerAgent(
    agentId: string,
    parentId?: string,
    sessionId?: string
  ): RegisterResult {
    // SEC-3: refuse registration while fleet is paused
    if (this.fleetPaused) {
      return {
        registered: false,
        agentId,
        reason: "Fleet is paused; new agent registration is blocked",
      };
    }

    const maxAgents = this.policy.max_agents ?? 10;
    const currentCount = this.registeredAgents.size;

    if (currentCount >= maxAgents) {
      return {
        registered: false,
        agentId,
        reason: `Fleet at capacity: ${currentCount}/${maxAgents}`,
      };
    }

    if (this.registeredAgents.has(agentId)) {
      const existing = this.registeredAgents.get(agentId)!;
      if (sessionId && sessionId !== existing.sessionId) {
        return {
          registered: false,
          agentId,
          reason: `Agent already registered to session ${existing.sessionId}`,
        };
      }
      return {
        registered: true,
        agentId,
        reason: "already_registered",
      };
    }

    const sessions = this.gateway.listActiveSessions();
    let resolved: string | undefined = sessionId;

    if (resolved) {
      const ok = sessions.some((s) => s.id === resolved);
      if (!ok) {
        return {
          registered: false,
          agentId,
          reason: `Session not active: ${resolved}`,
        };
      }
    } else {
      const matches = sessions.filter((s) => {
        const meta = (s as { metadata?: Record<string, string> }).metadata ?? {};
        return (
          s.id === agentId ||
          meta.agent_id === agentId ||
          meta.agentId === agentId ||
          meta.agent === agentId
        );
      });
      if (matches.length === 0) {
        return {
          registered: false,
          agentId,
          reason: `No session bound to agentId=${agentId}; pass sessionId explicitly`,
        };
      }
      if (matches.length > 1) {
        return {
          registered: false,
          agentId,
          reason: `Ambiguous sessions for agentId=${agentId} (${matches.length} matches)`,
        };
      }
      resolved = matches[0].id;
    }

    this.registeredAgents.set(agentId, {
      sessionId: resolved,
      parentId,
      registeredAt: Date.now(),
    });

    // Log to ledger
    const ledger = this.gateway.getLedger(resolved);
    ledger?.append("fleet:agent_register", {
      agentId,
      parentId: parentId ?? null,
      sessionId: resolved,
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

    // M-53: log pause on every affected session ledger
    for (const session of sessions) {
      const ledger = this.gateway.getLedger(session.id);
      ledger?.append("fleet:pause", {
        reason,
        sessionsPaused: sessions.length,
        sessionId: session.id,
      });
    }
  }

  resumeFleet(): void {
    this.fleetPaused = false;
    const sessions = this.gateway.listActiveSessions();
    let resumed = 0;

    for (const session of sessions) {
      if (session.state === "paused") {
        try {
          this.gateway.resumeSession(session.id);
          resumed++;
          // L-9: log only sessions that were paused
          this.gateway.getLedger(session.id)?.append("fleet:resume", {
            sessionId: session.id,
            sessionsResumed: 1,
          });
        } catch {
          // Session may not be resumable
        }
      }
    }
    void resumed;
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

  /**
   * CRITICAL: rolling 1-hour cost window baseline.
   * When the wall-clock hour elapses, set baseline to current totalCost so
   * costThisHour = totalCost - baseline reflects only this hour.
   */
  private rollHourlyWindow(totalCost: number): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      return;
    }
    if (now - this.hourlyStartTime >= hourMs) {
      this.hourlyStartTime = now;
      this.hourlyCostBaseline = totalCost;
    }
  }

  private generateAlerts(agents: AgentSummary[], totalCost: number): FleetAlert[] {
    const alerts: FleetAlert[] = [];
    const maxCostPerHour = this.policy.max_total_cost_per_hour ?? 100;
    const driftPauseThreshold = this.policy.drift_pause_threshold ?? 3;

    // BM-19: alert against rolled hourly window, not lifetime totalCost
    this.rollHourlyWindow(totalCost);
    const costThisHour = Math.max(0, totalCost - this.hourlyCostBaseline);
    if (costThisHour > maxCostPerHour * 0.8) {
      const severity = costThisHour > maxCostPerHour ? "critical" : "warning";
      alerts.push({
        type: "cost_threshold",
        message: `Fleet hourly cost at ${((costThisHour / maxCostPerHour) * 100).toFixed(0)}% of hourly limit.`,
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
