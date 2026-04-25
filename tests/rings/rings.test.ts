import { RingManager } from "../../src/rings/manager.js";
import type { RingConfig } from "../../src/rings/types.js";

function makeConfig(overrides?: Partial<RingConfig>): RingConfig {
  return {
    default: 2,
    promotion: {
      to_ring_1: { min_trust_tier: "trusted", require_approval: false },
      to_ring_0: { min_trust_tier: "privileged", require_approval: true },
    },
    ...overrides,
  };
}

describe("RingManager", () => {
  let rm: RingManager;

  beforeEach(() => {
    rm = new RingManager(makeConfig());
  });

  it("starts at default ring", () => {
    expect(rm.getRing()).toBe(2);
  });

  it("ring 2 capabilities are correct", () => {
    const caps = rm.getCapabilities();
    expect(caps.canRead).toBe(true);
    expect(caps.canCreate).toBe(true);
    expect(caps.canUpdate).toBe(true);
    expect(caps.canDelete).toBe(false);
    expect(caps.canNetwork).toBe(false);
    expect(caps.canSpawnSubAgents).toBe(false);
    expect(caps.canModifyCore).toBe(false);
  });

  it("ring 0 has full access", () => {
    rm.promote(0);
    const caps = rm.getCapabilities();
    expect(caps.canRead).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canNetwork).toBe(true);
    expect(caps.canSpawnSubAgents).toBe(true);
    expect(caps.canModifyCore).toBe(true);
  });

  it("ring 3 is read-only", () => {
    rm.demote(3);
    const caps = rm.getCapabilities();
    expect(caps.canRead).toBe(true);
    expect(caps.canCreate).toBe(false);
    expect(caps.canUpdate).toBe(false);
    expect(caps.canDelete).toBe(false);
  });

  it("checkCapability blocks delete on ring 2", () => {
    const result = rm.checkCapability("file:delete");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("delete");
  });

  it("checkCapability allows read on ring 3", () => {
    rm.demote(3);
    const result = rm.checkCapability("file:read");
    expect(result.allowed).toBe(true);
  });

  it("checkCapability blocks create on ring 3", () => {
    rm.demote(3);
    const result = rm.checkCapability("file:create");
    expect(result.allowed).toBe(false);
  });

  it("checkCapability blocks network on ring 2", () => {
    const result = rm.checkCapability("network:fetch");
    expect(result.allowed).toBe(false);
  });

  it("checkCapability allows network on ring 1", () => {
    rm.promote(1);
    const result = rm.checkCapability("network:fetch");
    expect(result.allowed).toBe(true);
  });

  it("canPromoteTo checks trust tier", () => {
    const result = rm.canPromoteTo(1, "standard");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Trust tier");

    const result2 = rm.canPromoteTo(1, "trusted");
    expect(result2.allowed).toBe(true);
  });

  it("canPromoteTo ring 0 requires approval by default", () => {
    rm.promote(1);
    const result = rm.canPromoteTo(0, "privileged");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("approval");
  });

  it("cannot promote to higher ring number", () => {
    const result = rm.canPromoteTo(3, "privileged");
    expect(result.allowed).toBe(false);
  });

  it("demoteOnTrustDrop demotes correctly", () => {
    rm.promote(1);
    expect(rm.getRing()).toBe(1);

    const demoted = rm.demoteOnTrustDrop("standard");
    expect(demoted).toBe(true);
    expect(rm.getRing()).toBe(2);
  });

  it("demoteOnTrustDrop no-op when already at correct ring", () => {
    expect(rm.getRing()).toBe(2);
    const demoted = rm.demoteOnTrustDrop("standard");
    expect(demoted).toBe(false);
  });

  it("throws on invalid ring", () => {
    expect(() => rm.promote(-1 as any)).toThrow();
    expect(() => rm.promote(4 as any)).toThrow();
  });
});
