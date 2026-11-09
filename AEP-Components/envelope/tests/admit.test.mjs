import { describe, it, expect } from "vitest";
import { admit, planApply, applySnapshot } from "../lib/admit.mjs";

// Every snapshot here sets gap_scan_payload to false so the writing wall never
// asks the Base Node kernel. The writing wall is then open with "gap scan off".

const ALL_WALLS = [
  "channel.dock",
  "covenant.tools",
  "dag.membership",
  "dag.parents",
  "gap.agent_permission",
  "gap.writing",
  "rate.session",
  "rego.forbidden_seq",
  "rego.output_ceiling",
  "rego.restricted",
  "scanner.bundle",
  "scene.membership",
  "time.authority",
];

function lattice(extra = {}) {
  return {
    "agent:propose_action": { parents: [], agent_permission: ["agent-a"] },
    "agent:register": { parents: [], agent_permission: ["*"] },
    "agent:ready": { parents: ["agent:register"], agent_permission: ["*"] },
    "market:trade:execute": { parents: [], agent_permission: ["trader"] },
    "output:notify": { parents: [], agent_permission: ["*"] },
    "public:ping": { parents: [], agent_permission: ["unbound"] },
    ...extra,
  };
}

function snap(over = {}) {
  return { gap_scan_payload: false, lattice_nodes: lattice(), satisfied_actions: [], ...over };
}

function act(over = {}) {
  return { action_path: "agent:propose_action", agent_id: "agent-a", payload: { note: "hello" }, ...over };
}

function closedNames(result) {
  return result.closed_walls.map((w) => w.name);
}

function wall(result, name) {
  return [...result.closed_walls, ...result.open_walls].find((w) => w.name === name);
}

describe("envelope admit: happy path", () => {
  it("allows a listed agent on a known node and reports every wall once, sorted", () => {
    const r = admit(act(), snap());
    expect(r.allow).toBe(true);
    expect(r.closed_walls).toEqual([]);
    const names = r.open_walls.map((w) => w.name);
    expect(names).toEqual(ALL_WALLS);
    expect(wall(r, "gap.writing").reason).toBe("gap scan off");
    expect(wall(r, "dag.membership").reason).toBe("node exists");
    expect(wall(r, "gap.agent_permission").reason).toBe("agent permission listed");
    for (const w of r.open_walls) {
      expect(w.open).toBe(true);
      expect(typeof w.family).toBe("string");
      expect(w.name.startsWith(w.family + ".")).toBe(true);
    }
  });

  it("treats a missing snapshot as an empty lattice", () => {
    const r = admit({ action_path: "x", agent_id: "a" }, undefined);
    expect(r.allow).toBe(false);
    expect(closedNames(r)).toContain("dag.membership");
    expect(closedNames(r)).toContain("gap.agent_permission");
  });
});

describe("dag walls", () => {
  it("closes membership and permission on an empty lattice and leaves rego open", () => {
    const r = admit(act(), snap({ lattice_nodes: {} }));
    expect(r.allow).toBe(false);
    expect(wall(r, "dag.membership").reason).toBe("empty lattice closes membership");
    const perm = r.closed_walls.filter((w) => w.name === "gap.agent_permission");
    expect(perm.length).toBe(2);
    expect(wall(r, "rego.restricted").open).toBe(true);
    expect(wall(r, "rego.restricted").reason).toBe("no lattice");
  });

  it("closes membership for an unknown action path and the restricted rego fragment too", () => {
    const r = admit(act({ action_path: "nope:nothing" }), snap());
    expect(r.allow).toBe(false);
    expect(wall(r, "dag.membership").reason).toBe("unknown action_path nope:nothing");
    expect(wall(r, "dag.parents").open).toBe(true);
    expect(wall(r, "gap.agent_permission").open).toBe(true);
    expect(wall(r, "rego.restricted").reason).toBe("path not in lattice");
    expect(closedNames(r).sort()).toEqual(["dag.membership", "rego.restricted"]);
  });

  it("closes parents when a parent action is not satisfied and opens when it is", () => {
    const closed = admit(act({ action_path: "agent:ready" }), snap());
    expect(closedNames(closed)).toEqual(["dag.parents"]);
    expect(wall(closed, "dag.parents").reason).toBe("missing parents agent:register");

    const open = admit(act({ action_path: "agent:ready" }), snap({ satisfied_actions: ["agent:register"] }));
    expect(open.allow).toBe(true);
    expect(wall(open, "dag.parents").reason).toBe("parents satisfied");
  });
});

