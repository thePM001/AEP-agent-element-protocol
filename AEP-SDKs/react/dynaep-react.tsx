// ===========================================================================
// dynAEP React bindings (AEP-SDKs/react/dynaep-react.tsx)
// Hooks and components wiring AEP elements to the dynAEP validation bridge.
// ===========================================================================

import React, {
  createContext, useContext, useEffect, useMemo, useState,
  useCallback, useRef,
} from "react";
import type { ReactNode } from "react";
import type {
  AEPConfig, AEPElement, AEPRuntimeCoordinates, AEPValidationResult,
} from "../typescript/aep-protocol/sdk/sdk-aep-core.js";
import { validateAOT, resolveStyles, prefixFromId, zBandForPrefix } from "../typescript/aep-protocol/sdk/sdk-aep-core.js";
import { DynAEPBridge } from "../typescript/dynaep/src/bridge.js";
import type { DynAEPBridgeConfig, DynAEPRejection } from "../typescript/dynaep/src/bridge.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DynAEPContextValue {
  bridge: DynAEPBridge;
  config: AEPConfig;
  validationResult: AEPValidationResult;
  liveElements: Record<string, AEPElement>;
  agentEvents: any[];
  rejections: DynAEPRejection[];
  emitToAgent: (event: any) => void;
  refreshLiveElements: () => void;
}

const DynAEPContext = createContext<DynAEPContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface DynAEPProviderProps {
  config: AEPConfig;
  bridgeConfig: DynAEPBridgeConfig;
  agentEndpoint: string;
  onAOTFailure?: "throw" | "warn" | "silent";
  children: ReactNode;
}

