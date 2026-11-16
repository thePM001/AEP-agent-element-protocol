#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join } from "node:path";

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
 * @param {string} id
 * @param {string[]} requires
 * @param {Map<string, string[]>|undefined} index
 */
function detectRequiresCycle(id, requires, index) {
  if (!index || typeof id !== "string") return null;
  const path = [id];

  function dfs(node, ancestry) {
    if (node === id && ancestry.size > 0) {
      return [...path, id];
    }
    if (ancestry.has(node)) return null;
    ancestry.add(node);
    path.push(node);
    for (const dep of index.get(node) ?? []) {
      const hit = dfs(dep, ancestry);
      if (hit) return hit;
    }
    path.pop();
    ancestry.delete(node);
    return null;
  }

  for (const req of requires) {
    const hit = dfs(req, new Set());
    if (hit) return hit;
  }
  return null;
}

/**
 * @param {object} manifest
 * @param {{ repoRoot?: string, allowTemplate?: boolean, manifestIndex?: Map<string, string[]> }} [opts]
 */
export function validateManifest(manifest, opts = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be an object"] };
  }

  if (manifest.manifest_version !== "1") {
    errors.push('manifest_version must be "1"');
  }

  // A retired component keeps its id but ships nothing, so it has no path on
  // disk and offers no action, setup hook or implementation.
  const retired = manifest.status === "retired";
  if (manifest.status !== undefined && !STATUSES.has(manifest.status)) {
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
    if (Array.isArray(manifest.actions) && manifest.actions.length > 0) {
      errors.push("a retired component offers no actions");
    }
    if (Array.isArray(manifest.setup_hooks) && manifest.setup_hooks.length > 0) {
      errors.push("a retired component has no setup hooks");
    }
    if (manifest.implementation && Object.keys(manifest.implementation).length > 0) {
      errors.push("a retired component has no implementation");
    }
  }

  if (typeof manifest.id === "string" && manifest.id.length === 0) {
    errors.push("id must be non-empty");
  }

  if (!Array.isArray(manifest.requires)) errors.push("requires must be an array");
  if (!Array.isArray(manifest.capabilities)) errors.push("capabilities must be an array");
  if (!Array.isArray(manifest.actions)) errors.push("actions must be an array");
  if (!Array.isArray(manifest.setup_hooks)) errors.push("setup_hooks must be an array");

  if (manifest.resource_requirements && typeof manifest.resource_requirements === "object") {
    for (const key of RESOURCE_KEYS) {
      if (manifest.resource_requirements[key] === undefined) {
        errors.push(`resource_requirements.${key} is required`);
      }
    }
  }

  if (manifest.cca && typeof manifest.cca === "object") {
    for (const key of CCA_KEYS) {
      if (manifest.cca[key] === undefined) {
        errors.push(`cca.${key} is required`);
      }
    }
    if (manifest.cca.use_when && !Array.isArray(manifest.cca.use_when)) {
      errors.push("cca.use_when must be an array");
    }
    if (manifest.cca.avoid_when && !Array.isArray(manifest.cca.avoid_when)) {
      errors.push("cca.avoid_when must be an array");
    }
  }

  for (const action of manifest.actions ?? []) {
    if (!action?.id || !action?.description) {
      errors.push(`action missing id or description: ${JSON.stringify(action)}`);
    }
  }

  for (const hook of manifest.setup_hooks ?? []) {
    if (!hook?.id) errors.push(`setup_hook missing id: ${JSON.stringify(hook)}`);
  }

  for (const req of manifest.requires ?? []) {
    if (typeof req !== "string" || req.length === 0) {
      errors.push(`requires entry must be non-empty string: ${JSON.stringify(req)}`);
    }
  }

  if (Array.isArray(manifest.requires) && manifest.requires.length > 0) {
    const cycle = detectRequiresCycle(manifest.id, manifest.requires, opts.manifestIndex);
    if (cycle) errors.push(`requires cycle detected: ${cycle.join(" -> ")}`);
  }

  const isTemplate = manifest.kind === "template";
  if (!isTemplate && opts.repoRoot && typeof manifest.path === "string") {
    const abs = join(opts.repoRoot, manifest.path);
    if (!existsSync(abs)) {
      errors.push(`path does not exist on disk: ${manifest.path}`);
    }
  }

  if (manifest.id && manifest.manifest?.id && manifest.id !== manifest.manifest.id) {
    /* no-op guard */
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} catalogEntry
 * @param {object|null} manifest
 * @param {string} [repoRoot]
 */
