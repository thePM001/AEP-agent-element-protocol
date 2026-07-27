// @PAD: p0-v275-h34-h35-rollback-safe-v1
// @GCDE: document_sha256=p0-v275-h34-h35-rollback
import { createHash } from "node:crypto";
import type { CompensationPlan, RollbackResult } from "./types.js";
import type { EvidenceLedger } from "../ledger/ledger.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export type CompensationExecutor = (
  action: Record<string, unknown>,
  plan: CompensationPlan,
) => boolean;

export class RollbackManager {
  private plans: Map<string, CompensationPlan> = new Map();
  private sessionActions: Map<string, string[]> = new Map();
  private ledger: EvidenceLedger | null = null;
  // H-53: per-session ledgers (shared setLedger no longer clobbers peers)
  private ledgersBySession: Map<string, EvidenceLedger> = new Map();
  private actionSession: Map<string, string> = new Map();
  private compensationExecutor: CompensationExecutor | null = null;

  setLedger(ledger: EvidenceLedger, sessionId?: string): void {
    if (sessionId) {
      this.ledgersBySession.set(sessionId, ledger);
    } else {
      this.ledger = ledger;
    }
  }

  private ledgerForAction(actionId: string): EvidenceLedger | null {
    const sid = this.actionSession.get(actionId);
    if (sid && this.ledgersBySession.has(sid)) {
      return this.ledgersBySession.get(sid) ?? null;
    }
    return this.ledger;
  }

  setCompensationExecutor(executor: CompensationExecutor): void {
    this.compensationExecutor = executor;
  }

  recordCompensation(
    sessionId: string,
    plan: CompensationPlan
  ): void {
    this.plans.set(plan.actionId, plan);
    this.actionSession.set(plan.actionId, sessionId);
    const actions = this.sessionActions.get(sessionId) ?? [];
    actions.push(plan.actionId);
    this.sessionActions.set(sessionId, actions);
  }

  rollback(actionId: string): RollbackResult {
    const plan = this.plans.get(actionId);
    if (!plan) {
      return {
        actionId,
        success: false,
        compensationApplied: null,
        error: `No compensation plan found for action "${actionId}".`,
      };
    }

    if (!plan.compensationAction) {
      return {
        actionId,
        success: false,
        compensationApplied: null,
        error: `No compensation action defined for tool "${plan.tool}".`,
      };
    }

    const executor = this.compensationExecutor ?? this.defaultCompensationExecutor.bind(this);
    let applied = false;
    try {
      applied = executor(plan.compensationAction, plan);
    } catch (err) {
      return {
        actionId,
        success: false,
        compensationApplied: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!applied) {
      return {
        actionId,
        success: false,
        compensationApplied: null,
        error: `Compensation execution failed for tool "${plan.tool}".`,
      };
    }

    try {
      this.ledgerForAction(actionId)?.append("action:rollback", {
        actionId,
        tool: plan.tool,
        compensationAction: plan.compensationAction,
        snapshotHash: plan.backup.snapshotHash,
        compensationExecuted: true,
      });

      // M-23: only drop plan after successful compensation+ledger
      this.plans.delete(actionId);
      this.actionSession.delete(actionId);

      return {
        actionId,
        success: true,
        compensationApplied: plan.compensationAction,
      };
    } catch (err) {
      return {
        actionId,
        success: false,
        compensationApplied: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  rollbackSession(sessionId: string): RollbackResult[] {
    const actionIds = this.sessionActions.get(sessionId) ?? [];
    const results: RollbackResult[] = [];
    const remaining: string[] = [];

    // Rollback in reverse order
    for (let i = actionIds.length - 1; i >= 0; i--) {
      const id = actionIds[i];
      const result = this.rollback(id);
      results.push(result);
      // H-34: keep failed actions on the session list for retry
      if (!result.success) {
        remaining.unshift(id);
      }
    }

    if (remaining.length === 0) {
      this.sessionActions.delete(sessionId);
    } else {
      this.sessionActions.set(sessionId, remaining);
    }
    return results;
  }

  getPlan(actionId: string): CompensationPlan | null {
    return this.plans.get(actionId) ?? null;
  }

  getSessionPlans(sessionId: string): CompensationPlan[] {
    const actionIds = this.sessionActions.get(sessionId) ?? [];
    return actionIds
      .map((id) => this.plans.get(id))
      .filter((p): p is CompensationPlan => p !== undefined);
  }

  private defaultCompensationExecutor(
    action: Record<string, unknown>,
    plan: CompensationPlan,
  ): boolean {
    const tool = String(action.tool ?? "");
    switch (tool) {
      case "aep:delete_element":
      case "aep:create_element":
      case "aep:update_element":
      case "aep:update_skin":
      case "aep:update_registry":
        this.ledgerForAction(plan.actionId)?.append("aep:compensate", {
          compensation: action,
          backupPath: plan.backup.path,
          snapshotHash: plan.backup.snapshotHash,
        });
        return true;
      default:
        return false;
    }
  }

  static buildAEPCompensation(
    actionId: string,
    tool: string,
    input: Record<string, unknown>,
    previousState?: Record<string, unknown>
  ): CompensationPlan {
    let compensationAction: Record<string, unknown> | null = null;
    let backupPath: string;
    let backupContent: string;

    switch (tool) {
      case "aep:create_element":
        compensationAction = {
          tool: "aep:delete_element",
          input: { id: input.id },
        };
        backupPath = `aep:element:${String(input.id)}`;
        backupContent = JSON.stringify(input);
        break;

      case "aep:delete_element":
        backupPath = `aep:element:${String(input.id)}`;
        if (previousState) {
          compensationAction = {
            tool: "aep:create_element",
            input: previousState,
          };
          backupContent = JSON.stringify(previousState);
        } else {
          // M-22: use input as best-effort restore payload (never null plan)
          compensationAction = {
            tool: "aep:create_element",
            input: input,
          };
          backupContent = JSON.stringify(input);
        }
        break;

      case "aep:update_element":
        backupPath = `aep:element:${String(input.id)}`;
        if (previousState) {
          compensationAction = {
            tool: "aep:update_element",
            input: previousState,
          };
          backupContent = JSON.stringify(previousState);
        } else {
          backupContent = JSON.stringify(input);
        }
        break;

      case "aep:update_skin":
        backupPath = "aep:skin";
        if (previousState) {
          compensationAction = {
            tool: "aep:update_skin",
            input: previousState,
          };
          backupContent = JSON.stringify(previousState);
        } else {
          backupContent = JSON.stringify(input);
        }
        break;

      case "aep:update_registry":
        backupPath = "aep:registry";
        if (previousState) {
          compensationAction = {
            tool: "aep:update_registry",
            input: previousState,
          };
          backupContent = JSON.stringify(previousState);
        } else {
          backupContent = JSON.stringify(input);
        }
        break;

      default:
        backupPath = `aep:generic:${tool}`;
        backupContent = JSON.stringify(input);
        break;
    }

    return {
      actionId,
      tool,
      originalInput: input,
      compensationAction,
      backup: {
        path: backupPath,
        content: backupContent,
        snapshotHash: sha256(backupContent),
      },
    };
  }
}
