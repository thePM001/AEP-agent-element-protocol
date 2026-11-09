import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionLattice,
  HookRegistry,
  LatticeFilter,
  governanceAppliesToCategory,
  ignoreClientTrustTier,
  type HookResult,
  type LatticeConfig,
  type LatticeConstraint,
  type LatticeEvent,
  type LatticeNode,
  type ValidationHook,
} from "../bridge/lattice/index.js";

const here = dirname(fileURLToPath(import.meta.url));

type NodeSpec = Partial<Omit<LatticeNode, "id">> & Pick<LatticeNode, "category">;

function node(spec: NodeSpec): Omit<LatticeNode, "id"> {
  return {
    label: spec.label ?? "test node",
    category: spec.category,
    parents: spec.parents ?? [],
    children: spec.children ?? [],
    constraints: spec.constraints ?? [],
    agent_permission: spec.agent_permission ?? ["*"],
  };
}

function config(actions: Record<string, Omit<LatticeNode, "id">>): LatticeConfig {
  return { aep_version: "1.2", dynaep_version: "1.0", lattice_revision: 1, actions };
}

function baseConfig(): LatticeConfig {
  return config({
    "system:startup": node({
      category: "system_event",
      children: ["system:ready"],
      agent_permission: ["unbound", "*"],
    }),
    "system:ready": node({
      category: "system_event",
      parents: ["system:startup"],
      children: ["agent:plan"],
      agent_permission: ["unbound", "*"],
    }),
    "agent:plan": node({
      category: "agent_action",
      parents: ["system:ready"],
      children: ["agent:execute"],
      agent_permission: ["alice", "bob"],
      constraints: [{ type: "required_field", field: "task" }],
    }),
    "agent:execute": node({
      category: "agent_action",
      parents: ["agent:plan"],
      agent_permission: ["alice", "bob"],
      constraints: [{ type: "threshold", field: "amount", condition: "< 100" }],
    }),
    "agent:review": node({
      category: "agent_action",
      agent_permission: ["*"],
      constraints: [{ type: "custom", description: "hook decides" }],
    }),
    "agent:delegate": node({
      category: "agent_action",
      agent_permission: ["*"],
      constraints: [{ type: "authorization", field: "delegate_to", condition: "matches_registered" }],
    }),
    "webhook:incoming": node({
      category: "external_event",
      children: ["agent:triage"],
      agent_permission: ["unbound"],
    }),
    "agent:triage": node({
      category: "agent_action",
      parents: ["webhook:incoming"],
      agent_permission: ["*"],
    }),
  });
}

function event(action_path: string, extra: Partial<LatticeEvent> = {}): LatticeEvent {
  return { source: "test", action_path, payload: {}, bridge_timestamp: 1_700_000_000_000, ...extra };
}

