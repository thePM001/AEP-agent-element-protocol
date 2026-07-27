/**
 * TM-19: without agent_id, client trust_tier must not raise lattice floors.
 */
import { describe, it, expect } from "vitest";
import { ActionLattice, LatticeFilter } from "../../src/protocol/action-lattice.js";

function miniLattice() {
  const lattice = new ActionLattice({
    actions: {
      "test:elevated": {
        parents: [],
        children: [],
        trust_floor: 5,
        category: "agent_action",
      },
      "test:bound": {
        parents: [],
        children: [],
        trust_floor: 3,
        category: "agent_action",
      },
    },
  } as any);
  return lattice;
}

describe("TM-19 trust_tier clamp", () => {
  it("rejects elevated trust_tier when agent_id is missing", () => {
    const filter = new LatticeFilter(miniLattice());
    const result = filter.filter({
      source: "test",
      action_path: "test:elevated",
      payload: {},
      bridge_timestamp: Date.now(),
      trust_tier: 9,
    } as any);
    expect(result.trust_sufficient).toBe(false);
  });

  it("accepts trust_tier when agent_id is bound (unit path)", () => {
    const filter = new LatticeFilter(miniLattice());
    const ok = filter.filter({
      source: "test",
      action_path: "test:bound",
      payload: {},
      bridge_timestamp: Date.now(),
      agent_id: "AG-TEST",
      trust_tier: 3,
    } as any);
    expect(ok.trust_sufficient).toBe(true);
  });
});
