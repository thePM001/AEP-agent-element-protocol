// @PAD: p0-v275-sec24-kill-switch-cap-v1
// @GCDE: document_sha256=p0-v275-sec24-kill-trust-cap
import type { SessionManager } from "./session-manager.js";
import type { SessionReport } from "./session.js";
import type { TrustManager } from "../../trust-rings/lib/trust/manager.js";
import type { RollbackManager } from "../../evidence-ledger/lib/rollback/manager.js";

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
    let attempted = 0;
    let trustResetAny = false;

    for (const session of sessions) {
      attempted++;
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
        trustResetAny = true;
        let guard = 0;
        const maxIter = 64;
        while (trust.getScore() > 0 && guard < maxIter) {
          trust.penalize("Kill switch - trust reset", undefined);
          guard++;
        }
      }
    }

    return {
      // M-30: count attempts (target set size), not only successful reports
      sessionsTerminated: attempted,
      reports,
      rollbacksAttempted: options?.rollback ?? false,
      // M-31: true only when at least one trust manager was reset
      trustReset: trustResetAny,
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
    let trustReset = false;
    if (trust) {
      let guard = 0;
      const maxIter = 64;
      while (trust.getScore() > 0 && guard < maxIter) {
        trust.penalize("Kill switch - trust reset", undefined);
        guard++;
      }
      trustReset = trust.getScore() === 0;
    }

    return {
      sessionsTerminated: reports.length,
      reports,
      rollbacksAttempted: options?.rollback ?? false,
      trustReset,
    };
  }
}
