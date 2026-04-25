import { createHash } from "node:crypto";
import type { CompensationPlan, RollbackResult } from "./types.js";
import type { EvidenceLedger } from "../ledger/ledger.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class RollbackManager {
  private plans: Map<string, CompensationPlan> = new Map();
  private sessionActions: Map<string, string[]> = new Map();
  private ledger: EvidenceLedger | null = null;

  setLedger(ledger: EvidenceLedger): void {
    this.ledger = ledger;
  }

  recordCompensation(
    sessionId: string,
    plan: CompensationPlan
  ): void {
    this.plans.set(plan.actionId, plan);
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

    try {
      // Log rollback in evidence ledger
      this.ledger?.append("action:rollback", {
        actionId,
        tool: plan.tool,
        compensationAction: plan.compensationAction,
        snapshotHash: plan.backup.snapshotHash,
      });

      this.plans.delete(actionId);

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

    // Rollback in reverse order
    for (let i = actionIds.length - 1; i >= 0; i--) {
      results.push(this.rollback(actionIds[i]));
    }

    this.sessionActions.delete(sessionId);
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
