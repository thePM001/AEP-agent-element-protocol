import { randomUUID } from "node:crypto";
import type {
  TaskNode,
  TaskScope,
  TaskTree,
  CompletionGate,
  CompletionCriterion,
  DecompositionConfig,
} from "./types.js";

const DEFAULT_CONFIG: DecompositionConfig = {
  enabled: false,
  max_depth: 5,
  max_children: 10,
  scope_inheritance: "intersection",
  completion_gate: false,
  completion_criteria: [],
};

export class TaskDecompositionManager {
  private trees: Map<string, TaskTree> = new Map();
  private taskIndex: Map<string, TaskNode> = new Map();
  private config: DecompositionConfig;

  constructor(config?: Partial<DecompositionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  createRoot(
    sessionId: string,
    description: string,
    scope: TaskScope
  ): TaskNode {
    const taskId = randomUUID();
    const node: TaskNode = {
      taskId,
      parentTaskId: null,
      sessionId,
      description,
      status: "active",
      scope,
      children: [],
      actionIds: [],
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    const tree: TaskTree = {
      rootTaskId: taskId,
      nodes: { [taskId]: node },
      sessionId,
    };

    this.trees.set(sessionId, tree);
    this.taskIndex.set(taskId, node);

    return node;
  }

  decompose(
    parentTaskId: string,
    subtasks: Array<{ description: string; scope: TaskScope }>
  ): TaskNode[] {
    const parent = this.taskIndex.get(parentTaskId);
    if (!parent) {
      throw new Error(`Parent task "${parentTaskId}" not found.`);
    }

    // Enforce max_children
    if (parent.children.length + subtasks.length > this.config.max_children) {
      throw new Error(
        `Max children exceeded: ${parent.children.length + subtasks.length} > ${this.config.max_children}.`
      );
    }

    // Enforce max_depth
    const depth = this.getDepth(parentTaskId);
    if (depth >= this.config.max_depth) {
      throw new Error(
        `Max decomposition depth exceeded: depth ${depth + 1} > ${this.config.max_depth}.`
      );
    }

    const tree = this.trees.get(parent.sessionId);
    if (!tree) {
      throw new Error(`Task tree for session "${parent.sessionId}" not found.`);
    }

    const created: TaskNode[] = [];

    for (const sub of subtasks) {
      const taskId = randomUUID();

      // SCOPE INTERSECTION: child scope is intersection of parent scope and declared scope
      const intersectedScope = this.intersectScope(parent.scope, sub.scope);

      const node: TaskNode = {
        taskId,
        parentTaskId,
        sessionId: parent.sessionId,
        description: sub.description,
        status: "pending",
        scope: intersectedScope,
        children: [],
        actionIds: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
      };

      parent.children.push(taskId);
      tree.nodes[taskId] = node;
      this.taskIndex.set(taskId, node);
      created.push(node);
    }

    return created;
  }

  assignAction(taskId: string, actionId: string): void {
    const task = this.taskIndex.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found.`);
    }
    task.actionIds.push(actionId);
  }

  /**
   * Validates whether an action is within a task's scope.
   * Returns null if allowed, or a denial reason string if outside scope.
   */
  validateActionScope(
    taskId: string,
    tool: string,
    input: Record<string, unknown>
  ): string | null {
    const task = this.taskIndex.get(taskId);
    if (!task) return null; // No task = no scope restriction

    const scope = task.scope;

    // Check tool allowlist
    if (scope.allowedTools.length > 0) {
      const toolAllowed = scope.allowedTools.some((allowed) => {
        if (allowed === tool) return true;
        if (allowed === "*") return true;
        if (allowed.endsWith(":*")) {
          return tool.startsWith(allowed.slice(0, -1));
        }
        return false;
      });
      if (!toolAllowed) {
        return `Tool "${tool}" is outside task scope. Allowed: ${scope.allowedTools.join(", ")}`;
      }
    }

    // Check AEP prefix allowlist
    if (scope.allowedPrefixes.length > 0) {
      const id = input.id ?? input.elementId ?? input.target;
      if (typeof id === "string" && id.includes("-")) {
        const prefix = id.split("-")[0];
        if (!scope.allowedPrefixes.includes(prefix)) {
          return `AEP prefix "${prefix}" is outside task scope. Allowed: ${scope.allowedPrefixes.join(", ")}`;
        }
      }
    }

    // Check path allowlist
    if (scope.allowedPaths.length > 0 && input.path) {
      const actionPath = String(input.path);
      const pathAllowed = scope.allowedPaths.some((pattern) => {
        if (pattern === "*" || pattern === "**") return true;
        if (pattern.endsWith("/**")) {
          return actionPath.startsWith(pattern.slice(0, -3));
        }
        if (pattern.endsWith("/*")) {
          return actionPath.startsWith(pattern.slice(0, -2));
        }
        return (
          actionPath === pattern || actionPath.startsWith(pattern + "/")
        );
      });
      if (!pathAllowed) {
        return `Path "${actionPath}" is outside task scope. Allowed: ${scope.allowedPaths.join(", ")}`;
      }
    }

    // Check action budget
    if (task.actionIds.length >= scope.maxActions) {
      return `Task action budget exceeded: ${task.actionIds.length}/${scope.maxActions}.`;
    }

    return null;
  }

  completeTask(
    taskId: string,
    context?: { trustScore?: number; driftScore?: number; violations?: number }
  ): CompletionGate {
    const task = this.taskIndex.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" not found.`);
    }

    const criteria: CompletionCriterion[] = this.config.completion_criteria.map(
      (c) => ({ ...c, met: false })
    );

    for (const criterion of criteria) {
      switch (criterion.type) {
        case "all_children_complete":
          criterion.met = task.children.every((childId) => {
            const child = this.taskIndex.get(childId);
            return child?.status === "completed";
          });
          break;

        case "no_violations":
          criterion.met = (context?.violations ?? 0) === 0;
          break;

        case "trust_above":
          if (typeof criterion.value === "number" && context?.trustScore !== undefined) {
            criterion.met = context.trustScore > criterion.value;
          }
          break;

        case "drift_below":
          if (typeof criterion.value === "number" && context?.driftScore !== undefined) {
            criterion.met = context.driftScore < criterion.value;
          }
          break;

        case "tests_pass":
          // External signal - default to met if no context
          criterion.met = true;
          break;

        case "custom":
          // External signal - default to met
          criterion.met = true;
          break;
      }
    }

    const passed =
      criteria.length === 0 || criteria.every((c) => c.met);

    if (passed) {
      task.status = "completed";
      task.completedAt = new Date().toISOString();
    }

    return { taskId, criteria, passed };
  }

