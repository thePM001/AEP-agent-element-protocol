import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import {
  ActionLattice,
  LatticeFilter,
  HookRegistry,
  governanceAppliesToCategory,
} from "../../src/protocol/action-lattice.js";
import { registerBuiltinHooks, resolveHookName } from "../../src/lattice/hook-loader.js";

const REPO = join(import.meta.dirname, "../../../../..");
const LATTICE_YAML = join(REPO, "AEP-Components/dynAEP/registries/aep-lattice.yaml");

describe("Action Lattice governance", () => {
  it("events_only applies to external/system categories only", () => {
    expect(governanceAppliesToCategory("events_only", "external_event")).toBe(true);
    expect(governanceAppliesToCategory("events_only", "system_event")).toBe(true);
    expect(governanceAppliesToCategory("events_only", "agent_action")).toBe(false);
    expect(governanceAppliesToCategory("events_only", "output")).toBe(false);
  });

  it("resolves mle hook alias", () => {
    expect(resolveHookName("mle")).toBe("mle-validator");
  });
});

describe("LatticeFilter custom hooks", () => {
  let filter: LatticeFilter;

  beforeEach(() => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const registry = new HookRegistry();
    registerBuiltinHooks(registry);
    filter = new LatticeFilter(lattice, registry, "mle");
    filter.seedStartupSequence();
    filter.markSatisfied("agent:propose_action");
  });

  it("sync filter fails closed on custom constraints", () => {
    const result = filter.filter({
      source: "test",
      action_path: "action:validate",
      payload: {},
      bridge_timestamp: Date.now(),
      agent_id: "agent-a",
      trust_tier: 3,
    });
    expect(result.passed).toBe(false);
    expect(result.constraints_failed.some((c) => c.reason.includes("filterAsync"))).toBe(true);
  });

  it("filterAsync dispatches MLE hook for action:validate", async () => {
    const result = await filter.filterAsync({
      source: "test",
      action_path: "action:validate",
      payload: {},
      bridge_timestamp: Date.now(),
      agent_id: "agent-a",
      trust_tier: 3,
    });
    const hookEvidence =
      result.constraints_passed.some((p) => p.startsWith("hook:mle-validator:")) ||
      result.constraints_failed.some((c) =>
        String(c.constraint?.description ?? "").includes("mle-validator") ||
        String(c.reason ?? "").includes("MLE hook"),
      );
    expect(hookEvidence).toBe(true);
  });

  it("filterAsync passes custom constraints with noop hook", async () => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const registry = new HookRegistry();
    registerBuiltinHooks(registry);
    const noopFilter = new LatticeFilter(lattice, registry, "noop");
    noopFilter.seedStartupSequence();
    noopFilter.markSatisfied("agent:propose_action");
    const result = await noopFilter.filterAsync({
      source: "test",
      action_path: "action:validate",
      payload: {},
      bridge_timestamp: Date.now(),
      agent_id: "agent-b",
      trust_tier: 3,
    });
    expect(result.passed).toBe(true);
    expect(result.constraints_passed.some((p) => p.startsWith("hook:noop:"))).toBe(true);
  });

  it("within_range rejects values outside payload bounds", () => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const check = lattice.evaluateConstraints("sensor:reading", {
      value: 999,
      min: 0,
      max: 100,
    });
    expect(check.failed.length).toBeGreaterThan(0);
  });
});