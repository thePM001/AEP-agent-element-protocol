// ===========================================================================
// @aep/core - AEP Core SDK
// Loader, validator, resolver and types for the Agent Element Protocol.
// ===========================================================================

import * as fs from "fs";
import * as nodepath from "path";
import * as jsyaml from "js-yaml"; // npm install js-yaml

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AEPScene {
  aep_version: string;
  schema_revision: number;
  elements: Record<string, AEPElement>;
  viewport_breakpoints: Record<string, ViewportBreakpoint>;
  camera: { x: number; y: number; zoom: number };
}

export interface AEPElement {
  id: string;
  type: string;
  label: string;
  z: number;
  visible: boolean;
  parent: string | null;
  layout: AEPLayout;
  children: string[];
  spatial_rule?: "flex" | "grid";
  direction?: "row" | "column";
  justify?: string;
  align?: string;
  gap?: string;
  responsive_matrix?: Record<string, Partial<AEPElement>>;
}

export interface AEPLayout {
  width?: string;
  height?: string;
  min_height?: string;
  max_width?: string;
  anchors?: Record<string, string>;
}

export interface ViewportBreakpoint {
  min_width?: number;
  max_width?: number;
}

export interface AEPRegistryEntry {
  label: string;
  category: "action" | "data-input" | "data-display" | "feedback" | "layout" | "system";
  function: string;
  component_file: string;
  parent: string;
  skin_binding: string;
  states: Record<string, string>;
  actions: string[];
  events: Record<string, string>;
  constraints: string[];
  data_source: string;
  user_interaction: string;
  keyboard_shortcut?: string;
  instance_prefix?: string;
  instance_range?: string;
}

export interface AEPTheme {
  aep_version: string;
  schema_revision: number;
  theme_name: string;
  colors: Record<string, string>;
  typography: Record<string, string | number>;
  dimensions: Record<string, number>;
  animations: Record<string, any>;
  component_styles: Record<string, Record<string, any>>;
}

// AEPConfig.registry is ALWAYS a clean Record<string, AEPRegistryEntry>
// with metadata stripped out. No fallback logic needed anywhere downstream.
export interface AEPConfig {
  scene: AEPScene;
  registry: Record<string, AEPRegistryEntry>;
  theme: AEPTheme;
  meta: { reg_aep_version: string; reg_schema_revision: number };
  // v2.0 optional
  memory?: import("./sdk-aep-memory").MemoryFabric;
  resolver?: import("./sdk-aep-resolver").BasicResolver;
}

export interface AEPValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Z-Band Constants
// ---------------------------------------------------------------------------

export const Z_BANDS: Record<string, [number, number]> = {
  SH: [0, 9],   PN: [10, 19], NV: [10, 19],
  CP: [20, 29], FM: [20, 29], IC: [20, 29],
  CZ: [30, 39], CN: [30, 39],
  TB: [40, 49], WD: [50, 59], OV: [60, 69],
  MD: [70, 79], DD: [70, 79], TT: [80, 89],
};

export function zBandForPrefix(prefix: string): [number, number] {
  return Z_BANDS[prefix] || [0, 99];
}

export function prefixFromId(id: string): string {
  if (id.length < 2) {
    throw new Error(`Invalid AEP ID: "${id}" must be at least 2 characters (XX-NNNNN)`);
  }
  return id.substring(0, 2);
}

// ---------------------------------------------------------------------------
// Registry Parser
// YAML registry files mix metadata keys (aep_version, schema_revision,
// forbidden_patterns) with element entries (CP-00001, PN-00001 etc).
// This function strips metadata and returns only typed entries.
// ---------------------------------------------------------------------------

const REGISTRY_META_KEYS = new Set(["aep_version", "schema_revision", "forbidden_patterns"]);

