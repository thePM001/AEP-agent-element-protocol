// ===========================================================================
// @aep/vue - AEP Vue 3 SDK
// Composables and components for AEP-governed Vue frontends.
// SSR-safe. ResizeObserver-based coordinates. Reactive scene graph.
// ===========================================================================

import {
  inject,
  computed,
  ref,
  reactive,
  watch,
  onMounted,
  onUnmounted,
  defineComponent,
  h,
  warn as vueWarn,
} from "vue";
import type { App, InjectionKey, Ref, PropType } from "vue";
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
import {
  resolveStyles,
  validateAOT,
  prefixFromId,
  zBandForPrefix,
} from "@aep/core";

// ---------------------------------------------------------------------------
// Injection Keys
// ---------------------------------------------------------------------------

interface AEPContextValue {
  config: AEPConfig;
  scene: AEPScene;
  registry: Record<string, AEPRegistryEntry>;
  theme: AEPTheme;
  validationResult: AEPValidationResult;
  // Reactive scene elements for live agent mutations
  liveElements: Record<string, AEPElement>;
}

const AEP_KEY: InjectionKey<AEPContextValue> = Symbol("aep");

// ---------------------------------------------------------------------------
// Plugin Options
// ---------------------------------------------------------------------------

export interface AEPPluginOptions {
  /**
   * "throw" = throw Error on AOT failure (recommended for CI/build).
   * "warn"  = console.error + continue (default, for dev).
   * "silent" = suppress entirely.
   */
  onAOTFailure?: "throw" | "warn" | "silent";
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function createAEP(config: AEPConfig, options: AEPPluginOptions = {}) {
  const onFail = options.onAOTFailure ?? "warn";
  const result = validateAOT(config);

  if (!result.valid) {
    if (onFail === "throw") {
      throw new Error(
        `[AEP] AOT validation failed with ${result.errors.length} error(s):\n` +
        result.errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    if (onFail === "warn") {
      console.error("[AEP] AOT validation failed:", result.errors);
    }
  }

  return {
    install(app: App) {
      // Wrap elements in reactive() so agent mutations trigger re-renders
      const liveElements = reactive(
        structuredClone(config.scene.elements),
      ) as Record<string, AEPElement>;

      const ctx: AEPContextValue = {
        config,
        scene: config.scene,
        registry: config.registry,
        theme: config.theme,
        validationResult: result,
        liveElements,
      };

      app.provide(AEP_KEY, ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// Context Helper
// ---------------------------------------------------------------------------

function useAEPContext(): AEPContextValue {
  const ctx = inject(AEP_KEY);
  if (!ctx) {
    throw new Error(
      "[AEP] useAEP* composables require the createAEP plugin. " +
      "Call app.use(createAEP(config)) before mounting."
    );
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// useAEPElement
// ---------------------------------------------------------------------------

export function useAEPElement(id: string) {
  const ctx = useAEPContext();

  return computed(() => {
    const element = ctx.liveElements[id] ?? null;
    const entry = ctx.registry[id] ?? null;

    if (!element && !entry) {
      vueWarn(`[AEP] Element "${id}" not found in scene or registry`);
    }

    const baseStyles = entry
      ? resolveStyles(entry.skin_binding, ctx.theme)
      : {};

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
  });
}

// ---------------------------------------------------------------------------
// useAEPScene (reactive: reflects live agent mutations)
// ---------------------------------------------------------------------------

export function useAEPScene() {
  const ctx = useAEPContext();
  return computed(() => ({
    ...ctx.scene,
    elements: ctx.liveElements,
  }));
}

// ---------------------------------------------------------------------------
// useAEPTheme
// ---------------------------------------------------------------------------

export function useAEPTheme() {
  const ctx = useAEPContext();
  return computed(() => ctx.theme);
}

// ---------------------------------------------------------------------------
// useAEPValidation
// ---------------------------------------------------------------------------

export function useAEPValidation() {
  const ctx = useAEPContext();
  return computed(() => ctx.validationResult);
}

// ---------------------------------------------------------------------------
// useAEPVisibility (breakpoint-aware)
// ---------------------------------------------------------------------------

export function useAEPVisibility(id: string) {
  const ctx = useAEPContext();
  const breakpoint = useCurrentBreakpoint();

  return computed(() => {
    const el = ctx.liveElements[id];
    if (!el) return false;
    if (!el.visible) return false;

    if (el.responsive_matrix) {
      const bp = breakpoint.value;
      const override = el.responsive_matrix[bp];
      if (override && "visible" in override) {
        return (override as Partial<AEPElement>).visible ?? true;
      }
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// useCurrentBreakpoint (SSR-safe)
// ---------------------------------------------------------------------------

export function useCurrentBreakpoint() {
  const bp = ref("unknown");

  if (typeof window === "undefined") return bp;

  const update = () => {
    const w = window.innerWidth;
    if (w < 640) bp.value = "base";
    else if (w < 1024) bp.value = "vp-md";
    else bp.value = "vp-lg";
  };

  onMounted(() => {
    update();
    window.addEventListener("resize", update, { passive: true });
  });

  onUnmounted(() => {
    window.removeEventListener("resize", update);
  });

  return bp;
}

// ---------------------------------------------------------------------------
// useAEPCoordinates (ResizeObserver, SSR-safe, no polling)
// ---------------------------------------------------------------------------

export function useAEPCoordinates(id: string) {
  const coords: Ref<AEPRuntimeCoordinates | null> = ref(null);

  // SSR guard: do nothing on server
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
    return coords;
  }

  let observer: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const measure = () => {
    const el = document.querySelector(`[data-aep-id="${id}"]`);
    if (!el) {
      coords.value = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth;
    let bp = "vp-lg";
    if (w < 640) bp = "base";
    else if (w < 1024) bp = "vp-md";

    coords.value = {
      id,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      rendered_at: bp,
      visible: rect.width > 0 && rect.height > 0,
    };
  };

  onMounted(() => {
    measure();

    // Observe size changes
    const el = document.querySelector(`[data-aep-id="${id}"]`);
    if (el) {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }

    // If element doesn't exist yet (dynamic), watch for it to appear
    if (!el) {
      mutationObserver = new MutationObserver(() => {
        const found = document.querySelector(`[data-aep-id="${id}"]`);
        if (found) {
          measure();
          observer = new ResizeObserver(measure);
          observer.observe(found);
          mutationObserver?.disconnect();
          mutationObserver = null;
        }
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  });

  onUnmounted(() => {
    observer?.disconnect();
    mutationObserver?.disconnect();
  });

  return coords;
}

// ---------------------------------------------------------------------------
// useLiveElements (for agent mutations)
// ---------------------------------------------------------------------------

export function useLiveElements() {
  const ctx = useAEPContext();
  return ctx.liveElements;
}

/**
 * Apply a mutation to the live reactive scene graph.
 * Use this when an agent (via AG-UI) proposes a validated change.
 */
export function useAEPMutate() {
  const ctx = useAEPContext();

  return {
    setElement(id: string, element: AEPElement) {
      ctx.liveElements[id] = element;
    },
    removeElement(id: string) {
      delete ctx.liveElements[id];
    },
    updateField<K extends keyof AEPElement>(id: string, field: K, value: AEPElement[K]) {
      const el = ctx.liveElements[id];
      if (el) {
        el[field] = value;
      }
    },
    moveElement(id: string, newParentId: string) {
      const el = ctx.liveElements[id];
      if (!el) return;

      // Remove from old parent children
      const oldParent = el.parent ? ctx.liveElements[el.parent] : null;
      if (oldParent) {
        const idx = oldParent.children.indexOf(id);
        if (idx !== -1) oldParent.children.splice(idx, 1);
      }

      // Set new parent
      el.parent = newParentId;

      // Add to new parent children
      const newParent = ctx.liveElements[newParentId];
      if (newParent && !newParent.children.includes(id)) {
        newParent.children.push(id);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Style Helpers
// ---------------------------------------------------------------------------

/**
 * Convert snake_case/underscore keys to kebab-case CSS properties.
 * Handles common patterns: border_radius -> border-radius,
 * font_size -> font-size, etc.
 */
function toCSSProperty(key: string): string {
  return key.replace(/_/g, "-");
}

/**
 * Extract flat CSS-compatible properties from a resolved style block,
 * optionally layering a named state on top.
 */
function buildInlineStyles(
  baseStyles: Record<string, any>,
  state: string,
): Record<string, string> {
  const result: Record<string, string> = {};

  // Base: only flat (non-object) values
  for (const [key, val] of Object.entries(baseStyles)) {
    if (typeof val !== "object" || val === null) {
      result[toCSSProperty(key)] = String(val);
    }
  }

  // State override: layer on top
  const stateBlock = baseStyles[state];
  if (typeof stateBlock === "object" && stateBlock !== null && !Array.isArray(stateBlock)) {
    for (const [key, val] of Object.entries(stateBlock)) {
      if (typeof val !== "object" || val === null) {
        result[toCSSProperty(key)] = String(val);
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// AEPElement Component
// ---------------------------------------------------------------------------

export const AEPElementComponent = defineComponent({
  name: "AEPElement",
  props: {
    id: { type: String, required: true },
    as: { type: String, default: "div" },
    state: { type: String, default: "default" },
  },
  emits: ["click", "mouseenter", "mouseleave", "focus", "blur", "keydown"],
  setup(props, { slots, attrs, emit }) {
    const data = useAEPElement(props.id);
    const isVisible = useAEPVisibility(props.id);

    return () => {
      if (!isVisible.value) return null;

      const { entry, baseStyles } = data.value;
      const inlineStyles = buildInlineStyles(baseStyles, props.state);

      return h(
        props.as,
        {
          "data-aep-id": props.id,
          style: inlineStyles,
          title: entry?.label,
          onClick: (e: MouseEvent) => emit("click", e),
          onMouseenter: (e: MouseEvent) => emit("mouseenter", e),
          onMouseleave: (e: MouseEvent) => emit("mouseleave", e),
          onFocus: (e: FocusEvent) => emit("focus", e),
          onBlur: (e: FocusEvent) => emit("blur", e),
          onKeydown: (e: KeyboardEvent) => emit("keydown", e),
          ...attrs,
        },
        slots.default?.(),
      );
    };
  },
});

// ---------------------------------------------------------------------------
// useAEPMemory (v2.0)
// ---------------------------------------------------------------------------

export function useAEPMemory() {
  const ctx = useAEPContext();

  return {
    queryAttractor(embedding: number[], limit: number = 5): MemoryEntry[] {
      if (!ctx.config?.memory) return [];
      return ctx.config.memory.findNearestAttractor(embedding, limit);
    },
    getRejections(elementId: string): MemoryEntry[] {
      if (!ctx.config?.memory) return [];
      return ctx.config.memory.getRejectionHistory(elementId);
    },
    getValidationCount(elementId: string): number {
      if (!ctx.config?.memory) return 0;
      return ctx.config.memory.getValidationCount(elementId);
    },
    available: computed(() => !!ctx.config?.memory),
  };
}

// ---------------------------------------------------------------------------
// useAEPResolver (v2.0)
// ---------------------------------------------------------------------------

export function useAEPResolver() {
  const ctx = useAEPContext();

  return {
    resolve(request: ResolveRequest) {
      if (!ctx.config?.resolver) {
        return {
          route: "ui",
          constraints: [] as string[],
          policyPass: true,
          policyErrors: [] as string[],
          availableActions: [] as string[],
          nearestAttractor: null,
          fastPath: false,
        };
      }
      return ctx.config.resolver.resolve(request);
    },
    availableRoutes: computed(() => ctx.config?.resolver?.getAvailableRoutes() ?? []),
    available: computed(() => !!ctx.config?.resolver),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { AEP_KEY };
export type { AEPContextValue };
