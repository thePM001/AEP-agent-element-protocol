import type { SessionManager } from "./session-manager.js";
import type { SessionReport } from "./session.js";
import type { TrustManager } from "../trust/manager.js";
import type { RollbackManager } from "../rollback/manager.js";

export interface KillResult {
  sessionsTerminated: number;
  reports: SessionReport[];
  rollbacksAttempted: boolean;
  trustReset: boolean;
}

export class KillSwitch {
  private sessionManager: SessionManager;
  private rollbackManager: RollbackManager | null;
  private trustManagers: Map<string, TrustManager>;

  constructor(
    sessionManager: SessionManager,
    rollbackManager?: RollbackManager,
    trustManagers?: Map<string, TrustManager>
  ) {
    this.sessionManager = sessionManager;
    this.rollbackManager = rollbackManager ?? null;
    this.trustManagers = trustManagers ?? new Map();
  }

  killAll(reason: string, options?: { rollback?: boolean }): KillResult {
    const sessions = this.sessionManager.listActiveSessions();
    const reports: SessionReport[] = [];

    for (const session of sessions) {
      if (options?.rollback && this.rollbackManager) {
        try {
          this.rollbackManager.rollbackSession(session.id);
        } catch {
          // Best effort rollback
        }
      }

      try {
        const report = this.sessionManager.terminateSession(session.id, `KILL: ${reason}`);
        reports.push(report);
      } catch {
        // Session may already be terminated
      }

      // Reset trust to 0
      const trust = this.trustManagers.get(session.id);
      if (trust) {
        trust.penalize("Kill switch activated", undefined);
        // Force to 0 by repeated penalty
        while (trust.getScore() > 0) {
          trust.penalize("Kill switch - trust reset", undefined);
        }
      }
    }

    return {
      sessionsTerminated: reports.length,
      reports,
      rollbacksAttempted: options?.rollback ?? false,
      trustReset: true,
    };
  }

  killSession(sessionId: string, reason: string, options?: { rollback?: boolean }): KillResult {
    const reports: SessionReport[] = [];

    if (options?.rollback && this.rollbackManager) {
      try {
        this.rollbackManager.rollbackSession(sessionId);
      } catch {
        // Best effort
      }
    }

    try {
      const report = this.sessionManager.terminateSession(sessionId, `KILL: ${reason}`);
      reports.push(report);
    } catch {
      // Session may already be terminated
    }

    const trust = this.trustManagers.get(sessionId);
    if (trust) {
      while (trust.getScore() > 0) {
        trust.penalize("Kill switch - trust reset", undefined);
      }
    }

    return {
      sessionsTerminated: reports.length,
      reports,
      rollbacksAttempted: options?.rollback ?? false,
      trustReset: true,
    };
  }
}