describe("gap.agent_permission wall", () => {
  it("denies an agent that is not listed", () => {
    const r = admit(act({ agent_id: "agent-b" }), snap());
    expect(r.allow).toBe(false);
    expect(closedNames(r)).toEqual(["gap.agent_permission"]);
    expect(wall(r, "gap.agent_permission").reason).toBe("this agent does not have permission for this action");
  });

  it("denies when the node lists no permission at all", () => {
    const r = admit(act({ action_path: "x:y" }), snap({ lattice_nodes: lattice({ "x:y": { parents: [] } }) }));
    expect(closedNames(r)).toEqual(["gap.agent_permission"]);
  });

  it("star needs a bound agent id", () => {
    expect(admit(act({ action_path: "agent:register", agent_id: "anyone" }), snap()).allow).toBe(true);
    const unbound = admit(act({ action_path: "agent:register", agent_id: "" }), snap());
    expect(closedNames(unbound)).toEqual(["gap.agent_permission"]);
  });

  it("unbound only admits an action without an agent id", () => {
    expect(admit(act({ action_path: "public:ping", agent_id: undefined }), snap()).allow).toBe(true);
    const bound = admit(act({ action_path: "public:ping", agent_id: "agent-a" }), snap());
    expect(closedNames(bound)).toEqual(["gap.agent_permission"]);
  });
});

describe("scene, time, dock, rate and scanner walls", () => {
  it("scene membership opens without bound scenes, closes on an unproven scene", () => {
    expect(wall(admit(act({ scene_id: "s1" }), snap()), "scene.membership").reason).toBe("no scene bound");
    const proven = admit(act({ scene_id: "s1" }), snap({ proven_scene_ids: ["s1"] }));
    expect(wall(proven, "scene.membership").reason).toBe("scene proven");
    const denied = admit(act({ scene_id: "s2" }), snap({ proven_scene_ids: ["s1"] }));
    expect(closedNames(denied)).toEqual(["scene.membership"]);
    expect(wall(denied, "scene.membership").reason).toBe("scene s2 not proven");
  });

  it("time authority checks drift, age and future stamps", () => {
    expect(wall(admit(act(), snap()), "time.authority").reason).toBe("no timestamps");
    const ok = admit(act({ agent_ts_ms: 1000 }), snap({ bridge_ts_ms: 1020 }));
    expect(wall(ok, "time.authority").reason).toBe("time ok");
    const drift = admit(act({ agent_ts_ms: 1000 }), snap({ bridge_ts_ms: 1100 }));
    expect(wall(drift, "time.authority").reason).toBe("drift exceeds");
    expect(drift.allow).toBe(false);
    const stale = admit(
      act({ agent_ts_ms: 1000 }),
      snap({ bridge_ts_ms: 7000, max_drift_ms: 100000, max_age_ms: 5000 }),
    );
    expect(wall(stale, "time.authority").reason).toBe("stale event");
    const future = admit(act({ agent_ts_ms: 1010 }), snap({ bridge_ts_ms: 1000 }));
    expect(wall(future, "time.authority").reason).toBe("future stamp");
  });

  it("channel dock opens when unbound or allowed and closes when denied", () => {
    expect(wall(admit(act({ dest_dock: "d1" }), snap()), "channel.dock").reason).toBe("no dock bound");
    expect(wall(admit(act({ dest_dock: "d1" }), snap({ allowed_docks: ["d1"] })), "channel.dock").reason).toBe("dock allowed");
    const denied = admit(act({ dest_dock: "d2" }), snap({ allowed_docks: ["d1"] }));
    expect(closedNames(denied)).toEqual(["channel.dock"]);
  });

  it("session rate closes at the ceiling, default 200", () => {
    expect(admit(act(), snap({ actions_last_minute: 199 })).allow).toBe(true);
    const at = admit(act(), snap({ actions_last_minute: 200 }));
    expect(closedNames(at)).toEqual(["rate.session"]);
    const custom = admit(act(), snap({ actions_last_minute: 3, max_actions_per_minute: 3 }));
    expect(wall(custom, "rate.session").reason).toBe("would exceed session rate");
  });

  it("scanner bundle matches needles case insensitively in the payload", () => {
    const clean = admit(act(), snap({ scanner_needles: ["secret"] }));
    expect(wall(clean, "scanner.bundle").reason).toBe("clean");
    const hit = admit(act({ payload: { body: "the SECRET word" } }), snap({ scanner_needles: ["Secret"] }));
    expect(closedNames(hit)).toEqual(["scanner.bundle"]);
    expect(wall(hit, "scanner.bundle").reason).toBe("needle Secret");
  });
});