export function parseRegistryYAML(raw: Record<string, any>): {
  entries: Record<string, AEPRegistryEntry>;
  aep_version: string;
  schema_revision: number;
} {
  const entries: Record<string, AEPRegistryEntry> = {};
  let aep_version = "1.1";
  let schema_revision = 1;

  for (const [key, value] of Object.entries(raw)) {
    if (key === "aep_version") {
      aep_version = String(value);
    } else if (key === "schema_revision") {
      schema_revision = Number(value);
    } else if (!REGISTRY_META_KEYS.has(key) && typeof value === "object" && value !== null) {
      entries[key] = value as AEPRegistryEntry;
    }
  }

  return { entries, aep_version, schema_revision };
}

// ---------------------------------------------------------------------------
// Loader (Node.js filesystem)
// ---------------------------------------------------------------------------

export function loadAEPConfigs(configDir: string): AEPConfig {
  const scene = JSON.parse(
    fs.readFileSync(nodepath.resolve(configDir, "aep-scene.json"), "utf-8"),
  ) as AEPScene;

  const registryRaw = jsyaml.load(
    fs.readFileSync(nodepath.resolve(configDir, "aep-registry.yaml"), "utf-8"),
  ) as Record<string, any>;

  const theme = jsyaml.load(
    fs.readFileSync(nodepath.resolve(configDir, "aep-theme.yaml"), "utf-8"),
  ) as AEPTheme;

  const parsed = parseRegistryYAML(registryRaw);

  return {
    scene,
    registry: parsed.entries,
    theme,
    meta: { reg_aep_version: parsed.aep_version, reg_schema_revision: parsed.schema_revision },
  };
}

// ---------------------------------------------------------------------------
// Loader (Browser fetch)
// ---------------------------------------------------------------------------

