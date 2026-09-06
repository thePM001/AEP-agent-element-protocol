/**
 * TM-19: without agent_id, client trust_tier must not grant who-may-do-what.
 */
import { describe, it, expect } from "vitest";
import { ActionLattice, LatticeFilter } from "../../src/protocol/action-lattice.js";

function miniLattice() {
  const lattice = new ActionLattice({
    actions: {
      "test:elevated": {
        parents: [],
        children: [],
        agent_may: ["AG-BOUND"],
        category: "agent_action",
      },
      "test:bound": {
        parents: [],
        children: [],
        agent_may: ["AG-TEST"],
        category: "agent_action",
      },
    },
  } as any);
  return lattice;
}

describe("TM-19 unbound agent_may", () => {
  it("rejects missing agent_id when grant is bound", () => {
    const filter = new LatticeFilter(miniLattice());
    const result = filter.filter({
      source: "test",
      action_path: "test:elevated",
      payload: {},
      bridge_timestamp: Date.now(),
      trust_tier: 9,
    } as any);
    expect(result.agent_may).toBe(false);
  });

  it("accepts bound agent when grant matches", () => {
    const filter = new LatticeFilter(miniLattice());
    const ok = filter.filter({
      source: "test",
      action_path: "test:bound",
      payload: {},
      bridge_timestamp: Date.now(),
      agent_id: "AG-TEST",
      trust_tier: 3,
    } as any);
    expect(ok.agent_may).toBe(true);
  });
});
