// AEP 2.5 -- Workflow Phases with Typed Verdicts
// Sequential workflow phases on top of task decomposition.

import type { CompletionCriterion } from "../decomposition/types.js";

export type PhaseVerdict = "advance" | "rework" | "skip" | "fail";

export interface Condition {
  field: string;
  operator: "eq" | "gt" | "lt" | "gte" | "lte" | "contains";
  value: string | number | boolean;
}

export interface WorkflowPhase {
  name: string;
  description: string;
  entryConditions: Condition[];
  role: string;
  ring: number;
  exitCriteria: CompletionCriterion[];
  maxRework: number;
}

export interface WorkflowDefinition {
  name: string;
  phases: WorkflowPhase[];
  onFail: "terminate" | "escalate" | "rollback";
}

export interface VerdictRecord {
  phase: string;
  verdict: PhaseVerdict;
  feedback?: string;
  timestamp: string;
}

export interface WorkflowStatus {
  phase: string;
  phaseIndex: number;
  reworkCount: number;
  verdictHistory: VerdictRecord[];
  state: "running" | "completed" | "failed";
}
