// ===========================================================================
// @aep/react - AEP React SDK
// Hooks and components for AEP-governed React frontends.
// SSR-safe. ResizeObserver coordinates. Reactive scene graph.
// ===========================================================================

import React, {
  createContext,
  useContext,
  useMemo,
  useEffect,
  useState,
  useCallback,
  useRef,
  forwardRef,
} from "react";
import type { ReactNode, CSSProperties, MouseEvent, KeyboardEvent, FocusEvent } from "react";
import type {
  AEPConfig,
  AEPElement,
  AEPRegistryEntry,
  AEPTheme,
  AEPScene,
  AEPRuntimeCoordinates,
  AEPValidationResult,
  ResolveRequest,
  MemoryEntry,
} from "@aep/core";
import { resolveStyles, validateAOT, prefixFromId, zBandForPrefix } from "@aep/core";

// ---------------------------------------------------------------------------
// Plugin Options
// ---------------------------------------------------------------------------

export interface AEPProviderOptions {
  /**
   * "throw"  = throw Error on AOT failure (recommended for CI/build).
   * "warn"   = console.error + continue (default, for dev).
   * "silent" = suppress entirely.
   */
  onAOTFailure?: "throw" | "warn" | "silent";
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AEPContextValue {
  config: AEPConfig;
  scene: AEPScene;
  registry: Record<string, AEPRegistryEntry>;
  theme: AEPTheme;
  validationResult: AEPValidationResult;
  // Mutable clone of scene elements for live agent mutations
  liveElements: Record<string, AEPElement>;
  setLiveElements: React.Dispatch<React.SetStateAction<Record<string, AEPElement>>>;
}

const AEPContext = createContext<AEPContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface AEPProviderProps {
  config: AEPConfig;
  options?: AEPProviderOptions;
  children: ReactNode;
}

export function AEPProvider({ config, options, children }: AEPProviderProps) {
  const onFail = options?.onAOTFailure ?? "warn";

  const validationResult = useMemo(() => validateAOT(config), [config]);

  // Handle AOT failure
  useMemo(() => {
    if (!validationResult.valid) {
      if (onFail === "throw") {
        throw new Error(
          `[AEP] AOT validation failed with ${validationResult.errors.length} error(s):\n` +
          validationResult.errors.map((e) => `  - ${e}`).join("\n")
        );
      }
      if (onFail === "warn") {
        console.error("[AEP] AOT validation failed:", validationResult.errors);
      }
    }
  }, [validationResult, onFail]);

  // Live elements: mutable clone for agent mutations, triggers re-renders via setState
  const [liveElements, setLiveElements] = useState<Record<string, AEPElement>>(() =>
    structuredClone(config.scene.elements),
  );

  // Reset live elements if config changes (new config loaded)
  useEffect(() => {
    setLiveElements(structuredClone(config.scene.elements));
  }, [config]);

  // Stable context value: only changes when dependencies actually change
  const value = useMemo<AEPContextValue>(
    () => ({
      config,
      scene: config.scene,
      registry: config.registry,
      theme: config.theme,
      validationResult,
      liveElements,
      setLiveElements,
    }),
    [config, config.scene, config.registry, config.theme, validationResult, liveElements, setLiveElements],
  );

  return React.createElement(AEPContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// Context Hook
// ---------------------------------------------------------------------------

function useAEPContext(): AEPContextValue {
  const ctx = useContext(AEPContext);
  if (!ctx) {
    throw new Error(
      "[AEP] useAEP* hooks require <AEPProvider>. " +
      "Wrap your app in <AEPProvider config={...}>."
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// useAEPElement
// ---------------------------------------------------------------------------

export function useAEPElement(id: string) {
  const { liveElements, registry, theme } = useAEPContext();

  return useMemo(() => {
    const element = liveElements[id] ?? null;
    const entry = registry[id] ?? null;

    if (!element && !entry) {
      console.warn(`[AEP] Element "${id}" not found in scene or registry`);
    }

    const baseStyles = entry ? resolveStyles(entry.skin_binding, theme) : {};

    return {
      element,
      entry,
      baseStyles,
      id,
      label: entry?.label ?? id,
      skinBinding: entry?.skin_binding ?? null,
      states: entry?.states ?? {},
      constraints: entry?.constraints ?? [],
    };
  }, [id, liveElements, registry, theme]);
}

// ---------------------------------------------------------------------------
// useAEPScene (reflects live mutations)
// ---------------------------------------------------------------------------

export function useAEPScene() {
  const { scene, liveElements } = useAEPContext();
  return useMemo(
    () => ({ ...scene, elements: liveElements }),
    [scene, liveElements],
  );
}

// ---------------------------------------------------------------------------
// useAEPTheme
// ---------------------------------------------------------------------------

export function useAEPTheme() {
  const { theme } = useAEPContext();
  return theme;
}

// ---------------------------------------------------------------------------
// useAEPValidation
// ---------------------------------------------------------------------------

export function useAEPValidation() {
  const { validationResult } = useAEPContext();
  return validationResult;
}

// ---------------------------------------------------------------------------
// useCurrentBreakpoint (SSR-safe)
// ---------------------------------------------------------------------------

export function useCurrentBreakpoint(): string {
  const [bp, setBp] = useState("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => {
      const w = window.innerWidth;
      if (w < 640) setBp("base");
      else if (w < 1024) setBp("vp-md");
      else setBp("vp-lg");
    };

    update();
    window.addEventListener("resize", update, { passive: true } as AddEventListenerOptions);
    return () => window.removeEventListener("resize", update);
  }, []);

  return bp;
}

// ---------------------------------------------------------------------------
// useAEPVisibility (breakpoint-aware, responsive_matrix)
// ---------------------------------------------------------------------------

export function useAEPVisibility(id: string): boolean {
  const { liveElements } = useAEPContext();
  const bp = useCurrentBreakpoint();

  return useMemo(() => {
    const el = liveElements[id];
    if (!el) return false;
    if (!el.visible) return false;

    if (el.responsive_matrix) {
      const override = el.responsive_matrix[bp];
      if (override && "visible" in override) {
        return (override as Partial<AEPElement>).visible ?? true;
      }
    }

    return true;
  }, [id, liveElements, bp]);
}

// ---------------------------------------------------------------------------
// useAEPCoordinates (ResizeObserver, SSR-safe, no polling)
// ---------------------------------------------------------------------------

export function useAEPCoordinates(id: string): AEPRuntimeCoordinates | null {
  const [coords, setCoords] = useState<AEPRuntimeCoordinates | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const mutObserverRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const el = document.querySelector(`[data-aep-id="${id}"]`);
      if (!el) {
        setCoords(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const w = window.innerWidth;
      let bp = "vp-lg";
      if (w < 640) bp = "base";
      else if (w < 1024) bp = "vp-md";

      setCoords({
        id,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        rendered_at: bp,
        visible: rect.width > 0 && rect.height > 0,
      });
    };

    measure();

    const el = document.querySelector(`[data-aep-id="${id}"]`);
    if (el) {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(el);
    } else {
      // Element not in DOM yet (agent may create it later). Watch for it.
      mutObserverRef.current = new MutationObserver(() => {
        const found = document.querySelector(`[data-aep-id="${id}"]`);
        if (found) {
          measure();
          observerRef.current = new ResizeObserver(measure);
          observerRef.current.observe(found);
          mutObserverRef.current?.disconnect();
          mutObserverRef.current = null;
        }
      });
      mutObserverRef.current.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observerRef.current?.disconnect();
      mutObserverRef.current?.disconnect();
    };
  }, [id]);

  return coords;
}

// ---------------------------------------------------------------------------
// useAEPMutate (for agent-driven live mutations)
// ---------------------------------------------------------------------------

export function useAEPMutate() {
  const { setLiveElements } = useAEPContext();

  const setElement = useCallback(
    (id: string, element: AEPElement) => {
      setLiveElements((prev) => ({ ...prev, [id]: element }));
    },
    [setLiveElements],
  );

  const removeElement = useCallback(
    (id: string) => {
      setLiveElements((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setLiveElements],
  );

  const updateField = useCallback(
    <K extends keyof AEPElement>(id: string, field: K, value: AEPElement[K]) => {
      setLiveElements((prev) => {
        const el = prev[id];
        if (!el) return prev;
        return { ...prev, [id]: { ...el, [field]: value } };
      });
    },
    [setLiveElements],
  );

  const moveElement = useCallback(
    (id: string, newParentId: string) => {
      setLiveElements((prev) => {
        const el = prev[id];
        if (!el) return prev;

        const next = { ...prev };

        // Remove from old parent children
        const oldParentId = el.parent;
        if (oldParentId && next[oldParentId]) {
          next[oldParentId] = {
            ...next[oldParentId],
            children: next[oldParentId].children.filter((c) => c !== id),
          };
        }

        // Update element parent
        next[id] = { ...el, parent: newParentId };

        // Add to new parent children
        if (next[newParentId] && !next[newParentId].children.includes(id)) {
          next[newParentId] = {
            ...next[newParentId],
            children: [...next[newParentId].children, id],
          };
        }

        return next;
      });
    },
    [setLiveElements],
  );

  return { setElement, removeElement, updateField, moveElement };
}

// ---------------------------------------------------------------------------
// Style Helpers
// ---------------------------------------------------------------------------

function toCSSProperty(key: string): string {
  return key.replace(/_/g, "-");
}

function buildInlineStyles(
  baseStyles: Record<string, any>,
  state: string,
): CSSProperties {
  const result: Record<string, string> = {};

  // Base: only flat values
  for (const [key, val] of Object.entries(baseStyles)) {
    if (typeof val !== "object" || val === null) {
      result[toCSSProperty(key)] = String(val);
    }
  }

  // State override
  const stateBlock = baseStyles[state];
  if (typeof stateBlock === "object" && stateBlock !== null && !Array.isArray(stateBlock)) {
    for (const [key, val] of Object.entries(stateBlock)) {
      if (typeof val !== "object" || val === null) {
        result[toCSSProperty(key)] = String(val);
      }
    }
  }

  return result as CSSProperties;
}

// ---------------------------------------------------------------------------
// AEPElement Component (forwardRef, forwards events + attrs)
// ---------------------------------------------------------------------------

interface AEPElementProps {
  id: string;
  as?: keyof JSX.IntrinsicElements;
  state?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: (e: MouseEvent) => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: FocusEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-hidden"?: boolean;
  "aria-disabled"?: boolean;
}

export const AEPElement = forwardRef<HTMLElement, AEPElementProps>(
  function AEPElement(
    {
      id,
      as: Tag = "div",
      state = "default",
      children,
      className,
      style: extraStyle,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      role,
      tabIndex,
      ...ariaProps
    },
    ref,
  ) {
    const { element, entry, baseStyles } = useAEPElement(id);
    const isVisible = useAEPVisibility(id);

    if (!isVisible) return null;

    const inlineStyles = buildInlineStyles(baseStyles, state);
    const mergedStyles = extraStyle ? { ...inlineStyles, ...extraStyle } : inlineStyles;

    return React.createElement(Tag, {
      ref,
      "data-aep-id": id,
      style: mergedStyles,
      title: entry?.label,
      className,
      onClick,
      onMouseEnter,
      onMouseLeave,
      onFocus,
      onBlur,
      onKeyDown,
      role,
      tabIndex,
      ...ariaProps,
    }, children);
  },
);

// ---------------------------------------------------------------------------
// useAEPMemory (v2.0)
// ---------------------------------------------------------------------------

export function useAEPMemory() {
  const { config } = useAEPContext();

  const queryAttractor = useCallback(
    (embedding: number[], limit: number = 5): MemoryEntry[] => {
      if (!config.memory) return [];
      return config.memory.findNearestAttractor(embedding, limit);
    },
    [config.memory],
  );

  const getRejections = useCallback(
    (elementId: string): MemoryEntry[] => {
      if (!config.memory) return [];
      return config.memory.getRejectionHistory(elementId);
    },
    [config.memory],
  );

  const getValidationCount = useCallback(
    (elementId: string): number => {
      if (!config.memory) return 0;
      return config.memory.getValidationCount(elementId);
    },
    [config.memory],
  );

  return { queryAttractor, getRejections, getValidationCount, available: !!config.memory };
}

// ---------------------------------------------------------------------------
// useAEPResolver (v2.0)
// ---------------------------------------------------------------------------

export function useAEPResolver() {
  const { config } = useAEPContext();

  const resolve = useCallback(
    (request: ResolveRequest) => {
      if (!config.resolver) {
        return {
          route: "ui",
          constraints: [],
          policyPass: true,
          policyErrors: [],
          availableActions: [],
          nearestAttractor: null,
          fastPath: false,
        };
      }
      return config.resolver.resolve(request);
    },
    [config.resolver],
  );

  const availableRoutes = useMemo(
    () => config.resolver?.getAvailableRoutes() ?? [],
    [config.resolver],
  );

  return { resolve, availableRoutes, available: !!config.resolver };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { AEPContext };
export type { AEPContextValue, AEPProviderProps, AEPElementProps };
