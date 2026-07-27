/**
 * TM-15: lattice init must fail closed under governance.
 */
import { describe, it, expect } from "vitest";
import { DynAEPBridge, type DynAEPBridgeConfig } from "../../src/bridge.js";
import type { AEPConfig } from "@aep/core";

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

describe("TM-15 lattice init fail-closed", () => {
  it("throws when lattice registry cannot load under governance", () => {
    expect(() => new DynAEPBridge(minimalConfig(), baseBridgeConfig())).toThrow(/lattice init failed/i);
  });

  it("does not throw governance-init error when governance is disabled", () => {
    const cfg = baseBridgeConfig({
      lattice: {
        registry: "/nonexistent/aep-lattice-does-not-exist.yaml",
        governance: "disabled",
      },
    });
    try {
      new DynAEPBridge(minimalConfig(), cfg);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toMatch(/lattice init failed under governance/i);
    }
  });
});
