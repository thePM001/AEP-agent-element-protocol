#!/usr/bin/env node
// @ts-check

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

/** @typedef {Record<string, unknown>} Json */

/**
 * @typedef {object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 */

const REQUIRED_TOP = [
  "manifest_version",
  "id",
  "version",
  "kind",
  "path",
  "description",
  "requires",
  "capabilities",
  "actions",
  "setup_hooks",
  "resource_requirements",
  "cca",
  "implementation",
];

const RESOURCE_KEYS = ["min_memory_mb", "min_disk_mb", "requires_internet", "gpu_required"];
const STATUSES = new Set(["active", "experimental", "retired"]);
const CCA_KEYS = ["summary", "use_when", "avoid_when"];

/**
 * @param {unknown} v
 * @returns {v is Json}
 */
export function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {unknown[]}
 */
function list(v) {
  return Array.isArray(v) ? v : [];
}

/** @param {unknown} v */
function show(v) {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * Whether a repository relative path exists inside the repository. An
 * absolute path or a path whose parent steps leave the repository fails even
 * when something sits at its target.
 * @param {string} repoRoot
 * @param {string} relPath
 */
export function existsInside(repoRoot, relPath) {
  if (isAbsolute(relPath)) return false;
  const root = resolve(repoRoot);
  const abs = resolve(root, relPath);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;
  return existsSync(abs);
}

/**
 * Find a requires cycle that leads back to id. Returns the cycle as a path
 * that starts and ends at id, or null.
 * @param {string} id
 * @param {string[]} requires
 * @param {Map<string, string[]> | undefined} index
 * @returns {string[] | null}
 */
export function detectRequiresCycle(id, requires, index) {
  if (!index) return null;
  const path = [id];
  /** @type {Set<string>} */
  const visited = new Set();

  /**
   * @param {string} node
   * @returns {string[] | null}
   */
  function dfs(node) {
    if (node === id) return [...path, id];
    if (visited.has(node)) return null;
    visited.add(node);
    path.push(node);
    for (const dep of index?.get(node) ?? []) {
      const hit = dfs(dep);
      if (hit) return hit;
    }
    path.pop();
    return null;
  }

  for (const req of requires) {
    const hit = dfs(req);
    if (hit) return hit;
  }
  return null;
}

/**
 * Validate one component manifest.
 * @param {unknown} manifest
 * @param {{ repoRoot?: string | undefined, manifestIndex?: Map<string, string[]> }} [opts]
 * @returns {ValidationResult}
 */
export function validateManifest(manifest, opts = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isObject(manifest)) {
    return { valid: false, errors: ["manifest must be an object"] };
  }

  if (manifest.manifest_version !== "1") {
    errors.push('manifest_version must be "1"');
  }

  // A retired component keeps its id but ships nothing, so it has no path on
  // disk and offers no action, setup hook or implementation.
  const retired = manifest.status === "retired";
  if (manifest.status !== undefined && !(typeof manifest.status === "string" && STATUSES.has(manifest.status))) {
    errors.push(`status must be one of ${[...STATUSES].join(", ")}`);
  }
  for (const key of REQUIRED_TOP) {
    if (retired && key === "path") continue;
    if (manifest[key] === undefined || manifest[key] === null) {
      errors.push(`missing required field: ${key}`);
    }
  }
  if (retired) {
    if (manifest.path !== undefined) errors.push("a retired component has no path");
    if (list(manifest.actions).length > 0) errors.push("a retired component offers no actions");
    if (list(manifest.setup_hooks).length > 0) errors.push("a retired component has no setup hooks");
    if (isObject(manifest.implementation) && Object.keys(manifest.implementation).length > 0) {
      errors.push("a retired component has no implementation");
    }
  }

  if (manifest.id !== undefined && (typeof manifest.id !== "string" || manifest.id.length === 0)) {
    errors.push("id must be a non-empty string");
  }

  if (!Array.isArray(manifest.requires)) errors.push("requires must be an array");
  if (!Array.isArray(manifest.capabilities)) errors.push("capabilities must be an array");
  if (!Array.isArray(manifest.actions)) errors.push("actions must be an array");
  if (!Array.isArray(manifest.setup_hooks)) errors.push("setup_hooks must be an array");

  const resources = manifest.resource_requirements;
  if (isObject(resources)) {
    for (const key of RESOURCE_KEYS) {
      if (resources[key] === undefined) errors.push(`resource_requirements.${key} is required`);
    }
  }

  const cca = manifest.cca;
  if (isObject(cca)) {
    for (const key of CCA_KEYS) {
      if (cca[key] === undefined) errors.push(`cca.${key} is required`);
    }
    if (cca.use_when !== undefined && !Array.isArray(cca.use_when)) errors.push("cca.use_when must be an array");
    if (cca.avoid_when !== undefined && !Array.isArray(cca.avoid_when)) errors.push("cca.avoid_when must be an array");
  }

  for (const action of list(manifest.actions)) {
    if (!isObject(action) || !action.id || !action.description) {
      errors.push(`action missing id or description: ${JSON.stringify(action)}`);
    }
  }

  for (const hook of list(manifest.setup_hooks)) {
    if (!isObject(hook) || !hook.id) errors.push(`setup_hook missing id: ${JSON.stringify(hook)}`);
  }

  /** @type {string[]} */
  const requires = [];
  for (const req of list(manifest.requires)) {
    if (typeof req !== "string" || req.length === 0) {
      errors.push(`requires entry must be non-empty string: ${JSON.stringify(req)}`);
    } else {
      requires.push(req);
    }
  }

  if (typeof manifest.id === "string" && manifest.id.length > 0 && requires.length > 0) {
    const cycle = detectRequiresCycle(manifest.id, requires, opts.manifestIndex);
    if (cycle) errors.push(`requires cycle detected: ${cycle.join(" -> ")}`);
  }

  const isTemplate = manifest.kind === "template";
  if (!isTemplate && opts.repoRoot && typeof manifest.path === "string") {
    if (!existsInside(opts.repoRoot, manifest.path)) {
      errors.push(`path does not exist inside the repository: ${manifest.path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate one catalog entry against its manifest.
 * @param {unknown} catalogEntry
 * @param {unknown} manifest
 * @param {string} [repoRoot]
 * @param {Map<string, string[]>} [manifestIndex]
 * @returns {ValidationResult}
 */
export function validateCatalogEntry(catalogEntry, manifest, repoRoot, manifestIndex) {
  /** @type {string[]} */
  const errors = [];
  const entry = isObject(catalogEntry) ? catalogEntry : {};
  const id = show(entry.id);

  if (!entry.id) errors.push("catalog entry missing id");
  if (!entry.manifest) errors.push(`catalog entry ${id} missing manifest path`);

  const retired = entry.status === "retired";
  if (retired) {
    if (entry.path !== undefined) errors.push(`retired catalog entry ${id} has a path`);
    if (entry.bundled !== false || entry.default_enabled !== false) {
      errors.push(`retired catalog entry ${id} must set bundled and default_enabled to false`);
    }
    if (isObject(manifest) && manifest.status !== "retired") {
      errors.push(`retired catalog entry ${id} needs a retired manifest`);
    }
  } else if (entry.kind !== "template" && !entry.path) {
    errors.push(`catalog entry ${id} missing path`);
  }

  if (typeof entry.path === "string" && repoRoot && !existsInside(repoRoot, entry.path)) {
    errors.push(`catalog path does not exist inside the repository: ${entry.path}`);
  }

  if (!isObject(manifest)) {
    errors.push(`manifest not loaded for ${id}`);
    return { valid: false, errors };
  }

  if (manifest.id !== entry.id) {
    errors.push(`manifest id ${show(manifest.id)} != catalog id ${id}`);
  }

  errors.push(...validateManifest(manifest, { repoRoot, ...(manifestIndex ? { manifestIndex } : {}) }).errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate every component of a catalog. Each entry is checked once, with the
 * requires index of the whole catalog, so a cycle between two components is
 * found.
 * @param {unknown} catalog
 * @param {string} repoRoot
 * @param {(path: string) => unknown} loadManifest
 */
export function validateFullCatalog(catalog, repoRoot, loadManifest) {
  const components = isObject(catalog) ? list(catalog.components).filter(isObject) : [];

  /** @type {Map<string, unknown>} */
  const loaded = new Map();
  /** @param {Json} entry */
  const manifestOf = (entry) => {
    if (typeof entry.manifest !== "string" || entry.manifest.length === 0) return null;
    if (!loaded.has(entry.manifest)) loaded.set(entry.manifest, loadManifest(entry.manifest));
    return loaded.get(entry.manifest) ?? null;
  };

  /** @type {Map<string, string[]>} */
  const manifestIndex = new Map();
  for (const entry of components) {
    const manifest = manifestOf(entry);
    if (isObject(manifest) && typeof manifest.id === "string" && Array.isArray(manifest.requires)) {
      manifestIndex.set(manifest.id, manifest.requires.filter((r) => typeof r === "string"));
    }
  }

  /** @type {Set<unknown>} */
  const catalogIds = new Set(components.map((c) => c.id));
  /** @type {Set<unknown>} */
  const seenIds = new Set();

  /** @type {{ id: unknown, valid: boolean, errors: string[] }[]} */
  const results = [];
  for (const entry of components) {
    const manifest = manifestOf(entry);
    let r;
    if (entry.bundled === false && entry.kind === "template") {
      // A template ships no path, but its manifest must still load and hold.
      r = isObject(manifest)
        ? validateManifest(manifest, { repoRoot, manifestIndex })
        : { valid: false, errors: [`manifest not loaded for template ${show(entry.id)}`] };
    } else {
      r = validateCatalogEntry(entry, manifest, repoRoot, manifestIndex);
    }
    const errors = [...r.errors];
    if (seenIds.has(entry.id)) errors.push(`catalog id ${show(entry.id)} appears twice`);
    seenIds.add(entry.id);
    // Every requires entry must name a component of this catalog.
    if (isObject(manifest)) {
      for (const req of list(manifest.requires)) {
        if (typeof req === "string" && req.length > 0 && !catalogIds.has(req)) {
          errors.push(`${show(entry.id)} requires ${req}, which no catalog row names`);
        }
      }
    }
    results.push({ id: entry.id, valid: errors.length === 0, errors });
  }
  const invalid = results.filter((r) => !r.valid);
  return {
    valid: invalid.length === 0,
    total: results.length,
    invalid,
    results,
  };
}
