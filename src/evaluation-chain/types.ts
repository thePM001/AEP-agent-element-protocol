// AEP 2.5 -- Evaluation Chain Short-Circuit Types
// Formalizes the 15-step evaluation chain activation modes.

export enum StepActivationMode {
  ALWAYS = "always",
  ACTIVE = "active",
}

export interface StepActivationEntry {
  step: number;
  name: string;
  mode: StepActivationMode;
  precondition?: string;
}

export interface StepActivationProfile {
  steps: StepActivationEntry[];
  force_all_preconditions: boolean;
}

export type StepVerdictDecision =
  | "pass"
  | "fail"
  | "soft_violation"
  | "escalate"
  | "gate_pending";

export interface StepVerdict {
  step: number;
  name: string;
  mode: StepActivationMode;
  precondition?: string;
  precondition_result?: boolean;
  verdict: StepVerdictDecision;
  verdict_reason: string;
  duration_us: number;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface ChainResult {
  decision: "allow" | "deny" | "gate";
  actionId: string;
  reasons: string[];
  verdicts: StepVerdict[];
  steps_total: number;
  steps_evaluated: number;
  steps_short_circuited: number;
  steps_aborted: number;
  matchedCapability?: unknown;
  matchedGate?: unknown;
  matchedForbidden?: unknown;
}

export interface EvalContext {
  session: {
    id: string;
    state: string;
    actionCount: number;
    actionsInLastMinute: number;
    elapsedMs: number;
    actionsDenied: number;
    actionsAllowed: number;
    actionsGated: number;
    actionsEvaluated: number;
  };
  config: {
    drift: { warmupThreshold: number };
    budgets?: {
      tokenBudget?: number;
      costBudget?: number;
      dailySpendLimit?: number;
      maxRuntimeMs?: number;
      maxActions?: number;
      maxDenials?: number;
    };
    gates: Record<string, unknown>;
  };
  policy: {
    escalation: Array<{
      after_actions?: number;
      after_minutes?: number;
      after_denials?: number;
      require: string;
    }>;
  };
  currentAction: {
    tool: string;
    type: string;
    input: Record<string, unknown>;
    involvesRetrieval: boolean;
  };
  fleet: {
    activeAgentCount: number;
  };
  knowledgeBase?: {
    active: boolean;
  };
  decomposition?: {
    enabled: boolean;
  };
}
