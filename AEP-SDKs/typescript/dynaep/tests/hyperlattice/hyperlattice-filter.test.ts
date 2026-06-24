import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import {
  ActionLattice,
  LatticeFilter,
  HookRegistry,
} from "../../src/protocol/action-lattice.js";
import { registerBuiltinHooks } from "../../src/lattice/hook-loader.js";
import { HyperlatticeFilter } from "../../src/hyperlattice/HyperlatticeFilter.js";
import { LatticePolicyEvaluator } from "../../src/hyperlattice/LatticePolicyEvaluator.js";

const REPO = join(import.meta.dirname, "../../../../..");
const LATTICE_YAML = join(REPO, "AEP-Components/dynAEP/registries/aep-lattice.yaml");
const LATTICE_POLICY = join(REPO, "AEP-Components/dynAEP/policies/lattice-policy.rego");

describe("HyperlatticeFilter unified crossing", () => {
  let hyper: HyperlatticeFilter;

  beforeEach(() => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const registry = new HookRegistry();
    registerBuiltinHooks(registry);
    const filter = new LatticeFilter(lattice, registry, "noop");
    filter.seedStartupSequence();
    filter.markSatisfied("agent:propose_action");
    hyper = new HyperlatticeFilter(filter, lattice, {
      latticePolicyPath: LATTICE_POLICY,
      gapWritingLint: true,
      mode: "strict",
    });
  });

  it("loads lattice-policy.rego from disk", () => {
    expect(hyper.latticePolicyLoaded()).toBe(true);
  });

  it("rejects em-dash in payload via GAP writing.gap in same crossing", async () => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const n = lattice.get("webhook:incoming")!;
    const crossing = await hyper.filterCrossing(
      {
        source: "test",
        action_path: "webhook:incoming",
        payload: { note: "bad\u2014dash" },
        bridge_timestamp: Date.now(),
        agent_id: "agent-a",
        trust_tier: 3,
      },
      "filter_all",
      n,
    );
    expect(crossing.passed).toBe(false);
    expect(crossing.gap_writing_violations.length).toBeGreaterThan(0);
  });

  it("detects em-dash in every nested payload string (no global-regex lastIndex skip)", async () => {
    const lattice = new ActionLattice();
    lattice.loadFromFile(LATTICE_YAML);
    const n = lattice.get("webhook:incoming")!;
    const crossing = await hyper.filterCrossing(
      {
        source: "test",
        action_path: "webhook:incoming",
        payload: {
          clean: "ok text",
          nested: ["also fine", "second\u2014dash"],
        },
        bridge_timestamp: Date.now(),
        agent_id: "agent-a",
        trust_tier: 3,
      },
      "filter_all",
      n,
    );
    expect(crossing.passed).toBe(false);
    expect(crossing.gap_writing_violations.some((v) => v.rule === "no_em_dashes")).toBe(true);
  });

  it("LatticePolicyEvaluator precompiled denies unknown action_path", () => {
    const ev = new LatticePolicyEvaluator(LATTICE_POLICY);
    const result = ev.evaluate({
      action_path: "bogus:path",
      trust_tier: 3,
      category: "agent_action",
      payload: {},
      agent_id: "a1",
      satisfied_actions: [],
      parents_of: [],
      is_root: true,
      all_actions: ["webhook:incoming"],
    });
    expect(result.deny.some((d) => d.includes("Unknown action path"))).toBe(true);
  });
});