export function DynAEPProvider({
  config, bridgeConfig, agentEndpoint, onAOTFailure, children,
}: DynAEPProviderProps) {
  const onFail = onAOTFailure ?? "warn";
  const [agentEvents, setAgentEvents] = useState<any[]>([]);
  const [rejections, setRejections] = useState<DynAEPRejection[]>([]);
  const [liveElements, setLiveElements] = useState<Record<string, AEPElement>>(() =>
    structuredClone(config.scene.elements),
  );

  const bridge = useMemo(
    () => new DynAEPBridge(config, bridgeConfig),
    [config, bridgeConfig],
  );

  const validationResult = useMemo(() => {
    const result = validateAOT(config);
    if (!result.valid) {
      if (onFail === "throw") {
        throw new Error(`[dynAEP] AOT failed: ${result.errors.join("; ")}`);
      }
      if (onFail === "warn") {
        console.error("[dynAEP] AOT validation failed:", result.errors);
      }
    }
    return result;
  }, [config, onFail]);

  const refreshLiveElements = useCallback(() => {
    setLiveElements(structuredClone(bridge.getLiveElements()));
  }, [bridge]);

  // SSE connection
  useEffect(() => {
    const eventSource = new EventSource(agentEndpoint);

    eventSource.onmessage = (msg) => {
      void (async () => {
      let parsed: any;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return; // skip non-JSON
      }

      // Handle tool calls: route to bridge
      if (parsed.type === "TOOL_CALL_END" && parsed.name?.startsWith("aep_")) {
        const toolResult = bridge.handleToolCall(parsed.name, parsed.args ?? {});
        setAgentEvents((prev) => [...prev, { ...parsed, aep_result: toolResult }]);
        refreshLiveElements();
        return;
      }

      const result = await bridge.processEvent(parsed);

      if (result && (result as any).dynaep_type === "DYNAEP_REJECTION") {
        setRejections((prev) => [...prev, result as DynAEPRejection]);
      } else if (result) {
        setAgentEvents((prev) => [...prev, result]);
        // Refresh live elements after any validated mutation
        if (
          parsed.type === "STATE_DELTA" ||
          (parsed.type === "CUSTOM" && parsed.dynaep_type?.startsWith("AEP_MUTATE"))
        ) {
          refreshLiveElements();
        }
      }
      })();
    };

    eventSource.onerror = () => {
      console.warn("[dynAEP] SSE connection error, will reconnect");
    };

    return () => eventSource.close();
  }, [agentEndpoint, bridge, refreshLiveElements]);

  // Runtime reflection via ResizeObserver
  useEffect(() => {
    if (!bridgeConfig.runtime_reflection?.enabled) return;

    bridge.startReflection((_event) => {
      // In production: POST back to agent endpoint
    });

    return () => bridge.stopReflection();
  }, [bridge, bridgeConfig]);

  const emitToAgent = useCallback((event: any) => {
    fetch(agentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    }).catch((err) => console.error("[dynAEP] Failed to emit:", err));
  }, [agentEndpoint]);

  const value = useMemo<DynAEPContextValue>(
    () => ({
      bridge, config, validationResult, liveElements,
      agentEvents, rejections, emitToAgent, refreshLiveElements,
    }),
    [bridge, config, validationResult, liveElements, agentEvents, rejections, emitToAgent, refreshLiveElements],
  );

  return React.createElement(DynAEPContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useDynAEP(): DynAEPContextValue {
  const ctx = useContext(DynAEPContext);
  if (!ctx) throw new Error("[dynAEP] Hooks require <DynAEPProvider>");
  return ctx;
}

export function useDynAEPBridge() {
  return useDynAEP().bridge;
}

export function useAgentStream() {
  const ctx = useDynAEP();
  return { events: ctx.agentEvents, rejections: ctx.rejections, emit: ctx.emitToAgent };
}

export function useAEPElement(id: string) {
  const { liveElements, config } = useDynAEP();

  return useMemo(() => {
    const element = liveElements[id] ?? null;
    const entry = config.registry[id] ?? null;

    if (!element && !entry) {
      console.warn(`[dynAEP] Element "${id}" not found`);
    }

    const baseStyles = entry ? resolveStyles(entry.skin_binding, config.theme) : {};
    return { element, entry, baseStyles, id, label: entry?.label ?? id };
  }, [id, liveElements, config]);
}

export function useAEPScene() {
  const { config, liveElements } = useDynAEP();
  return useMemo(() => ({ ...config.scene, elements: liveElements }), [config.scene, liveElements]);
}

export function useAEPMutate() {
  const { bridge, refreshLiveElements } = useDynAEP();

  const addElement = useCallback(
    (args: { type: string; parent: string; z: number; skin_binding: string; label?: string; layout?: any }) => {
      const result = bridge.handleToolCall("aep_add_element", args);
      refreshLiveElements();
      return result;
    },
    [bridge, refreshLiveElements],
  );

  const moveElement = useCallback(
    (id: string, newParent: string, anchors?: Record<string, string>) => {
      const result = bridge.handleToolCall("aep_move_element", { id, new_parent: newParent, anchors });
      refreshLiveElements();
      return result;
    },
    [bridge, refreshLiveElements],
  );

  return { addElement, moveElement };
}

export function useAEPQuery(queryType: string, targetId: string) {
  const { bridge } = useDynAEP();

  return useMemo(() => {
    const result = bridge.handleToolCall("aep_query_graph", { query_type: queryType, target_id: targetId });
    return result.result ?? null;
  }, [bridge, queryType, targetId]);
}

export function useAEPCoordinates(id: string) {
  const [coords, setCoords] = useState<AEPRuntimeCoordinates | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const el = document.querySelector(`[data-aep-id="${id}"]`);
      if (!el) { setCoords(null); return; }
      const rect = el.getBoundingClientRect();
      const w = window.innerWidth;
      let bp = "vp-lg";
      if (w < 640) bp = "base";
      else if (w < 1024) bp = "vp-md";
      setCoords({
        id, x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height),
        rendered_at: bp, visible: rect.width > 0 && rect.height > 0,
      });
    };

    measure();
    const el = document.querySelector(`[data-aep-id="${id}"]`);
    if (el) {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [id]);

  return coords;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { DynAEPContext };
