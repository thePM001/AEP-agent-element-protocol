export interface TaskScope {
  allowedTools: string[];
  allowedPrefixes: string[];
  allowedPaths: string[];
  maxActions: number;
  inheritFromParent: boolean;
}

export interface TaskNode {
  taskId: string;
  parentTaskId: string | null;
  sessionId: string;
  description: string;
  status: "pending" | "active" | "completed" | "failed" | "cancelled";
  scope: TaskScope;
  children: string[];
  actionIds: string[];
  createdAt: string;
  completedAt: string | null;
}

export interface TaskTree {
  rootTaskId: string;
  nodes: Record<string, TaskNode>;
  sessionId: string;
}

export interface CompletionCriterion {
  type:
    | "all_children_complete"
    | "tests_pass"
    | "no_violations"
    | "trust_above"
    | "drift_below"
    | "custom";
  value?: number | string;
  met: boolean;
}

export interface CompletionGate {
  taskId: string;
  criteria: CompletionCriterion[];
  passed: boolean;
}

export interface DecompositionConfig {
  enabled: boolean;
  max_depth: number;
  max_children: number;
  scope_inheritance: "intersection";
  completion_gate: boolean;
  completion_criteria: CompletionCriterion[];
}