export async function loadAEPConfigsBrowser(paths: {
  scene: string;
  registry: string;
  theme: string;
}): Promise<AEPConfig> {
  const [sceneRaw, registryText, themeText] = await Promise.all([
    fetch(paths.scene).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch scene: ${r.status}`);
      return r.json();
    }),
    fetch(paths.registry).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch registry: ${r.status}`);
      return r.text();
    }),
    fetch(paths.theme).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch theme: ${r.status}`);
      return r.text();
    }),
  ]);

  const registryRaw = jsyaml.load(registryText) as Record<string, any>;
  const theme = jsyaml.load(themeText) as AEPTheme;
  const parsed = parseRegistryYAML(registryRaw);

  return {
    scene: sceneRaw as AEPScene,
    registry: parsed.entries,
    theme,
    meta: { reg_aep_version: parsed.aep_version, reg_schema_revision: parsed.schema_revision },
  };
}

// ---------------------------------------------------------------------------
// Style Resolver
// ---------------------------------------------------------------------------

export function resolveStyles(
  skinBinding: string,
  theme: AEPTheme,
): Record<string, any> {
  const block = theme.component_styles[skinBinding];
  if (!block) return {};
  return resolveTemplateVars(block, theme);
}

function resolveTemplateVars(
  obj: Record<string, any>,
  theme: AEPTheme,
): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.includes("{")) {
      result[key] = value.replace(/\{([^}]+)\}/g, (_, p) => resolvePath(theme, p));
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => {
        if (typeof item === "string" && item.includes("{")) {
          return item.replace(/\{([^}]+)\}/g, (_, p) => resolvePath(theme, p));
        }
        if (typeof item === "object" && item !== null) {
          return resolveTemplateVars(item, theme);
        }
        return item;
      });
    } else if (typeof value === "object" && value !== null) {
      result[key] = resolveTemplateVars(value, theme);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function resolvePath(obj: any, dotPath: string): string {
  let current = obj;
  for (const part of dotPath.split(".")) {
    if (current == null) return "";
    current = current[part];
  }
  return String(current ?? "");
}

// ---------------------------------------------------------------------------
// AOT Validator (full structural proof at build time)
// ---------------------------------------------------------------------------

export function validateAOT(
  config: AEPConfig,
  memory?: import("./sdk-aep-memory").MemoryFabric,
): AEPValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { scene, registry, theme, meta } = config;

  // --- Version consistency ---
  if (scene.aep_version !== meta.reg_aep_version) {
    errors.push(`Version mismatch: scene=${scene.aep_version} registry=${meta.reg_aep_version}`);
  }
  if (scene.aep_version !== theme.aep_version) {
    errors.push(`Version mismatch: scene=${scene.aep_version} theme=${theme.aep_version}`);
  }

  // --- Schema revision consistency ---
  if (scene.schema_revision !== meta.reg_schema_revision) {
    errors.push(`Schema revision mismatch: scene=${scene.schema_revision} registry=${meta.reg_schema_revision}`);
  }
  if (scene.schema_revision !== theme.schema_revision) {
    errors.push(`Schema revision mismatch: scene=${scene.schema_revision} theme=${theme.schema_revision}`);
  }

  for (const [id, el] of Object.entries(scene.elements)) {
    // --- Registry entry exists ---
    if (!registry[id] && !isTemplateInstance(id, registry)) {
      errors.push(`Orphan element: ${id} exists in scene but not in registry`);
    }

    // --- Parent exists ---
    if (el.parent && !scene.elements[el.parent]) {
      errors.push(`${id} references non-existent parent ${el.parent}`);
    }

    // --- Z-band compliance ---
    const prefix = prefixFromId(id);
    const [minZ, maxZ] = zBandForPrefix(prefix);
    if (el.z < minZ || el.z > maxZ) {
      errors.push(`${id} z=${el.z} outside band ${minZ}-${maxZ}`);
    }

    // --- Children exist ---
    for (const childId of el.children) {
      if (!scene.elements[childId]) {
        errors.push(`${id} declares child ${childId} which does not exist`);
      }
    }

    // --- Bidirectional A: parent lists child, child's parent must match ---
    for (const childId of el.children) {
      const child = scene.elements[childId];
      if (child && child.parent !== id) {
        errors.push(`${childId} parent is "${child.parent}" but ${id} lists it as child`);
      }
    }

    // --- Bidirectional B: child declares parent, parent must list child ---
    if (el.parent && scene.elements[el.parent]) {
      const parentEl = scene.elements[el.parent];
      if (!parentEl.children.includes(id)) {
        errors.push(`${id} declares parent ${el.parent} but parent does not list it as child`);
      }
    }

    // --- Anchor targets exist ---
    if (el.layout?.anchors) {
      for (const [dir, anchor] of Object.entries(el.layout.anchors)) {
        const targetId = anchor.split(".")[0];
        if (targetId !== "viewport" && !scene.elements[targetId]) {
          errors.push(`${id} anchors ${dir} to non-existent ${targetId}`);
        }
      }
    }

    // --- Responsive breakpoints match declarations ---
    if (el.responsive_matrix) {
      for (const bp of Object.keys(el.responsive_matrix)) {
        if (bp !== "base" && !scene.viewport_breakpoints[bp]) {
          warnings.push(`${id} responsive_matrix uses undeclared breakpoint "${bp}"`);
        }
      }
    }
  }

  // --- Skin bindings resolve ---
  for (const [id, entry] of Object.entries(registry)) {
    if (entry.skin_binding && !theme.component_styles[entry.skin_binding]) {
      errors.push(`${id} skin_binding "${entry.skin_binding}" not found in theme`);
    }
  }

  // --- Duplicate child references ---
  const seen = new Set<string>();
  for (const el of Object.values(scene.elements)) {
    for (const ref of el.children) {
      if (seen.has(ref)) {
        errors.push(`Duplicate child reference: ${ref} appears in multiple parents`);
      }
      seen.add(ref);
    }
  }

  const result: AEPValidationResult = { valid: errors.length === 0, errors, warnings };

  // v2.0: record in memory if provided
  const fabric = memory ?? config.memory;
  if (fabric) {
    try {
      const { createMemoryEntry } = require("./sdk-aep-memory") as typeof import("./sdk-aep-memory");
      for (const elId of Object.keys(scene.elements)) {
        const entry = createMemoryEntry(
          elId,
          "ui",
          { type: scene.elements[elId].type, z: scene.elements[elId].z },
          result.valid ? "accepted" : "rejected",
          result.errors,
          ["aot_full"],
        );
        fabric.record(entry);
      }
    } catch {
      // sdk-aep-memory not available; skip recording
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// JIT Validator (single element mutation at runtime)
// ---------------------------------------------------------------------------

export function validateJIT(
  config: AEPConfig,
  elementId: string,
  change: Partial<AEPElement> & { skin_binding?: string },
  memory?: import("./sdk-aep-memory").MemoryFabric,
): AEPValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { scene, registry, theme } = config;

  // Template instances exempt (mould proven safe by AOT)
  if (isTemplateInstance(elementId, registry)) {
    return { valid: true, errors, warnings };
  }

  // Element must exist
  if (!scene.elements[elementId] && !registry[elementId]) {
    errors.push(`Unknown element: ${elementId}`);
    return { valid: false, errors, warnings };
  }

  // Z-band
  if (change.z !== undefined) {
    const prefix = prefixFromId(elementId);
    const [minZ, maxZ] = zBandForPrefix(prefix);
    if (change.z < minZ || change.z > maxZ) {
      errors.push(`${elementId} z=${change.z} outside band ${minZ}-${maxZ}`);
    }
  }

  // Parent exists
  if (change.parent !== undefined && change.parent !== null) {
    if (!scene.elements[change.parent]) {
      errors.push(`${elementId} references non-existent parent ${change.parent}`);
    }
  }

  // Skin binding resolves
  if (change.skin_binding !== undefined) {
    if (!theme.component_styles[change.skin_binding]) {
      errors.push(`${elementId} skin_binding "${change.skin_binding}" not found in theme`);
    }
  }

  // Anchor targets exist
  if (change.layout?.anchors) {
    for (const [dir, anchor] of Object.entries(change.layout.anchors)) {
      const targetId = anchor.split(".")[0];
      if (targetId !== "viewport" && !scene.elements[targetId]) {
        errors.push(`${elementId} anchors ${dir} to non-existent ${targetId}`);
      }
    }
  }

  const jitResult: AEPValidationResult = { valid: errors.length === 0, errors, warnings };

  // v2.0: record in memory if provided
  const jitFabric = memory ?? config.memory;
  if (jitFabric) {
    try {
      const { createMemoryEntry } = require("./sdk-aep-memory") as typeof import("./sdk-aep-memory");
      const entry = createMemoryEntry(
        elementId,
        "ui",
        change as Record<string, any>,
        jitResult.valid ? "accepted" : "rejected",
        jitResult.errors,
        ["jit_delta"],
      );
      jitFabric.record(entry);
    } catch {
      // sdk-aep-memory not available; skip recording
    }
  }

  return jitResult;
}

// ---------------------------------------------------------------------------
// Template Instance Check
// ---------------------------------------------------------------------------

export function isTemplateInstance(
  id: string,
  registry: Record<string, AEPRegistryEntry>,
): boolean {
  const prefix = prefixFromId(id);
  for (const entry of Object.values(registry)) {
    if (entry && typeof entry === "object" && entry.instance_prefix === prefix) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Runtime Coordinates (browser only, safe for SSR)
// ---------------------------------------------------------------------------

export interface AEPRuntimeCoordinates {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rendered_at: string;
  visible: boolean;
}

export function getRuntimeCoordinates(elementId: string): AEPRuntimeCoordinates | null {
  if (typeof document === "undefined") return null;

  const el = document.querySelector(`[data-aep-id="${elementId}"]`);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  return {
    id: elementId,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    rendered_at: getCurrentBreakpoint(),
    visible: rect.width > 0 && rect.height > 0,
  };
}

function getCurrentBreakpoint(): string {
  if (typeof window === "undefined") return "unknown";
  const w = window.innerWidth;
  if (w < 640) return "base";
  if (w < 1024) return "vp-md";
  return "vp-lg";
}

// ---------------------------------------------------------------------------
// v2.0: Re-exports from Lattice Memory and Basic Resolver
// ---------------------------------------------------------------------------

export type {
  MemoryEntry,
  MemoryFabric,
} from "./sdk-aep-memory";
export { InMemoryFabric, createMemoryEntry, cosineSimilarity } from "./sdk-aep-memory";

export type {
  ResolveRequest,
  ResolveResult,
} from "./sdk-aep-resolver";
export { BasicResolver } from "./sdk-aep-resolver";