  getTree(sessionId: string): TaskTree | null {
    return this.trees.get(sessionId) ?? null;
  }

  getTask(taskId: string): TaskNode | null {
    return this.taskIndex.get(taskId) ?? null;
  }

  getTaskScope(taskId: string): TaskScope | null {
    const task = this.taskIndex.get(taskId);
    return task?.scope ?? null;
  }

  cancelSubtree(taskId: string): void {
    const task = this.taskIndex.get(taskId);
    if (!task) return;

    task.status = "cancelled";
    task.completedAt = new Date().toISOString();

    for (const childId of task.children) {
      this.cancelSubtree(childId);
    }
  }

  getConfig(): DecompositionConfig {
    return { ...this.config };
  }

  /**
   * Compute the intersection of parent scope and child's declared scope.
   * A child can NEVER have more access than its parent.
   */
  private intersectScope(parentScope: TaskScope, childScope: TaskScope): TaskScope {
    return {
      allowedTools:
        childScope.allowedTools.length > 0
          ? childScope.allowedTools.filter(
              (t) =>
                parentScope.allowedTools.length === 0 ||
                parentScope.allowedTools.includes(t) ||
                parentScope.allowedTools.some((pt) => {
                  if (pt === "*") return true;
                  if (pt.endsWith(":*")) return t.startsWith(pt.slice(0, -1));
                  return false;
                })
            )
          : [...parentScope.allowedTools],

      allowedPrefixes:
        childScope.allowedPrefixes.length > 0
          ? childScope.allowedPrefixes.filter(
              (p) =>
                parentScope.allowedPrefixes.length === 0 ||
                parentScope.allowedPrefixes.includes(p)
            )
          : [...parentScope.allowedPrefixes],

      allowedPaths:
        childScope.allowedPaths.length > 0
          ? childScope.allowedPaths.filter(
              (p) =>
                parentScope.allowedPaths.length === 0 ||
                parentScope.allowedPaths.some(
                  (pp) =>
                    p === pp ||
                    p.startsWith(pp.replace(/\/?\*\*?$/, "") + "/") ||
                    pp === "*" ||
                    pp === "**"
                )
            )
          : [...parentScope.allowedPaths],

      maxActions: Math.min(parentScope.maxActions, childScope.maxActions),

      inheritFromParent: childScope.inheritFromParent,
    };
  }

  private getDepth(taskId: string): number {
    let depth = 0;
    let current = this.taskIndex.get(taskId);
    while (current?.parentTaskId) {
      depth++;
      current = this.taskIndex.get(current.parentTaskId);
    }
    return depth;
  }
}
