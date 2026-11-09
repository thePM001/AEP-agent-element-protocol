import { describe, it, expect } from "vitest";
import { TaskDecompositionManager } from "../lib/manager.js";
import type { TaskScope } from "../lib/types.js";

function scope(overrides: Partial<TaskScope> = {}): TaskScope {
  return {
    allowedTools: [],
    allowedPrefixes: [],
    allowedPaths: [],
    maxActions: 100,
    inheritFromParent: true,
    ...overrides,
  };
}

describe("TaskDecompositionManager tree building", () => {
  it("creates a root task and tree", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s1", "root task", scope());
    expect(root.status).toBe("active");
    expect(root.parentTaskId).toBeNull();
    const tree = mgr.getTree("s1");
    expect(tree?.rootTaskId).toBe(root.taskId);
    expect(tree?.nodes[root.taskId]).toBe(root);
    expect(mgr.getTask(root.taskId)).toBe(root);
    expect(mgr.getTree("other")).toBeNull();
    expect(mgr.getTask("nope")).toBeNull();
  });

  it("decomposes into pending children linked to the parent", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s1", "root", scope());
    const kids = mgr.decompose(root.taskId, [
      { description: "a", scope: scope() },
      { description: "b", scope: scope() },
    ]);
    expect(kids.map((k) => k.description)).toEqual(["a", "b"]);
    expect(kids.every((k) => k.status === "pending" && k.parentTaskId === root.taskId)).toBe(true);
    expect(root.children).toEqual(kids.map((k) => k.taskId));
    expect(Object.keys(mgr.getTree("s1")?.nodes ?? {})).toHaveLength(3);
  });

  it("rejects an unknown parent", () => {
    expect(() => new TaskDecompositionManager().decompose("missing", [])).toThrow(/not found/);
  });

  it("enforces max_children across calls", () => {
    const mgr = new TaskDecompositionManager({ max_children: 2 });
    const root = mgr.createRoot("s", "r", scope());
    mgr.decompose(root.taskId, [{ description: "a", scope: scope() }]);
    expect(() =>
      mgr.decompose(root.taskId, [
        { description: "b", scope: scope() },
        { description: "c", scope: scope() },
      ]),
    ).toThrow("Max children exceeded: 3 > 2.");
  });

  it("enforces max_depth", () => {
    const mgr = new TaskDecompositionManager({ max_depth: 2 });
    const root = mgr.createRoot("s", "r", scope());
    const [d1] = mgr.decompose(root.taskId, [{ description: "d1", scope: scope() }]);
    const [d2] = mgr.decompose(d1?.taskId ?? "", [{ description: "d2", scope: scope() }]);
    expect(() => mgr.decompose(d2?.taskId ?? "", [{ description: "d3", scope: scope() }])).toThrow(
      "Max decomposition depth exceeded: depth 3 > 2.",
    );
  });

  it("merges partial config over defaults", () => {
    const cfg = new TaskDecompositionManager({ max_depth: 9 }).getConfig();
    expect(cfg.max_depth).toBe(9);
    expect(cfg.max_children).toBe(10);
    expect(cfg.scope_inheritance).toBe("intersection");
  });
});

describe("TaskDecompositionManager scope intersection", () => {
  it("child scope never exceeds the parent", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot(
      "s",
      "r",
      scope({ allowedTools: ["file:read", "aep:*"], allowedPrefixes: ["CP", "PN"], allowedPaths: ["src/**"], maxActions: 10 }),
    );
    const [child] = mgr.decompose(root.taskId, [
      {
        description: "c",
        scope: scope({
          allowedTools: ["file:read", "file:write", "aep:create_element"],
          allowedPrefixes: ["CP", "XX"],
          allowedPaths: ["src/lib/**", "etc/**"],
          maxActions: 50,
          inheritFromParent: false,
        }),
      },
    ]);
    expect(child?.scope).toEqual({
      allowedTools: ["file:read", "aep:create_element"],
      allowedPrefixes: ["CP"],
      allowedPaths: ["src/lib/**"],
      maxActions: 10,
      inheritFromParent: false,
    });
  });

  it("inherits parent lists when the child declares none", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s", "r", scope({ allowedTools: ["file:read"], allowedPaths: ["docs"] }));
    const [child] = mgr.decompose(root.taskId, [{ description: "c", scope: scope({ maxActions: 3 }) }]);
    expect(child?.scope.allowedTools).toEqual(["file:read"]);
    expect(child?.scope.allowedPaths).toEqual(["docs"]);
    expect(child?.scope.maxActions).toBe(3);
  });

  it("fails closed when a declared list has no overlap with the parent", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s", "r", scope({ allowedTools: ["file:read"] }));
    const [child] = mgr.decompose(root.taskId, [
      { description: "escalate", scope: scope({ allowedTools: ["command:run"] }) },
    ]);
    expect(child?.scope.allowedTools).toEqual([]);
    expect(child?.scope.maxActions).toBe(0);
    const err = mgr.validateActionScope(child?.taskId ?? "", "command:run", {});
    expect(err).toMatch(/budget exceeded/);
  });
});