describe("rego walls", () => {
  it("critical paths need an explicit or star permission for a bound agent", () => {
    const trader = admit(act({ action_path: "market:trade:execute", agent_id: "trader" }), snap());
    expect(trader.allow).toBe(true);
    const other = admit(act({ action_path: "market:trade:execute", agent_id: "intruder" }), snap());
    expect(closedNames(other).sort()).toEqual(["gap.agent_permission", "rego.restricted"]);
  });

  it("event rate closes the restricted fragment", () => {
    const r = admit(act(), snap({ event_rate: 200 }));
    expect(closedNames(r)).toEqual(["rego.restricted"]);
    expect(wall(r, "rego.restricted").reason).toBe("event rate closed");
    expect(admit(act(), snap({ event_rate: 5, event_rate_max: 10 })).allow).toBe(true);
  });

  it("forbidden sequences close after the parent action", () => {
    const r = admit(act(), snap({ satisfied_actions: ["system:shutdown"] }));
    expect(closedNames(r)).toEqual(["rego.forbidden_seq"]);
    expect(wall(r, "rego.forbidden_seq").reason).toBe("system:shutdown then agent:propose_action");
    const fine = admit(act(), snap({ satisfied_actions: ["agent:register"] }));
    expect(wall(fine, "rego.forbidden_seq").reason).toBe("no forbidden sequence");
  });

  it("output ceiling closes above three simultaneous outputs on output paths only", () => {
    const three = admit(act({ action_path: "output:notify" }), snap({ simultaneous_outputs: 3 }));
    expect(three.allow).toBe(true);
    const four = admit(act({ action_path: "output:notify" }), snap({ simultaneous_outputs: 4 }));
    expect(closedNames(four)).toEqual(["rego.output_ceiling"]);
    const nonOutput = admit(act(), snap({ simultaneous_outputs: 9 }));
    expect(wall(nonOutput, "rego.output_ceiling").open).toBe(true);
  });
});

describe("covenant.tools wall", () => {
  it("opens with no tool and no forbid list", () => {
    expect(wall(admit(act(), snap()), "covenant.tools").reason).toBe("no tool bound");
  });

  it("closes a forbidden tool", () => {
    const r = admit(act({ tool: "shell" }), snap({ forbid_tools: ["shell"] }));
    expect(closedNames(r)).toEqual(["covenant.tools"]);
    expect(wall(r, "covenant.tools").reason).toBe("tool forbidden");
  });

  it("closes a tool outside the permit list and opens one inside it", () => {
    const r = admit(act({ tool: "net" }), snap({ permit_tools: ["read"] }));
    expect(wall(r, "covenant.tools").reason).toBe("tool not permitted");
    const ok = admit(act({ tool: "read" }), snap({ permit_tools: ["read"] }));
    expect(wall(ok, "covenant.tools").reason).toBe("covenant open");
  });

  it("opens when a forbid list exists but the action binds no tool", () => {
    const r = admit(act(), snap({ forbid_tools: ["shell"] }));
    expect(wall(r, "covenant.tools").reason).toBe("covenant open");
  });
});

describe("collect-all", () => {
  it("reports every closed wall at once instead of stopping at the first", () => {
    const r = admit(
      act({ agent_id: "agent-b", dest_dock: "d2", tool: "shell" }),
      snap({ allowed_docks: ["d1"], forbid_tools: ["shell"], actions_last_minute: 500 }),
    );
    expect(r.allow).toBe(false);
    expect(closedNames(r)).toEqual(["channel.dock", "covenant.tools", "gap.agent_permission", "rate.session"]);
    expect(r.closed_walls.length + r.open_walls.length).toBe(ALL_WALLS.length);
  });
});

describe("planApply and applySnapshot", () => {
  it("increments the rate counters only on allow", () => {
    const s = snap({ actions_last_minute: 4, event_rate: 1 });
    const result = admit(act(), s);
    const plan = planApply(result, s);
    expect(plan).toEqual({ increment_rate: true, ledger_allow: true });
    applySnapshot(s, plan);
    expect(s.actions_last_minute).toBe(5);
    expect(s.event_rate).toBe(2);
  });

  it("leaves the snapshot untouched on deny", () => {
    const s = snap({ actions_last_minute: 4 });
    const result = admit(act({ agent_id: "agent-b" }), s);
    const plan = planApply(result, s);
    expect(plan).toEqual({ increment_rate: false, ledger_allow: false });
    applySnapshot(s, plan);
    expect(s.actions_last_minute).toBe(4);
    expect(s.event_rate).toBeUndefined();
  });

  it("starts missing counters at zero", () => {
    const s = {};
    applySnapshot(s, { increment_rate: true, ledger_allow: true });
    expect(s).toEqual({ actions_last_minute: 1, event_rate: 1 });
  });
});