function fakeHook(name: string, verdict: (e: LatticeEvent) => HookResult | Error): ValidationHook & { calls: LatticeEvent[] } {
  const calls: LatticeEvent[] = [];
  return {
    name,
    version: "9.9.9",
    calls,
    async validate(e: LatticeEvent): Promise<HookResult> {
      calls.push(e);
      const out = verdict(e);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

describe("governanceAppliesToCategory", () => {
  it("applies to every category under filter_all", () => {
    for (const c of ["external_event", "system_event", "agent_action", "output"] as const) {
      expect(governanceAppliesToCategory("filter_all", c)).toBe(true);
    }
  });

  it("applies only to external and system events under events_only", () => {
    expect(governanceAppliesToCategory("events_only", "external_event")).toBe(true);
    expect(governanceAppliesToCategory("events_only", "system_event")).toBe(true);
    expect(governanceAppliesToCategory("events_only", "agent_action")).toBe(false);
    expect(governanceAppliesToCategory("events_only", "output")).toBe(false);
  });

  it("never applies under disabled or ui_only", () => {
    expect(governanceAppliesToCategory("disabled", "system_event")).toBe(false);
    expect(governanceAppliesToCategory("ui_only", "output")).toBe(false);
  });
});

describe("ignoreClientTrustTier", () => {
  it("drops any client supplied tier", () => {
    expect(ignoreClientTrustTier(5)).toBeUndefined();
    expect(ignoreClientTrustTier()).toBeUndefined();
  });
});

describe("HookRegistry", () => {
  it("registers, lists, resolves aliases and unregisters", () => {
    const reg = new HookRegistry();
    const mle = fakeHook("mle-validator", () => ({ passed: true, score: 1, confidence: 1 }));
    reg.register(mle);
    expect(reg.size).toBe(1);
    expect(reg.has("mle-validator")).toBe(true);
    expect(reg.has("mle")).toBe(false);
    expect(reg.get("mle")).toBe(mle);
    expect(reg.get("mle-validator")).toBe(mle);
    expect(reg.get("missing")).toBeUndefined();
    expect(reg.list()).toEqual([{ name: "mle-validator", version: "9.9.9" }]);
    expect(reg.unregister("mle-validator")).toBe(true);
    expect(reg.unregister("mle-validator")).toBe(false);
    expect(reg.size).toBe(0);
  });

  it("refuses a duplicate registration and names the existing version", () => {
    const reg = new HookRegistry();
    reg.register(fakeHook("dup", () => ({ passed: true, score: 1, confidence: 1 })));
    expect(() => reg.register(fakeHook("dup", () => ({ passed: true, score: 1, confidence: 1 })))).toThrow(
      /already registered \(v9\.9\.9\)/,
    );
  });

  it("clear removes every hook", () => {
    const reg = new HookRegistry();
    reg.register(fakeHook("a", () => ({ passed: true, score: 1, confidence: 1 })));
    reg.register(fakeHook("b", () => ({ passed: true, score: 1, confidence: 1 })));
    reg.clear();
    expect(reg.size).toBe(0);
    expect(reg.list()).toEqual([]);
  });
});

describe("ActionLattice structure", () => {
  it("loads nodes and exposes the graph", () => {
    const lattice = new ActionLattice(baseConfig());
    expect(lattice.size()).toBe(8);
    expect(lattice.has("agent:plan")).toBe(true);
    expect(lattice.has("nope")).toBe(false);
    expect(lattice.get("agent:plan")?.id).toBe("agent:plan");
    expect(lattice.allActions()).toEqual(lattice.paths());
    expect(lattice.isRoot("system:startup")).toBe(true);
    expect(lattice.isRoot("agent:plan")).toBe(false);
    expect(lattice.isRoot("nope")).toBe(false);
  });

  it("parentsOf returns a copy", () => {
    const lattice = new ActionLattice(baseConfig());
    const parents = lattice.parentsOf("agent:plan");
    expect(parents).toEqual(["system:ready"]);
    parents.push("tampered");
    expect(lattice.parentsOf("agent:plan")).toEqual(["system:ready"]);
    expect(lattice.parentsOf("nope")).toEqual([]);
  });

  it("computes upper and lower sets including the query node", () => {
    const lattice = new ActionLattice(baseConfig());
    expect(new Set(lattice.upperSet("system:ready"))).toEqual(
      new Set(["system:ready", "agent:plan", "agent:execute"]),
    );
    expect(new Set(lattice.lowerSet("agent:execute"))).toEqual(
      new Set(["agent:execute", "agent:plan", "system:ready", "system:startup"]),
    );
    expect(lattice.upperSet("agent:execute")).toEqual(["agent:execute"]);
  });

  it("rejects unknown parent references", () => {
    expect(
      () => new ActionLattice(config({ a: node({ category: "agent_action", parents: ["ghost"] }) })),
    ).toThrow(/unknown parent 'ghost'/);
  });

  it("rejects unknown child references", () => {
    expect(
      () => new ActionLattice(config({ a: node({ category: "agent_action", children: ["ghost"] }) })),
    ).toThrow(/unknown child 'ghost'/);
  });

  it("detects cycles", () => {
    const cyclic = config({
      a: node({ category: "agent_action", parents: ["b"] }),
      b: node({ category: "agent_action", parents: ["a"] }),
    });
    expect(() => new ActionLattice(cyclic)).toThrow(/cycle detected/);
  });

  it("load replaces previous content", () => {
    const lattice = new ActionLattice(baseConfig());
    lattice.load(config({ solo: node({ category: "output" }) }));
    expect(lattice.paths()).toEqual(["solo"]);
  });
});

describe("ActionLattice.loadFromFile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a YAML lattice", () => {
    const file = join(dir, "lattice.yaml");
    writeFileSync(
      file,
      [
        "aep_version: '1.2'",
        "dynaep_version: '1.0'",
        "lattice_revision: 3",
        "actions:",
        "  root:",
        "    label: root",
        "    category: system_event",
        "    parents: []",
        "    children: [leaf]",
        "    constraints: []",
        "    agent_permission: ['*']",
        "  leaf:",
        "    label: leaf",
        "    category: output",
        "    parents: [root]",
        "    children: []",
        "    constraints: []",
        "    agent_permission: ['*']",
        "",
      ].join("\n"),
    );
    const lattice = new ActionLattice();
    lattice.loadFromFile(file);
    expect(lattice.paths().sort()).toEqual(["leaf", "root"]);
    expect(lattice.parentsOf("leaf")).toEqual(["root"]);
  });

  it("throws for a missing file", () => {
    expect(() => new ActionLattice().loadFromFile(join(dir, "absent.yaml"))).toThrow(/not found/);
  });

  it("loads the shipped registry without validation errors", () => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(join(here, "..", "registries", "aep-lattice.yaml"));
    expect(lattice.size()).toBeGreaterThan(5);
    expect(lattice.has("webhook:incoming")).toBe(true);
  });
});

