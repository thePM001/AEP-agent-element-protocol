import type { FleetManager } from "./manager.js";
import type { FleetStatus, AgentSummary, FleetAlert } from "./types.js";

/**
 * REST-style API handlers for fleet governance.
 * These are method handlers, not an HTTP server.
 * The Supervision Center or MCP proxy calls them directly.
 */
export class FleetAPI {
  private manager: FleetManager;

  constructor(manager: FleetManager) {
    this.manager = manager;
  }

  /** GET /fleet/status */
  getStatus(): FleetStatus {
    return this.manager.getStatus();
  }

  /** GET /fleet/agents */
  getAgents(): AgentSummary[] {
    return this.manager.getStatus().agents;
  }

  /** GET /fleet/agents/:id */
  getAgent(agentId: string): AgentSummary | null {
    const agents = this.manager.getStatus().agents;
    return agents.find(a => a.agentId === agentId) ?? null;
  }

  /** GET /fleet/alerts */
  getAlerts(): FleetAlert[] {
    return this.manager.getStatus().alerts;
  }

  /** POST /fleet/pause */
  pauseFleet(): { paused: number } {
    const beforeStatus = this.manager.getStatus();
    const activeCount = beforeStatus.agents.filter(a => a.status === "active").length;
    this.manager.pauseFleet("Fleet API pause request");
    return { paused: activeCount };
  }

  /** POST /fleet/resume */
  resumeFleet(): { resumed: number } {
    const beforeStatus = this.manager.getStatus();
    const pausedCount = beforeStatus.agents.filter(a => a.status === "paused").length;
    this.manager.resumeFleet();
    return { resumed: pausedCount };
  }

  /** POST /fleet/kill */
  killFleet(rollback = false): { killed: number; rolledBack: boolean } {
    const beforeStatus = this.manager.getStatus();
    const sessionCount = beforeStatus.totalSessions;
    this.manager.killFleet(rollback);
    return { killed: sessionCount, rolledBack: rollback };
  }
}
