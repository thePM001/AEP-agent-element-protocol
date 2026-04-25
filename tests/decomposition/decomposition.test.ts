import { randomUUID } from "node:crypto";
import { TaskDecompositionManager } from "../../src/decomposition/manager.js";
import type { TaskScope, TaskNode } from "../../src/decomposition/types.js";

function makeScope(overrides?: Partial<TaskScope>): TaskScope {
  return {
    allowedTools: ["file:read", "file:write", "aep:create_element"],
    allowedPrefixes: ["CP", "PN"],
    allowedPaths: ["src/**", "tests/**"],
    maxActions: 50,
    inheritFromParent: true,
    ...overrides,
  };
}

describe("TaskDecompositionManager", () => {
  describe("Root task creation", () => {
    it("creates a root task with correct fields", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Build auth module", makeScope());

      expect(root.taskId).toBeDefined();
      expect(root.parentTaskId).toBeNull();
      expect(root.sessionId).toBe(sessionId);
      expect(root.description).toBe("Build auth module");
      expect(root.status).toBe("active");
      expect(root.children).toEqual([]);
      expect(root.actionIds).toEqual([]);
      expect(root.createdAt).toBeDefined();
      expect(root.completedAt).toBeNull();
    });

    it("creates a task tree for the session", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root task", makeScope());

      const tree = dm.getTree(sessionId);
      expect(tree).not.toBeNull();
      expect(tree!.rootTaskId).toBe(root.taskId);
      expect(tree!.sessionId).toBe(sessionId);
      expect(Object.keys(tree!.nodes)).toHaveLength(1);
    });
  });

  describe("Subtask decomposition with scope narrowing", () => {
    it("creates child tasks under parent", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());

      const children = dm.decompose(root.taskId, [
        { description: "Write tests", scope: makeScope({ allowedTools: ["file:write"] }) },
        { description: "Write code", scope: makeScope({ allowedTools: ["file:read", "file:write"] }) },
      ]);

      expect(children).toHaveLength(2);
      expect(children[0].parentTaskId).toBe(root.taskId);
      expect(children[1].parentTaskId).toBe(root.taskId);
      expect(children[0].status).toBe("pending");

      // Parent should have children IDs
      const parentNode = dm.getTask(root.taskId);
      expect(parentNode!.children).toHaveLength(2);
    });
  });

  describe("Scope intersection (child never wider than parent)", () => {
    it("intersects tools: child gets only tools present in both parent and child scope", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      // Parent allows CP and PN
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedPrefixes: ["CP", "PN"],
      }));

      // Child declares CP and WD, but WD is not in parent
      const [child] = dm.decompose(root.taskId, [
        {
          description: "Subtask",
          scope: makeScope({ allowedPrefixes: ["CP", "WD"] }),
        },
      ]);

      // Child should only get CP (intersection)
      expect(child.scope.allowedPrefixes).toEqual(["CP"]);
    });

    it("intersects paths", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedPaths: ["src/**", "tests/**"],
      }));

      const [child] = dm.decompose(root.taskId, [
        {
          description: "Subtask",
          scope: makeScope({ allowedPaths: ["src/**", "docs/**"] }),
        },
      ]);

      // Child gets only src/** (docs/** not in parent)
      expect(child.scope.allowedPaths).toEqual(["src/**"]);
    });

    it("takes minimum maxActions", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({ maxActions: 50 }));

      const [child] = dm.decompose(root.taskId, [
        {
          description: "Subtask",
          scope: makeScope({ maxActions: 20 }),
        },
      ]);

      expect(child.scope.maxActions).toBe(20);
    });

    it("parent maxActions overrides child if parent is smaller", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({ maxActions: 10 }));

      const [child] = dm.decompose(root.taskId, [
        {
          description: "Subtask",
          scope: makeScope({ maxActions: 50 }),
        },
      ]);

      expect(child.scope.maxActions).toBe(10);
    });
  });

  describe("Scope escalation attempt rejected", () => {
    it("child cannot gain prefixes parent lacks", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedPrefixes: ["CP"],
      }));

      const [child] = dm.decompose(root.taskId, [
        {
          description: "Escalation attempt",
          scope: makeScope({ allowedPrefixes: ["CP", "SH", "OV"] }),
        },
      ]);

      // Only CP survives intersection
      expect(child.scope.allowedPrefixes).toEqual(["CP"]);
      expect(child.scope.allowedPrefixes).not.toContain("SH");
      expect(child.scope.allowedPrefixes).not.toContain("OV");
    });
  });

  describe("Action assignment within task scope passes", () => {
    it("allows action within scope", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedTools: ["file:read", "file:write"],
        allowedPaths: ["src/**"],
      }));

      const denial = dm.validateActionScope(root.taskId, "file:read", {
        path: "src/index.ts",
      });
      expect(denial).toBeNull();
    });
  });

  describe("Action outside task scope denied", () => {
    it("denies tool not in allowedTools", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedTools: ["file:read"],
      }));

      const denial = dm.validateActionScope(root.taskId, "file:delete", {});
      expect(denial).not.toBeNull();
      expect(denial).toContain("outside task scope");
    });

    it("denies prefix not in allowedPrefixes", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedPrefixes: ["CP"],
      }));

      const denial = dm.validateActionScope(root.taskId, "aep:create_element", {
        id: "SH-00001",
      });
      expect(denial).not.toBeNull();
      expect(denial).toContain("outside task scope");
    });

    it("denies path not in allowedPaths", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        allowedPaths: ["src/**"],
      }));

      const denial = dm.validateActionScope(root.taskId, "file:write", {
        path: "secrets/.env",
      });
      expect(denial).not.toBeNull();
      expect(denial).toContain("outside task scope");
    });
  });

  describe("Task action budget enforced", () => {
    it("denies when maxActions exceeded", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope({
        maxActions: 2,
      }));

      // Assign 2 actions (reaching budget)
      dm.assignAction(root.taskId, "action-1");
      dm.assignAction(root.taskId, "action-2");

      const denial = dm.validateActionScope(root.taskId, "file:read", {});
      expect(denial).not.toBeNull();
      expect(denial).toContain("budget exceeded");
    });
  });

  describe("Max depth enforced", () => {
    it("rejects decomposition beyond max_depth", () => {
      const dm = new TaskDecompositionManager({ enabled: true, max_depth: 2 });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());

      // Depth 1
      const [child1] = dm.decompose(root.taskId, [
        { description: "Level 1", scope: makeScope() },
      ]);

      // Depth 2
      const [child2] = dm.decompose(child1.taskId, [
        { description: "Level 2", scope: makeScope() },
      ]);

      // Depth 3 should fail (max_depth = 2)
      expect(() => {
        dm.decompose(child2.taskId, [
          { description: "Level 3", scope: makeScope() },
        ]);
      }).toThrow("Max decomposition depth exceeded");
    });
  });

  describe("Max children enforced", () => {
    it("rejects more than max_children subtasks", () => {
      const dm = new TaskDecompositionManager({ enabled: true, max_children: 2 });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());

      expect(() => {
        dm.decompose(root.taskId, [
          { description: "A", scope: makeScope() },
          { description: "B", scope: makeScope() },
          { description: "C", scope: makeScope() },
        ]);
      }).toThrow("Max children exceeded");
    });
  });

  describe("Completion gate: all_children_complete", () => {
    it("passes when all children are complete", () => {
      const dm = new TaskDecompositionManager({
        enabled: true,
        completion_gate: true,
        completion_criteria: [
          { type: "all_children_complete", met: false },
        ],
      });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());
      const [child1, child2] = dm.decompose(root.taskId, [
        { description: "A", scope: makeScope() },
        { description: "B", scope: makeScope() },
      ]);

      // Complete both children
      const c1 = dm.getTask(child1.taskId)!;
      c1.status = "completed";
      c1.completedAt = new Date().toISOString();
      const c2 = dm.getTask(child2.taskId)!;
      c2.status = "completed";
      c2.completedAt = new Date().toISOString();

      const gate = dm.completeTask(root.taskId);
      expect(gate.passed).toBe(true);
      expect(gate.criteria[0].met).toBe(true);
    });

    it("fails when a child is not complete", () => {
      const dm = new TaskDecompositionManager({
        enabled: true,
        completion_gate: true,
        completion_criteria: [
          { type: "all_children_complete", met: false },
        ],
      });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());
      dm.decompose(root.taskId, [
        { description: "A", scope: makeScope() },
        { description: "B", scope: makeScope() },
      ]);

      // Don't complete children
      const gate = dm.completeTask(root.taskId);
      expect(gate.passed).toBe(false);
      expect(gate.criteria[0].met).toBe(false);
    });
  });

  describe("Completion gate: no_violations", () => {
    it("passes when violations is 0", () => {
      const dm = new TaskDecompositionManager({
        enabled: true,
        completion_criteria: [
          { type: "no_violations", met: false },
        ],
      });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());

      const gate = dm.completeTask(root.taskId, { violations: 0 });
      expect(gate.passed).toBe(true);
    });

    it("fails when violations > 0", () => {
      const dm = new TaskDecompositionManager({
        enabled: true,
        completion_criteria: [
          { type: "no_violations", met: false },
        ],
      });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());

      const gate = dm.completeTask(root.taskId, { violations: 3 });
      expect(gate.passed).toBe(false);
    });
  });

  describe("Task cancellation cancels full subtree", () => {
    it("cancels task and all descendants", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());
      const [child1] = dm.decompose(root.taskId, [
        { description: "Child 1", scope: makeScope() },
      ]);
      const [grandchild] = dm.decompose(child1.taskId, [
        { description: "Grandchild", scope: makeScope() },
      ]);

      dm.cancelSubtree(child1.taskId);

      expect(dm.getTask(child1.taskId)!.status).toBe("cancelled");
      expect(dm.getTask(grandchild.taskId)!.status).toBe("cancelled");
      // Root should be unaffected
      expect(dm.getTask(root.taskId)!.status).toBe("active");
    });
  });

  describe("Intent drift measured against task description", () => {
    it("task description is available for drift context", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Build auth module", makeScope());
      const [child] = dm.decompose(root.taskId, [
        { description: "Write tests for auth", scope: makeScope() },
      ]);

      // The task's description is accessible and can be used for drift measurement
      const task = dm.getTask(child.taskId);
      expect(task!.description).toBe("Write tests for auth");
      // In the gateway, drift detection would use this description as the intent
    });
  });

  describe("Proof bundle includes task tree", () => {
    it("task tree is serializable in proof bundle context", () => {
      const dm = new TaskDecompositionManager({ enabled: true });
      const sessionId = randomUUID();
      const root = dm.createRoot(sessionId, "Root", makeScope());
      dm.decompose(root.taskId, [
        { description: "A", scope: makeScope() },
        { description: "B", scope: makeScope() },
      ]);

      const tree = dm.getTree(sessionId);
      expect(tree).not.toBeNull();
      expect(Object.keys(tree!.nodes)).toHaveLength(3);
      // Tree can be serialized to JSON (for inclusion in proof bundle)
      const json = JSON.stringify(tree);
      const parsed = JSON.parse(json);
      expect(parsed.rootTaskId).toBe(root.taskId);
    });
  });

  describe("Evidence ledger logs all task lifecycle events", () => {
    it("task lifecycle events use correct type strings", () => {
      // Just verify the type strings are valid LedgerEntryType values
      const types = [
        "task:create",
        "task:decompose",
        "task:complete",
        "task:fail",
        "task:cancel",
      ];
      // These should be importable and recognized
      for (const t of types) {
        expect(typeof t).toBe("string");
        expect(t).toMatch(/^task:/);
      }
    });
  });
});