describe("ActionLattice.partialOrderSatisfied and agentPermission", () => {
  const lattice = new ActionLattice(baseConfig());

  it("reports an unknown action as its own missing parent", () => {
    expect(lattice.partialOrderSatisfied("nope", new Set())).toEqual({ satisfied: false, missing: ["nope"] });
  });

  it("system parents are satisfied globally", () => {
    expect(lattice.partialOrderSatisfied("agent:plan", new Set()).missing).toEqual(["system:ready"]);
    expect(lattice.partialOrderSatisfied("agent:plan", new Set(["system:ready"]), "alice").satisfied).toBe(true);
  });

  it("agent parents are satisfied per agent", () => {
    const sat = new Set(["agt|alice|agent:plan"]);
    expect(lattice.partialOrderSatisfied("agent:execute", sat, "alice").satisfied).toBe(true);
    expect(lattice.partialOrderSatisfied("agent:execute", sat, "bob")).toEqual({
      satisfied: false,
      missing: ["agent:plan"],
    });
    expect(lattice.partialOrderSatisfied("agent:execute", new Set(["agent:plan"]), "alice").satisfied).toBe(false);
  });

  it("accepts the legacy agent:parent key and the unbound bucket", () => {
    expect(lattice.partialOrderSatisfied("agent:execute", new Set(["bob:agent:plan"]), "bob").satisfied).toBe(true);
    expect(lattice.partialOrderSatisfied("agent:execute", new Set(["agt|unbound|agent:plan"])).satisfied).toBe(true);
  });

  it("agent permission honours *, unbound and explicit names", () => {
    expect(lattice.agentPermission("agent:plan", "alice")).toBe(true);
    expect(lattice.agentPermission("agent:plan", "mallory")).toBe(false);
    expect(lattice.agentPermission("agent:plan")).toBe(false);
    expect(lattice.agentPermission("agent:review", "anyone")).toBe(true);
    expect(lattice.agentPermission("agent:review")).toBe(false);
    expect(lattice.agentPermission("webhook:incoming")).toBe(true);
    expect(lattice.agentPermission("webhook:incoming", "alice")).toBe(false);
    expect(lattice.agentPermission("nope", "alice")).toBe(false);
  });

  it("an empty permission list denies everyone", () => {
    const closed = new ActionLattice(config({ x: node({ category: "output", agent_permission: [] }) }));
    expect(closed.agentPermission("x", "alice")).toBe(false);
    expect(closed.agentPermission("x")).toBe(false);
  });
});

