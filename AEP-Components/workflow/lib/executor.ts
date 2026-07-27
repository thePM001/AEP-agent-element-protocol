// @PAD: p0-v275-h48-h49-h50-workflow-executor-v1
// @GCDE: document_sha256=p0-v275-h48-h50-workflow
// AEP 2.75 - Workflow Executor
// Manages sequential workflow phases with typed verdicts.

import type {
  WorkflowDefinition,
  WorkflowPhase,
  PhaseVerdict,
  VerdictRecord,
  WorkflowStatus,
  Condition,
} from "./types.js";
import type { AgentGateway } from "../gateway.js";
import type { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";
import type { TrustManager } from "../../trust-rings/lib/trust/manager.js";

export class WorkflowExecutor {
  private definition: WorkflowDefinition;
  private gateway: AgentGateway;
  private sessionId: string | null = null;
  private currentPhaseIndex: number = -1;
  private reworkCounts: Map<string, number> = new Map();
  private verdictHistory: VerdictRecord[] = [];
  private state: "idle" | "running" | "completed" | "failed" = "idle";

  constructor(definition: WorkflowDefinition, gateway: AgentGateway) {
    this.definition = definition;
    this.gateway = gateway;
  }

  /**
   * Bind this executor to a session for ledger and trust integration.
   */
  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Start or advance to a named phase.
   * Logs workflow:start on first call, workflow:phase_enter on each phase.
   */
  startPhase(name: string): void {
    const idx = this.definition.phases.findIndex((p) => p.name === name);
    if (idx === -1) {
      throw new Error(`Phase "${name}" not found in workflow "${this.definition.name}".`);
    }

    const phase = this.definition.phases[idx];

    // Log workflow start on first phase entry
    if (this.state === "idle") {
      this.state = "running";
      this.getLedger()?.append("workflow:start", {
        workflow: this.definition.name,
        phases: this.definition.phases.map((p) => p.name),
        onFail: this.definition.onFail,
      });
    }

    // Check entry conditions
    const unmet = this.evaluateConditions(phase.entryConditions);
    if (unmet.length > 0) {
      throw new Error(
        `Entry conditions not met for phase "${name}": ${unmet.join(", ")}`
      );
    }

    this.currentPhaseIndex = idx;
    this.getLedger()?.append("workflow:phase_enter", {
      workflow: this.definition.name,
      phase: name,
      role: phase.role,
      ring: phase.ring,
      reworkCount: this.reworkCounts.get(name) ?? 0,
    });
  }

  /**
   * Submit a verdict for the named phase.
   * Trust changes: advance +15, rework -20, skip -5, fail -100.
   */
  submitVerdict(name: string, verdict: PhaseVerdict, feedback?: string): void {
    const idx = this.definition.phases.findIndex((p) => p.name === name);
    if (idx === -1) {
      throw new Error(`Phase "${name}" not found in workflow "${this.definition.name}".`);
    }

    if (this.state !== "running") {
      throw new Error(`Workflow is not running (state: ${this.state}).`);
    }

    const phase = this.definition.phases[idx];
    const record: VerdictRecord = {
      phase: name,
      verdict,
      feedback,
      timestamp: new Date().toISOString(),
    };
    this.verdictHistory.push(record);

    // Log verdict
    this.getLedger()?.append("workflow:phase_verdict", {
      workflow: this.definition.name,
      phase: name,
      verdict,
      feedback: feedback ?? null,
    });

    // Apply trust changes
    const trust = this.getTrustManager();
    switch (verdict) {
      case "advance": {
        trust?.reward("Workflow phase advanced", 15);
        // Move to next phase
        const nextIdx = idx + 1;
        if (nextIdx >= this.definition.phases.length) {
          // Workflow complete
          this.state = "completed";
          this.getLedger()?.append("workflow:complete", {
            workflow: this.definition.name,
            totalPhases: this.definition.phases.length,
            verdicts: this.verdictHistory.length,
          });
        } else {
          this.currentPhaseIndex = nextIdx;
        }
        break;
      }

      case "rework": {
        // H-49: single net-20 adjustment (no two-call hack)
        trust?.reward("Workflow phase rework", -20);

        const currentRework = this.reworkCounts.get(name) ?? 0;
        if (currentRework >= phase.maxRework) {
          // Max rework exceeded, treat as fail
          this.handleFail(name, `Max rework exceeded for phase "${name}".`);
          return;
        }
        this.reworkCounts.set(name, currentRework + 1);
        break;
      }

      case "skip": {
        trust?.penalize("Workflow phase skipped", undefined);
        trust?.reward("Skip adjustment", 45);
        // Net: -50 + 45 = -5

        // Move to next phase
        const nextIdx = idx + 1;
        if (nextIdx >= this.definition.phases.length) {
          this.state = "completed";
          this.getLedger()?.append("workflow:complete", {
            workflow: this.definition.name,
            totalPhases: this.definition.phases.length,
            verdicts: this.verdictHistory.length,
          });
        } else {
          this.currentPhaseIndex = nextIdx;
        }
        break;
      }

      case "fail": {
        this.handleFail(name, feedback ?? "Phase failed.");
        break;
      }
    }
  }

  getCurrentPhase(): WorkflowPhase | null {
    if (this.currentPhaseIndex < 0 || this.currentPhaseIndex >= this.definition.phases.length) {
      return null;
    }
    return this.definition.phases[this.currentPhaseIndex];
  }

  getStatus(): WorkflowStatus {
    const current = this.getCurrentPhase();
    return {
      phase: current?.name ?? "",
      phaseIndex: this.currentPhaseIndex,
      reworkCount: current ? (this.reworkCounts.get(current.name) ?? 0) : 0,
      verdictHistory: [...this.verdictHistory],
      // H-48: idle stays idle (do not report as running)
      state: this.state,
    };
  }

  getDefinition(): WorkflowDefinition {
    return this.definition;
  }

  private handleFail(phaseName: string, reason: string): void {
    const trust = this.getTrustManager();
    // H-50: workflow failure is not a forbidden_match
    trust?.penalize("Workflow phase failed", "policy_violation");

    this.state = "failed";
    this.getLedger()?.append("workflow:fail", {
      workflow: this.definition.name,
      phase: phaseName,
      reason,
      onFail: this.definition.onFail,
    });
  }

  /**
   * Evaluate conditions against current state.
   * Returns list of unmet condition descriptions (empty = all met).
   */
  private evaluateConditions(conditions: Condition[]): string[] {
    // Conditions are declarative checks. In the absence of a runtime
    // state object, they pass by default. Integrators override via
    // the entry condition hook on the gateway.
    // For testability, conditions with field "always_true" pass,
    // conditions with field "always_false" fail.
    const state = (this as { conditionState?: Record<string, unknown> }).conditionState ?? {};
    const unmet: string[] = [];
    for (const cond of conditions) {
      if (cond.field === "always_false") {
        unmet.push(`${cond.field} ${cond.operator} ${cond.value}`);
        continue;
      }
      if (cond.field === "always_true") continue;
      // L-28: evaluate operators against conditionState bag
      const actual = state[cond.field];
      const expected = cond.value;
      let ok = true;
      // BM-18: support named and symbolic operators; unknown fails closed
      switch (cond.operator) {
        case "==":
        case "eq":
          ok = String(actual ?? "") === String(expected);
          break;
        case "!=":
        case "ne":
          ok = String(actual ?? "") !== String(expected);
          break;
        case ">":
        case "gt":
          ok = Number(actual) > Number(expected);
          break;
        case "<":
        case "lt":
          ok = Number(actual) < Number(expected);
          break;
        case ">=":
        case "gte":
          ok = Number(actual) >= Number(expected);
          break;
        case "<=":
        case "lte":
          ok = Number(actual) <= Number(expected);
          break;
        case "contains":
          ok = String(actual ?? "").includes(String(expected));
          break;
        case "always_false":
          ok = false;
          break;
        default:
          ok = false;
      }
      if (!ok) unmet.push(`${cond.field} ${cond.operator} ${expected}`);
    }
    return unmet;
  }

  private getLedger(): EvidenceLedger | null {
    if (!this.sessionId) return null;
    return this.gateway.getLedger(this.sessionId);
  }

  private getTrustManager(): TrustManager | null {
    if (!this.sessionId) return null;
    return this.gateway.getTrustManager(this.sessionId);
  }
}
