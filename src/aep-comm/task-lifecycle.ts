/**
 * Task Lifecycle - Google A2A-compatible task management.
 * Extends AEP-Comm DelegateResolver with formal task states,
 * cancellation support, push notifications, and history.
 * Part of AEP-Comm v2.75 - Universal Orchestration.
 */

export type TaskState =
  | "pending"
  | "working"
  | "input-required"
  | "output-available"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";

export interface TaskStatus {
  state: TaskState;
  message?: {
    role: "agent" | "user";
    parts: Array<{ type: "text" | "file" | "data"; content: unknown }>;
  };
  timestamp: number;
}

export interface Task {
  id: string;
  sessionId?: string;
  status: TaskStatus;
  history: TaskStatus[];
  artifacts: Array<{
    name: string;
    parts: Array<{ type: "text" | "file" | "data"; content: unknown }>;
  }>;
  metadata?: Record<string, unknown>;
}

export class TaskManager {
  private tasks: Map<string, Task> = new Map();
  private pushCallbacks: Map<string, (task: Task) => void> = new Map();

  /**
   * Create a new task between agents.
   */
  createTask(params: {
    sessionId?: string;
    metadata?: Record<string, unknown>;
    pushUrl?: string;
  }): Task {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: Task = {
      id,
      sessionId: params.sessionId,
      status: { state: "pending", timestamp: Date.now() },
      history: [],
      artifacts: [],
      metadata: params.metadata,
    };

    this.tasks.set(id, task);
    return task;
  }

  /**
   * Transition a task to a new state.
   */
  transition(taskId: string, newState: TaskState, message?: TaskStatus["message"]): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const validTransition = this.isValidTransition(task.status.state, newState);
    if (!validTransition) return null;

    const status: TaskStatus = {
      state: newState,
      message,
      timestamp: Date.now(),
    };

    task.status = status;
    task.history.push(status);
    this.tasks.set(taskId, task);

    // Trigger push notification if callback registered
    const callback = this.pushCallbacks.get(taskId);
    if (callback) {
      callback(task);
    }

    return task;
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string): boolean {
    const result = this.transition(taskId, "cancelled");
    return result !== null;
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): Task | null {
    return this.tasks.get(taskId) ?? null;
  }

  /**
   * Get task history.
   */
  getHistory(taskId: string): TaskStatus[] {
    return this.tasks.get(taskId)?.history ?? [];
  }

  /**
   * Register a push notification callback for a task.
   */
  onPush(taskId: string, callback: (task: Task) => void): void {
    this.pushCallbacks.set(taskId, callback);
  }

  /**
   * Get all active tasks (not in terminal state).
   */
  getActiveTasks(): Task[] {
    const terminal: TaskState[] = ["completed", "failed", "cancelled", "rejected"];
    return Array.from(this.tasks.values()).filter(
      (t) => !terminal.includes(t.status.state)
    );
  }

  /**
   * Clean up completed/failed/cancelled tasks older than maxAgeMs.
   */
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status.timestamp < cutoff) {
        this.tasks.delete(id);
        this.pushCallbacks.delete(id);
        count++;
      }
    }
    return count;
  }

  private isValidTransition(from: TaskState, to: TaskState): boolean {
    const transitions: Record<TaskState, TaskState[]> = {
      "pending": ["working", "cancelled", "rejected"],
      "working": ["input-required", "output-available", "completed", "failed", "cancelled"],
      "input-required": ["working", "cancelled", "rejected"],
      "output-available": ["completed", "failed", "cancelled"],
      "completed": [],
      "failed": [],
      "cancelled": [],
      "rejected": [],
    };
    return transitions[from]?.includes(to) ?? false;
  }
}
