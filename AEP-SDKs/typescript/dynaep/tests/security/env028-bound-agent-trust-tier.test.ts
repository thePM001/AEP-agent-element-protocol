/**
 * AEP28-ENV-028: bound agent_id still ignores client trust_tier.
 */
import { describe, it, expect } from "vitest";
import {
  ActionLattice,
  LatticeFilter,
  ignoreClientTrustTier,
} from "../../src/protocol/action-lattice.js";

function miniLattice() {
  const lattice = new ActionLattice({
    aep_version: "2.8",
    dynaep_version: "2.8",
    lattice_revision: 1,
    actions: {
      "test:elevated": {
        label: "elevated",
        parents: [],
        children: [],
        constraints: [],
        agent_may: ["AG-BOUND"],
        category: "agent_action",
      },
      "test:bound": {
        label: "bound",
        parents: [],
        children: [],
        constraints: [],
        agent_may: ["AG-TEST"],
        category: "agent_action",
      },
      "test:tier-auth": {
        label: "tier-auth",
        parents: [],
        children: [],
        constraints: [
          {
            type: "authorization",
            field: "trust_tier",
            condition: ">= 4",
            description: "client trust_tier is not a floor",
          },
        ],
        agent_may: ["AG-TEST"],
        category: "agent_action",
      },
    },
  });
  return lattice;
}

describe("AEP28-ENV-028 bound agent_id client trust_tier", () => {
  it("drops the client claim", () => {
    expect(ignoreClientTrustTier(9)).toBeUndefined();
  });

  it("Denies ungranted agent_id plus inflated trust_tier", () => {
    const filter = new LatticeFilter(miniLattice());
    const result = filter.filter({
      source: "test",
      action_path: "test:elevated",
      payload: { trust_tier: 9 },
      bridge_timestamp: Date.now(),
      agent_id: "AG-LOW",
      trust_tier: 9,
    });
    expect(result.passed).toBe(false);
    expect(result.agent_may).toBe(false);
  });

  it("Denies trust_tier authorization even when agent_may matches", () => {
    const filter = new LatticeFilter(miniLattice());
    const result = filter.filter({
      source: "test",
      action_path: "test:tier-auth",
      payload: { trust_tier: 9 },
      bridge_timestamp: Date.now(),
      agent_id: "AG-TEST",
      trust_tier: 9,
    });
    expect(result.passed).toBe(false);
    expect(
      result.constraints_failed.some((c) =>
        String(c.reason).includes("client trust_tier is not a floor"),
      ),
    ).toBe(true);
  });

  it("keeps agent_may grant without using client trust_tier as a floor", () => {
    const filter = new LatticeFilter(miniLattice());
    const result = filter.filter({
      source: "test",
      action_path: "test:bound",
      payload: { trust_tier: 9 },
      bridge_timestamp: Date.now(),
      agent_id: "AG-TEST",
      trust_tier: 9,
    });
    expect(result.agent_may).toBe(true);
    expect(result.passed).toBe(true);
  });
});
