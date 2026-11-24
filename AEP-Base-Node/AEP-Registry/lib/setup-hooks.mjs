#!/usr/bin/env node
// @ts-check

import { existsSync } from "node:fs";
import path from "node:path";

/** @typedef {Record<string, unknown>} Json */

/**
 * @typedef {object} HookComponent
 * @property {string} id
 * @property {string} [lrp_id]
 * @property {Json | null} [manifest]
 */

/**
 * @typedef {object} CollectedHooks
 * @property {Json[]} hooks
 * @property {string[]} lrps
 * @property {Record<string, Json>} policy_sections
 */

/**
 * @param {unknown} v
 * @returns {v is Json}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {unknown} v
 * @returns {Json[]}
 */
function objects(v) {
  return Array.isArray(v) ? v.filter(isObject) : [];
}

/**
 * Validate EU AI Act control pack is present on disk (wizard / plan enable).
 * @param {string} repoRoot
 */
export function validateEuAiActPack(repoRoot) {
  // ONE definition file only
  const pack = path.join(repoRoot, "AEP-Components/eu-ai-act-checker/EU-AI-ACT-PACK.json");
  const ok = existsSync(pack);
  return { ok, missing: ok ? [] : ["EU-AI-ACT-PACK.json"], pack };
}

/**
 * Collect the setup hooks, the LRP ids and the policy section defaults of the
 * named components for plan execution.
 * @param {string[]} componentIds
 * @param {HookComponent[]} components - registry components with merged manifest
 * @returns {CollectedHooks}
 */
export function collectSetupHooks(componentIds, components) {
  /** @type {Json[]} */
  const hooks = [];
  /** @type {Set<string>} */
  const lrps = new Set();
  /** @type {Map<string, Json>} */
  const policySections = new Map();

  /** @param {Json} item */
  const lrpOfSync = (item) => {
    const params = item.params;
    if (item.setup_hook === "sync_lrp" && isObject(params) && typeof params.lrp_id === "string") {
      lrps.add(params.lrp_id);
    }
  };

  for (const id of componentIds) {
    const comp = components.find((c) => c.id === id);
    if (!comp) continue;
    const manifest = isObject(comp.manifest) ? comp.manifest : {};

    if (typeof comp.lrp_id === "string") lrps.add(comp.lrp_id);
    if (typeof manifest.lrp_id === "string") lrps.add(manifest.lrp_id);

    for (const hook of objects(manifest.setup_hooks)) {
      hooks.push({ component_id: id, ...hook });
      lrpOfSync(hook);
      if (typeof hook.policy_section === "string" && hook.policy_section.length > 0) {
        policySections.set(hook.policy_section, {
          ...(policySections.get(hook.policy_section) ?? {}),
          ...(isObject(hook.default) ? hook.default : {}),
        });
      }
    }

    for (const action of objects(manifest.actions)) lrpOfSync(action);
  }

  return {
    hooks,
    lrps: [...lrps],
    policy_sections: Object.fromEntries(policySections),
  };
}

/**
 * Merge plan policy overrides into collected policy sections. An override of
 * a section merges into it key by key, so the component defaults that the
 * plan does not name stay in force.
 * @param {Record<string, Json>} collected
 * @param {Record<string, unknown> | null} [planOverrides]
 * @returns {Record<string, unknown>}
 */
export function mergePolicySections(collected, planOverrides = {}) {
  /** @type {Map<string, unknown>} */
  const merged = new Map(Object.entries(collected));
  for (const [section, override] of Object.entries(planOverrides ?? {})) {
    const base = merged.get(section);
    merged.set(section, isObject(base) && isObject(override) ? { ...base, ...override } : override);
  }
  return Object.fromEntries(merged);
}

/**
 * Extract enabled component ids from an ImplementationPlan.
 * @param {unknown} plan
 * @returns {string[]}
 */
export function componentIdsFromPlan(plan) {
  const components = isObject(plan) ? objects(plan.components) : [];
  return components
    .filter((c) => c.enabled === true && typeof c.id === "string")
    .map((c) => String(c.id));
}

/**
 * Build connector extension block for base-node.json from plan.
 * @param {unknown} plan
 * @returns {Record<string, unknown>}
 */
export function connectorsFromPlan(plan) {
  /** @type {Record<string, unknown>} */
  const connectors = {};
  if (!isObject(plan)) return connectors;
  for (const comp of objects(plan.components)) {
    if (comp.enabled !== true || !comp.config || typeof comp.id !== "string") continue;
    if (comp.id.startsWith("connector-")) connectors[comp.id] = comp.config;
  }
  if (isObject(plan.connectors)) Object.assign(connectors, plan.connectors);
  return connectors;
}