export function validateCatalogEntry(catalogEntry, manifest, repoRoot) {
  const errors = [];

  if (!catalogEntry?.id) errors.push("catalog entry missing id");
  if (!catalogEntry?.manifest) errors.push(`catalog entry ${catalogEntry?.id} missing manifest path`);

  const retired = catalogEntry?.status === "retired";
  if (retired) {
    if (catalogEntry.path !== undefined) errors.push(`retired catalog entry ${catalogEntry.id} has a path`);
    if (catalogEntry.bundled !== false || catalogEntry.default_enabled !== false) {
      errors.push(`retired catalog entry ${catalogEntry.id} must set bundled and default_enabled to false`);
    }
    if (manifest && manifest.status !== "retired") {
      errors.push(`retired catalog entry ${catalogEntry.id} needs a retired manifest`);
    }
  } else if (catalogEntry?.kind !== "template" && !catalogEntry?.path) {
    errors.push(`catalog entry ${catalogEntry?.id} missing path`);
  }

  if (catalogEntry?.path && repoRoot && !existsSync(join(repoRoot, catalogEntry.path))) {
    errors.push(`catalog path does not exist: ${catalogEntry.path}`);
  }

  if (!manifest) {
    errors.push(`manifest not loaded for ${catalogEntry?.id}`);
    return { valid: false, errors };
  }

  if (manifest.id && catalogEntry.id && manifest.id !== catalogEntry.id) {
    errors.push(`manifest id ${manifest.id} != catalog id ${catalogEntry.id}`);
  }

  const manifestResult = validateManifest(manifest, { repoRoot });
  errors.push(...manifestResult.errors);

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} catalog
 * @param {string} repoRoot
 * @param {(path: string) => object|null} loadManifest
 */
export function validateFullCatalog(catalog, repoRoot, loadManifest) {
  const manifestIndex = new Map();
  for (const entry of catalog.components ?? []) {
    const manifest = entry.manifest ? loadManifest(entry.manifest) : null;
    if (manifest?.id && Array.isArray(manifest.requires)) {
      manifestIndex.set(manifest.id, manifest.requires);
    }
  }

  const results = [];
  for (const entry of catalog.components ?? []) {
    if (entry.bundled === false && entry.kind === "template") {
      const manifest = entry.manifest ? loadManifest(entry.manifest) : null;
      if (manifest) {
        const r = validateManifest(manifest, { repoRoot, allowTemplate: true });
        results.push({ id: entry.id, valid: r.valid, errors: r.errors });
      }
      continue;
    }
    const manifest = entry.manifest ? loadManifest(entry.manifest) : null;
    const r = validateCatalogEntry(entry, manifest, repoRoot);
    if (manifest) {
      const cycleCheck = validateManifest(manifest, { repoRoot, manifestIndex });
      if (!cycleCheck.valid) {
        r.errors.push(...cycleCheck.errors.filter((e) => e.includes("cycle") || e.includes("requires")));
        r.valid = r.errors.length === 0;
      }
    }
    results.push({ id: entry.id, valid: r.valid, errors: r.errors });
  }
  const invalid = results.filter((r) => !r.valid);
  return {
    valid: invalid.length === 0,
    total: results.length,
    invalid,
    results,
  };
}