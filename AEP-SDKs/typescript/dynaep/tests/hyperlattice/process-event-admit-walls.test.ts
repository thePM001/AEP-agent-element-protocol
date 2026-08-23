/**
 * AEP28-ENV-014: processEvent must not skip Admit via lab LatticeFilter.
 * @PAD: aep-process-event-admit-walls-ts-v1
 * @GCDE: gaplune-decode hmac-sha256:b513f93ada33543c733e64905c83d2508162a5bb843b7676452e4454f17d33d5
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

function bridgeConfig(): DynAEPBridgeConfig {
  return {
    validation: { mode: "strict", jit_on_every_delta: true },
    runtime_reflection: { enabled: false, method: "polling", debounce_ms: 0, broadcast_to_agent: false },
    approval_policy: {},
    conflict_resolution: { mode: "last_write_wins" },
    id_minting: { enabled: true, counters_persist: false },
    lattice: {
      inline: {
        aep_version: "2.8.0",
        dynaep_version: "1.0.0",
        lattice_revision: 1,
        actions: {
          "test:env014": {
            label: "env014",
            category: "external_event",
            parents: [],
            children: [],
            constraints: [],
            trust_floor: 1,
          },
        },
      },
      governance: "filter_all",
      hook: "noop",
    },
    hyperlattice: { gap_writing_lint: false, mode: "strict" },
  };
}

describe("AEP28-ENV-014 processEvent lab flag", function () {
  it("does not call filterAsync when HyperlatticeFilter is missing and lab env is on", async function () {
    const prev = process.env.AEP_LAB_LATTICE_FILTER;
    process.env.AEP_LAB_LATTICE_FILTER = "1";
    try {
      const bridge = new DynAEPBridge(minimalConfig(), bridgeConfig());
      const box = bridge as unknown as { hyperlatticeFilter: unknown; latticeFilter: LatticeFilter | null };
      const filter = box.latticeFilter;
      expect(Boolean(filter)).toBe(true);
      if (filter == null) {
        throw new Error("latticeFilter missing");
      }
      let filterAsyncCalls = 0;
      const orig = filter.filterAsync.bind(filter);
      filter.filterAsync = async function (event, autoMark) {
        filterAsyncCalls += 1;
        return orig(event, autoMark);
      };
      box.hyperlatticeFilter = null;
      const out = await bridge.processEvent({
        type: "CUSTOM",
        dynaep_type: "TEST",
        action_path: "test:env014",
        payload: {},
        timestamp: Date.now(),
      } as never);
      const rec = out as { error?: string };
      expect(String(rec.error || "")).toMatch(/live-entry|Admit collect-all/);
      expect(filterAsyncCalls).toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.AEP_LAB_LATTICE_FILTER;
      } else {
        process.env.AEP_LAB_LATTICE_FILTER = prev;
      }
    }
  });
});