describe("ActionLattice.evaluateConstraints", () => {
  function evalOne(constraint: LatticeConstraint, payload: Record<string, unknown>) {
    const lattice = new ActionLattice(config({ x: node({ category: "agent_action", constraints: [constraint] }) }));
    return lattice.evaluateConstraints("x", payload);
  }
  function passes(constraint: LatticeConstraint, payload: Record<string, unknown>): boolean {
    const r = evalOne(constraint, payload);
    return r.failed.length === 0;
  }
  function reason(constraint: LatticeConstraint, payload: Record<string, unknown>): string {
    return evalOne(constraint, payload).failed[0]?.reason ?? "";
  }

  it("returns nothing for an unknown action", () => {
    expect(new ActionLattice(baseConfig()).evaluateConstraints("nope", {})).toEqual({ passed: [], failed: [] });
  });

  it("required_field without condition", () => {
    const c: LatticeConstraint = { type: "required_field", field: "task" };
    expect(evalOne(c, { task: 0 }).passed).toEqual(["task"]);
    expect(reason(c, {})).toBe("Required field 'task' is missing");
  });

  it("required_field with condition true and non_empty", () => {
    const t: LatticeConstraint = { type: "required_field", field: "ok", condition: "true" };
    expect(passes(t, { ok: true })).toBe(true);
    expect(reason(t, { ok: "true" })).toMatch(/must be true/);
    const ne: LatticeConstraint = { type: "required_field", field: "list", condition: "non_empty" };
    expect(passes(ne, { list: [1] })).toBe(true);
    expect(passes(ne, { list: "x" })).toBe(true);
    expect(passes(ne, { list: [] })).toBe(false);
    expect(passes(ne, { list: {} })).toBe(false);
    expect(passes(ne, { list: "" })).toBe(false);
    expect(passes(ne, { list: null })).toBe(false);
  });

  it("required_field with an unknown condition fails closed", () => {
    expect(reason({ type: "required_field", field: "a", condition: "weird" }, { a: 1 })).toMatch(/fail closed/);
  });

  it("threshold comparison operators accept numbers and numeric strings", () => {
    expect(passes({ type: "threshold", field: "n", condition: "> 5" }, { n: 6 })).toBe(true);
    expect(passes({ type: "threshold", field: "n", condition: "> 5" }, { n: 5 })).toBe(false);
    expect(passes({ type: "threshold", field: "n", condition: ">= 5" }, { n: "5" })).toBe(true);
    expect(passes({ type: "threshold", field: "n", condition: "< 5" }, { n: 4.5 })).toBe(true);
    expect(passes({ type: "threshold", field: "n", condition: "< 5" }, { n: 5 })).toBe(false);
    expect(passes({ type: "threshold", field: "n", condition: "<= 5" }, { n: 5 })).toBe(true);
    expect(reason({ type: "threshold", field: "n", condition: "<= 5" }, { n: 6 })).toBe("n (6) is not <= 5");
    expect(reason({ type: "threshold", field: "n", condition: "> 1" }, { n: "abc" })).toMatch(/not numeric/);
  });

  it("threshold exists, defined and true", () => {
    expect(passes({ type: "threshold", field: "n", condition: "exists" }, { n: null })).toBe(true);
    expect(passes({ type: "threshold", field: "n", condition: "defined" }, { n: 0 })).toBe(true);
    expect(reason({ type: "threshold", field: "n", condition: "defined" }, { n: null })).toBe("Field 'n' is null");
    expect(passes({ type: "threshold", field: "n", condition: "true" }, { n: "true" })).toBe(true);
    expect(passes({ type: "threshold", field: "n", condition: "true" }, { n: false })).toBe(false);
    expect(reason({ type: "threshold", field: "n", condition: "> 1" }, {})).toBe("Field 'n' is undefined");
  });

  it("threshold within_range reads bounds from the payload", () => {
    const c: LatticeConstraint = { type: "threshold", field: "v", condition: "within_range" };
    expect(passes(c, { v: 5, min: 1, max: 10 })).toBe(true);
    expect(passes(c, { v: 5, v_min: 6, v_max: 10 })).toBe(false);
    expect(passes(c, { v: "7", range: { min: "1", max: "7" } })).toBe(true);
    expect(reason(c, { v: 5 })).toMatch(/requires min\/max/);
    expect(reason(c, { v: 5, min: 9, max: 1 })).toMatch(/invalid bounds/);
    expect(reason(c, { v: 5, min: "a", max: 9 })).toMatch(/not numeric/);
    expect(reason(c, { v: "x", min: 1, max: 9 })).toMatch(/not numeric/);
  });

  it("threshold between", () => {
    const c: LatticeConstraint = { type: "threshold", field: "v", condition: "between 1.5 and 3" };
    expect(passes(c, { v: 2 })).toBe(true);
    expect(passes(c, { v: 3 })).toBe(true);
    expect(reason(c, { v: 4 })).toBe("v (4) is not between 1.5 and 3");
    expect(reason(c, { v: "z" })).toMatch(/not numeric/);
    expect(reason({ type: "threshold", field: "v", condition: "between x and y" }, { v: 1 })).toMatch(/Unknown threshold/);
  });

  it("threshold with unknown condition or missing parts fails closed", () => {
    expect(reason({ type: "threshold", field: "v", condition: "~ 3" }, { v: 1 })).toMatch(/fail closed/);
    expect(reason({ type: "threshold", field: "v" }, { v: 1 })).toMatch(/missing field or condition/);
  });

  it("authorization refuses client trust fields and missing values", () => {
    expect(reason({ type: "authorization", field: "trust_tier", condition: ">= 1" }, { trust_tier: 9 })).toBe(
      "client trust fields are refused",
    );
    expect(reason({ type: "authorization", field: "tier", condition: ">= 1" }, {})).toMatch(/is missing/);
    expect(reason({ type: "authorization", field: "tier" }, { tier: 1 })).toMatch(/missing field or condition/);
  });

  it("authorization numeric floor", () => {
    const c: LatticeConstraint = { type: "authorization", field: "tier", condition: ">= 3" };
    expect(passes(c, { tier: 3 })).toBe(true);
    expect(passes(c, { tier: "4" })).toBe(true);
    expect(reason(c, { tier: 2 })).toBe("Trust tier 2 below required 3");
    expect(reason(c, { tier: "high" })).toMatch(/Cannot parse/);
  });

  it("authorization matches_registered requires a server registered set", () => {
    const c: LatticeConstraint = { type: "authorization", field: "who", condition: "matches_registered" };
    expect(passes(c, { who: "alice", registered_agents: ["alice"] })).toBe(true);
    expect(passes(c, { who: "alice", registered: { alice: true } })).toBe(true);
    expect(passes(c, { who: "carol", registered_agent_ids: ["alice"] })).toBe(false);
    expect(reason(c, { who: "alice" })).toMatch(/fail-closed/);
    expect(passes(c, { who: 5, registered_agents: ["5"] })).toBe(false);
    expect(passes(c, { who: "", registered_agents: [""] })).toBe(false);
  });

  it("authorization with unknown condition fails closed", () => {
    expect(reason({ type: "authorization", field: "who", condition: "is_admin" }, { who: "a" })).toMatch(/fail closed/);
  });

  it("custom constraints are deferred and unknown types fail closed", () => {
    expect(evalOne({ type: "custom" }, {})).toEqual({ passed: [], failed: [] });
    // Config arrives as untrusted parsed data, so an unknown type can reach the evaluator.
    const fromConfig: LatticeConstraint[] = JSON.parse('[{"type":"bogus"}]');
    const lattice = new ActionLattice(config({ x: node({ category: "output", constraints: fromConfig }) }));
    expect(lattice.evaluateConstraints("x", {}).failed[0]?.reason).toMatch(/Unknown constraint type 'bogus'/);
  });
});

