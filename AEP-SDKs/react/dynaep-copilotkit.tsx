// ===========================================================================
// dynAEP CopilotKit bindings (AEP-SDKs/react/dynaep-copilotkit.tsx)
// ===========================================================================

import React, { useMemo, useRef, useCallback, useState } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import type { AEPConfig, AEPElement } from "../typescript/aep-protocol/sdk/sdk-aep-core.js";
import { validateAOT } from "../typescript/aep-protocol/sdk/sdk-aep-core.js";
import { DynAEPBridge } from "../typescript/dynaep/src/bridge.js";
import type { DynAEPBridgeConfig } from "../typescript/dynaep/src/bridge.js";

// ---------------------------------------------------------------------------
// Default bridge config
// ---------------------------------------------------------------------------

const DEFAULT_BRIDGE_CONFIG: DynAEPBridgeConfig = {
  validation: { mode: "strict", jit_on_every_delta: true },
  runtime_reflection: { enabled: false, method: "observer", debounce_ms: 250, broadcast_to_agent: false },
  approval_policy: { structure_mutations: "auto", new_element_creation: "auto" },
  conflict_resolution: { mode: "last_write_wins" },
  id_minting: { enabled: true, counters_persist: false },
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface CopilotDynAEPProps {
  config: AEPConfig;
  runtimeUrl: string;
  bridgeConfig?: DynAEPBridgeConfig;
  onAOTFailure?: "throw" | "warn" | "silent";
  children: React.ReactNode;
}

export function CopilotDynAEP({
  config, runtimeUrl, bridgeConfig, onAOTFailure, children,
}: CopilotDynAEPProps) {
  const onFail = onAOTFailure ?? "warn";

  const validationResult = useMemo(() => {
    const result = validateAOT(config);
    if (!result.valid) {
      if (onFail === "throw") throw new Error(`[dynAEP/copilotkit] AOT failed: ${result.errors.join("; ")}`);
      if (onFail === "warn") console.error("[dynAEP/copilotkit] AOT failed:", result.errors);
    }
    return result;
  }, [config, onFail]);

  return React.createElement(
    CopilotKit,
    { runtimeUrl },
    React.createElement(AEPToolsRegistrar, { config, bridgeConfig: bridgeConfig ?? DEFAULT_BRIDGE_CONFIG }),
    React.createElement(AEPStateProvider, { config }),
    children,
  );
}

// ---------------------------------------------------------------------------
// Tool Registrar
// ---------------------------------------------------------------------------

function AEPToolsRegistrar({
  config, bridgeConfig,
}: {
  config: AEPConfig; bridgeConfig: DynAEPBridgeConfig;
}) {
  // Bridge handles all validation and ID minting
  const bridgeRef = useRef(new DynAEPBridge(config, bridgeConfig));
  const bridge = bridgeRef.current;

  // Track live elements for CopilotKit readable state
  const [elementIds, setElementIds] = useState(() => Object.keys(config.scene.elements));

  const refreshIds = useCallback(() => {
    setElementIds(Object.keys(bridge.getLiveElements()));
  }, [bridge]);

  // aep_add_element: agent proposes type/parent/z/skin_binding, bridge mints ID
  useCopilotAction({
    name: "aep_add_element",
    description: "Propose a new element. The bridge assigns the AEP ID and returns it.",
    parameters: [
      { name: "type", type: "string", description: "Element type (panel, component, widget, etc)", required: true },
      { name: "parent", type: "string", description: "AEP ID of the parent element", required: true },
      { name: "z", type: "number", description: "z-index within the correct band for the type", required: true },
      { name: "skin_binding", type: "string", description: "Key in aep-theme.yaml component_styles", required: true },
      { name: "label", type: "string", description: "Human-readable name", required: false },
    ],
    handler: async (args: Record<string, any>) => {
      const result = bridge.handleToolCall("aep_add_element", args);
      if (result.success) refreshIds();
      return result;
    },
  });

  // aep_move_element
  useCopilotAction({
    name: "aep_move_element",
    description: "Move an AEP element to a new parent",
    parameters: [
      { name: "id", type: "string", required: true },
      { name: "new_parent", type: "string", required: true },
    ],
    handler: async (args: Record<string, any>) => {
      const result = bridge.handleToolCall("aep_move_element", args);
      if (result.success) refreshIds();
      return result;
    },
  });

  // aep_query_graph
  useCopilotAction({
    name: "aep_query_graph",
    description: "Query the AEP scene graph",
    parameters: [
      { name: "query_type", type: "string", description: "children_of | parent_of | z_band_of | full_element | next_available_id", required: true },
      { name: "target_id", type: "string", required: true },
    ],
    handler: async (args: Record<string, any>) => {
      return bridge.handleToolCall("aep_query_graph", args);
    },
  });

  // aep_swap_theme
  useCopilotAction({
    name: "aep_swap_theme",
    description: "Switch the active AEP theme",
    parameters: [
      { name: "theme_name", type: "string", required: true },
    ],
    handler: async (args: Record<string, any>) => {
      return bridge.handleToolCall("aep_swap_theme", args);
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// State Provider
// ---------------------------------------------------------------------------

function AEPStateProvider({ config }: { config: AEPConfig }) {
  useCopilotReadable({
    description: "Current AEP scene graph: element IDs, count and viewport breakpoints",
    value: JSON.stringify({
      element_count: Object.keys(config.scene.elements).length,
      element_ids: Object.keys(config.scene.elements),
      breakpoints: config.scene.viewport_breakpoints,
    }),
  });

  useCopilotReadable({
    description: "Available AEP skin bindings (keys in aep-theme.yaml component_styles)",
    value: JSON.stringify(Object.keys(config.theme.component_styles)),
  });

  useCopilotReadable({
    description: "AEP registry entries: element IDs with their types and skin bindings",
    value: JSON.stringify(
      Object.fromEntries(
        Object.entries(config.registry).map(([id, entry]) => [
          id, { label: entry.label, category: entry.category, skin_binding: entry.skin_binding },
        ]),
      ),
    ),
  });

  return null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { AEPToolsRegistrar, AEPStateProvider };