describe("TaskDecompositionManager action validation", () => {
  const mgr = new TaskDecompositionManager();
  const root = mgr.createRoot(
    "s",
    "r",
    scope({ allowedTools: ["file:read", "aep:*"], allowedPrefixes: ["CP"], allowedPaths: ["src/**", "docs"], maxActions: 2 }),
  );

  it("allows in-scope actions and reports out-of-scope ones", () => {
    expect(mgr.validateActionScope(root.taskId, "file:read", { path: "src/a.ts" })).toBeNull();
    expect(mgr.validateActionScope(root.taskId, "aep:update_element", { id: "CP-001" })).toBeNull();
    expect(mgr.validateActionScope(root.taskId, "file:write", {})).toMatch(/Tool "file:write" is outside task scope/);
    expect(mgr.validateActionScope(root.taskId, "aep:update_element", { id: "PN-001" })).toMatch(
      /AEP prefix "PN" is outside task scope/,
    );
    expect(mgr.validateActionScope(root.taskId, "file:read", { path: "etc/passwd" })).toMatch(/Path "etc\/passwd"/);
    expect(mgr.validateActionScope(root.taskId, "file:read", { path: "docs/readme" })).toBeNull();
    expect(mgr.validateActionScope(root.taskId, "file:read", { path: "docsx" })).toMatch(/outside task scope/);
  });

  it("does not restrict actions on an unknown task", () => {
    expect(mgr.validateActionScope("unknown", "anything", {})).toBeNull();
  });

  it("assigns actions within budget and refuses beyond it", () => {
    mgr.assignAction(root.taskId, "a1", { tool: "file:read", input: {} });
    expect(() => mgr.assignAction(root.taskId, "bad", { tool: "file:write" })).toThrow(/outside task scope/);
    mgr.assignAction(root.taskId, "a2");
    expect(root.actionIds).toEqual(["a1", "a2"]);
    expect(() => mgr.assignAction(root.taskId, "a3")).toThrow("Task action budget exceeded: 2/2.");
    expect(() => mgr.assignAction("missing", "x")).toThrow(/not found/);
  });
});

describe("TaskDecompositionManager completion", () => {
  it("completes immediately with no criteria", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s", "r", scope());
    const gate = mgr.completeTask(root.taskId);
    expect(gate).toEqual({ taskId: root.taskId, criteria: [], passed: true });
    expect(root.status).toBe("completed");
    expect(root.completedAt).not.toBeNull();
  });

  it("evaluates criteria against children and context", () => {
    const mgr = new TaskDecompositionManager({
      completion_criteria: [
        { type: "all_children_complete", met: false },
        { type: "no_violations", met: false },
        { type: "trust_above", value: 500, met: false },
        { type: "drift_below", value: 0.3, met: false },
        { type: "tests_pass", met: false },
      ],
    });
    const root = mgr.createRoot("s", "r", scope());
    const [child] = mgr.decompose(root.taskId, [{ description: "c", scope: scope() }]);

    const blocked = mgr.completeTask(root.taskId, { trustScore: 600, driftScore: 0.1, violations: 0 });
    expect(blocked.passed).toBe(false);
    expect(blocked.criteria.map((c) => [c.type, c.met])).toEqual([
      ["all_children_complete", false],
      ["no_violations", true],
      ["trust_above", true],
      ["drift_below", true],
      ["tests_pass", true],
    ]);
    expect(root.status).toBe("active");

    // child has no children: only context criteria apply
    expect(mgr.completeTask(child?.taskId ?? "", { trustScore: 600, driftScore: 0.1 }).passed).toBe(true);
    expect(mgr.completeTask(root.taskId, { trustScore: 600, driftScore: 0.1 }).passed).toBe(true);

    const low = mgr.completeTask(root.taskId, { trustScore: 100, driftScore: 0.9, violations: 2 });
    expect(low.criteria.filter((c) => !c.met).map((c) => c.type)).toEqual(["no_violations", "trust_above", "drift_below"]);
  });

  it("leaves numeric criteria unmet without context", () => {
    const mgr = new TaskDecompositionManager({ completion_criteria: [{ type: "trust_above", value: 1, met: true }] });
    const root = mgr.createRoot("s", "r", scope());
    expect(mgr.completeTask(root.taskId).passed).toBe(false);
  });

  it("throws for an unknown task", () => {
    expect(() => new TaskDecompositionManager().completeTask("x")).toThrow(/not found/);
  });

  it("cancels a whole subtree", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s", "r", scope());
    const [a] = mgr.decompose(root.taskId, [{ description: "a", scope: scope() }]);
    const [b] = mgr.decompose(a?.taskId ?? "", [{ description: "b", scope: scope() }]);
    mgr.cancelSubtree(root.taskId);
    expect([root.status, a?.status, b?.status]).toEqual(["cancelled", "cancelled", "cancelled"]);
    expect(b?.completedAt).not.toBeNull();
    expect(() => mgr.cancelSubtree("missing")).not.toThrow();
  });

  it("returns task scope or null", () => {
    const mgr = new TaskDecompositionManager();
    const root = mgr.createRoot("s", "r", scope({ maxActions: 7 }));
    expect(mgr.getTaskScope(root.taskId)?.maxActions).toBe(7);
    expect(mgr.getTaskScope("x")).toBeNull();
  });
});