describe("LatticeFilter.filter", () => {
  let filter: LatticeFilter;
  beforeEach(() => {
    filter = new LatticeFilter(new ActionLattice(baseConfig()));
  });

  it("rejects an unknown action path", () => {
    const r = filter.filter(event("nope"));
    expect(r.passed).toBe(false);
    expect(r.matched_node).toBeNull();
    expect(r.constraints_failed[0]?.reason).toBe("Unknown action path: nope");
    expect(r.duration_us).toBeGreaterThanOrEqual(0);
  });

  it("denies an agent without permission before checking order", () => {
    filter.seedStartupSequence();
    const r = filter.filter(event("agent:plan", { agent_id: "mallory", payload: { task: "x" } }));
    expect(r.passed).toBe(false);
    expect(r.agent_permission).toBe(false);
    expect(r.constraints_failed[0]?.reason).toMatch(/agent 'mallory' may not 'agent:plan'/);
  });

  it("enforces the partial order and unlocks after the parent passes", () => {
    const early = filter.filter(event("agent:plan", { agent_id: "alice", payload: { task: "x" } }));
    expect(early.passed).toBe(false);
    expect(early.partial_order_satisfied).toBe(false);
    expect(early.missing_parents).toEqual(["system:ready"]);

    filter.seedStartupSequence();
    const plan = filter.filter(event("agent:plan", { agent_id: "alice", payload: { task: "x" } }));
    expect(plan.passed).toBe(true);
    expect(plan.next_actions).toEqual(["agent:execute"]);
    expect(plan.constraints_passed).toEqual(["task"]);
    expect(filter.getSatisfiedActions()).toContain("agt|alice|agent:plan");

    const execAlice = filter.filter(event("agent:execute", { agent_id: "alice", payload: { amount: 10 } }));
    expect(execAlice.passed).toBe(true);
    const execBob = filter.filter(event("agent:execute", { agent_id: "bob", payload: { amount: 10 } }));
    expect(execBob.passed).toBe(false);
    expect(execBob.missing_parents).toEqual(["agent:plan"]);
  });

  it("external events satisfy their children globally", () => {
    filter.filter(event("webhook:incoming"));
    expect(filter.filter(event("agent:triage", { agent_id: "zed" })).passed).toBe(true);
  });

  it("autoMarkSatisfied=false leaves the satisfied set untouched", () => {
    filter.seedStartupSequence();
    const before = filter.getSatisfiedActions().length;
    expect(filter.filter(event("agent:plan", { agent_id: "alice", payload: { task: 1 } }), false).passed).toBe(true);
    expect(filter.getSatisfiedActions().length).toBe(before);
  });

  it("reports failed constraints", () => {
    filter.seedStartupSequence();
    const r = filter.filter(event("agent:plan", { agent_id: "alice" }));
    expect(r.passed).toBe(false);
    expect(r.partial_order_satisfied).toBe(true);
    expect(r.constraints_failed[0]?.reason).toBe("Required field 'task' is missing");
  });

  it("replaces client registered lists with the server interest registry", () => {
    const spoof = event("agent:delegate", {
      agent_id: "alice",
      payload: { delegate_to: "bob", registered_agents: ["bob"], registered: { bob: 1 } },
    });
    expect(filter.filter(spoof).passed).toBe(false);
    filter.registerInterest({ agent_id: "bob", watch_paths: [], notify: "log" });
    expect(filter.filter(spoof).passed).toBe(true);
    filter.deregisterInterest("bob");
    expect(filter.filter(spoof).passed).toBe(false);
  });

  it("matches agent interests by glob", () => {
    filter.seedStartupSequence();
    filter.registerInterest({ agent_id: "w1", watch_paths: ["agent:*"], notify: "wake" });
    filter.registerInterest({ agent_id: "w2", watch_paths: ["system:**"], notify: "queue" });
    const r = filter.filter(event("agent:plan", { agent_id: "alice", payload: { task: 1 } }));
    expect(r.matched_interests.map((i) => i.agent_id)).toEqual(["w1"]);
  });

  it("pathMatchesGlob treats * as one segment and ** as many", () => {
    expect(filter.pathMatchesGlob("agent:*", "agent:plan")).toBe(true);
    expect(filter.pathMatchesGlob("agent:*", "agent:plan:sub")).toBe(false);
    expect(filter.pathMatchesGlob("agent:**", "agent:plan:sub")).toBe(true);
    expect(filter.pathMatchesGlob("a.b", "aXb")).toBe(false);
    expect(filter.pathMatchesGlob("exact:path", "exact:path")).toBe(true);
  });

  it("custom constraints fail closed on the sync path", () => {
    const noHook = filter.filter(event("agent:review", { agent_id: "a" }));
    expect(noHook.passed).toBe(false);
    expect(noHook.constraints_failed.at(-1)?.reason).toBe("lattice.hook is not configured for custom constraints");

    const unregistered = new LatticeFilter(new ActionLattice(baseConfig()), new HookRegistry(), "ghost");
    expect(unregistered.filter(event("agent:review", { agent_id: "a" })).constraints_failed.at(-1)?.reason).toBe(
      "Validation hook 'ghost' is not registered",
    );

    const reg = new HookRegistry();
    reg.register(fakeHook("ok", () => ({ passed: true, score: 1, confidence: 1 })));
    const registered = new LatticeFilter(new ActionLattice(baseConfig()), reg, "ok");
    const r = registered.filter(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(false);
    expect(r.constraints_failed.at(-1)?.reason).toMatch(/filterAsync/);
  });

  it("filterBatch filters each event in order", () => {
    const results = filter.filterBatch([event("webhook:incoming"), event("agent:triage", { agent_id: "z" }), event("nope")]);
    expect(results.map((r) => r.passed)).toEqual([true, true, false]);
  });

  it("exposes lattice information for policy feeds", () => {
    expect(filter.getAllActionPaths()).toContain("agent:plan");
    expect(filter.getParents("agent:execute")).toEqual(["agent:plan"]);
    expect(filter.isRootAction("webhook:incoming")).toBe(true);
    expect(filter.getHookRegistry()).toBeInstanceOf(HookRegistry);
  });

  it("markSatisfied stores system actions globally and agent actions per agent", () => {
    filter.markSatisfied("agent:plan", "system");
    filter.markSatisfied("agent:plan");
    filter.markSatisfied("system_custom");
    expect(new Set(filter.getSatisfiedActions())).toEqual(
      new Set(["agent:plan", "agt|unbound|agent:plan", "system_custom"]),
    );
  });
});

describe("LatticeFilter.filterAsync", () => {
  function make(hook: ValidationHook | null, hookName?: string): LatticeFilter {
    const reg = new HookRegistry();
    if (hook) reg.register(hook);
    return new LatticeFilter(new ActionLattice(baseConfig()), reg, hookName);
  }

  it("runs the registered hook and records its score", async () => {
    const hook = fakeHook("checker", () => ({ passed: true, score: 0.9, confidence: 1 }));
    const f = make(hook, "checker");
    const r = await f.filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(true);
    expect(r.constraints_passed).toContain("hook:checker:0.90");
    expect(hook.calls).toHaveLength(1);
    expect(f.getSatisfiedActions()).toContain("agt|a|agent:review");
  });

  it("resolves the mle alias to mle-validator", async () => {
    const hook = fakeHook("mle-validator", () => ({ passed: true, score: 1, confidence: 1 }));
    const r = await make(hook, "mle").filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(true);
    expect(r.constraints_passed).toContain("hook:mle-validator:1.00");
  });

  it("does not mark satisfied when autoMarkSatisfied is false", async () => {
    const f = make(fakeHook("checker", () => ({ passed: true, score: 1, confidence: 1 })), "checker");
    await f.filterAsync(event("agent:review", { agent_id: "a" }), false);
    expect(f.getSatisfiedActions()).toEqual([]);
  });

  it("a rejecting hook fails the event with its details", async () => {
    const f = make(
      fakeHook("checker", () => ({ passed: false, score: 0.2, confidence: 1, details: "too risky" })),
      "checker",
    );
    const r = await f.filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(false);
    expect(r.constraints_failed.at(-1)?.reason).toBe("too risky");
    expect(f.getSatisfiedActions()).toEqual([]);
  });

  it("a rejecting hook without details reports its score", async () => {
    const f = make(fakeHook("checker", () => ({ passed: false, score: 0.25, confidence: 1 })), "checker");
    const r = await f.filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.constraints_failed.at(-1)?.reason).toBe("Hook 'checker' score 0.25 below threshold");
  });

  it("a throwing hook fails closed with the error message", async () => {
    const f = make(fakeHook("checker", () => new Error("engine down")), "checker");
    const r = await f.filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(false);
    expect(r.constraints_failed.at(-1)?.reason).toBe("engine down");
  });

  it("fails closed when the configured hook is missing", async () => {
    const r = await make(null, "ghost").filterAsync(event("agent:review", { agent_id: "a" }));
    expect(r.passed).toBe(false);
    expect(r.matched_node?.id).toBe("agent:review");
    expect(r.constraints_failed[0]?.reason).toBe("Validation hook 'ghost' is not registered");
    const none = await make(null).filterAsync(event("agent:review", { agent_id: "a" }));
    expect(none.constraints_failed[0]?.reason).toBe("lattice.hook is not configured for custom constraints");
  });

  it("does not call the hook when built-in checks fail", async () => {
    const hook = fakeHook("checker", () => ({ passed: true, score: 1, confidence: 1 }));
    const r = await make(hook, "checker").filterAsync(event("agent:review"));
    expect(r.passed).toBe(false);
    expect(r.agent_permission).toBe(false);
    expect(hook.calls).toHaveLength(0);
  });

  it("events without custom constraints behave like filter and mark satisfied", async () => {
    const f = make(null);
    const r = await f.filterAsync(event("webhook:incoming"));
    expect(r.passed).toBe(true);
    expect(f.getSatisfiedActions()).toEqual(["webhook:incoming"]);
  });
});
