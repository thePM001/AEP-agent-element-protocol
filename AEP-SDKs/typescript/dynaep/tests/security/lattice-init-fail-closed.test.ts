/**
 * AEP28-ENV-031: constructor is not product Admit.
 */
import { describe, it, expect } from "bun:test";
import { DynAEPBridge, type DynAEPBridgeConfig } from "../../src/bridge.js";
import type { AEPConfig } from "@aep/core";
import type { LatticeFilter } from "../../src/protocol/action-lattice.js";

function minimalConfig(): AEPConfig {
  return {
    scene: {
      aep_version: "1.1",
      schema_revision: 1,
      elements: {
        "SH-00001": {
          id: "SH-00001",
          type: "shell",
          label: "Shell",
          z: 0,
          visible: true,
          parent: null,
          spatial_rule: "flex",
          direction: "column",
          layout: { width: "100vw", height: "100vh" },
          children: [],
        },
      },
    },
    registry: {},
    theme: { aep_version: "1.1", schema_revision: 1, theme_name: "t", colours: {}, component_styles: {} },
  } as unknown as AEPConfig;
}

function baseBridgeConfig(over: Partial<DynAEPBridgeConfig> = {}): DynAEPBridgeConfig {
  return {
    validation: { mode: "strict", jit_on_every_delta: true },
    runtime_reflection: { enabled: false, method: "polling", debounce_ms: 0, broadcast_to_agent: false },
    approval_policy: {},
    conflict_resolution: { mode: "last_write_wins" },
    id_minting: { enabled: true, counters_persist: false },
    lattice: {
      registry: "/nonexistent/aep-lattice-does-not-exist.yaml",
      governance: "filter_all",
    },
    ...over,
  };
}

describe("AEP28-ENV-031 constructor is not product Admit", () => {
  it("does not load ActionLattice YAML as product Admit when registry is missing", () => {
    const bridge = new DynAEPBridge(minimalConfig(), baseBridgeConfig());
    const box = bridge as unknown as { latticeFilter: LatticeFilter | null; lattice: unknown };
    expect(box.latticeFilter).toBe(null);
    expect(box.lattice).toBe(null);
  });

  it("does not throw lattice init as product Admit when governance is disabled", () => {
    const cfg = baseBridgeConfig({
      lattice: {
        registry: "/nonexistent/aep-lattice-does-not-exist.yaml",
        governance: "disabled",
      },
    });
    const bridge = new DynAEPBridge(minimalConfig(), cfg);
    const box = bridge as unknown as { latticeFilter: LatticeFilter | null };
    expect(box.latticeFilter).toBe(null);
  });
});
