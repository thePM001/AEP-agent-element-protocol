#!/usr/bin/env node

/**
 * Collect and apply manifest setup_hooks for plan execution.
 */

/**
 * @param {string[]} componentIds
 * @param {object[]} components - registry components with merged manifest
 */
export function collectSetupHooks(componentIds, components) {
  const hooks = [];
  const lrps = new Set();
  const policySections = {};

  for (const id of componentIds) {
    const comp = components.find((c) => c.id === id);
    if (!comp) continue;

    if (comp.lrp_id) lrps.add(comp.lrp_id);
    if (comp.manifest?.lrp_id) lrps.add(comp.manifest.lrp_id);

    for (const hook of comp.manifest?.setup_hooks ?? []) {
      hooks.push({ component_id: id, ...hook });

      if (hook.setup_hook === "sync_lrp" && hook.params?.lrp_id) {
        lrps.add(hook.params.lrp_id);
      }

      if (hook.policy_section) {
        policySections[hook.policy_section] = {
          ...(policySections[hook.policy_section] ?? {}),
          ...(hook.default ?? {}),
        };
      }
    }

    for (const action of comp.manifest?.actions ?? []) {
      if (action.setup_hook === "sync_lrp" && action.params?.lrp_id) {
        lrps.add(action.params.lrp_id);
      }
    }
  }

  return {
    hooks,
    lrps: [...lrps],
    policy_sections: policySections,
  };
}

/**
 * Merge plan policy overrides into collected policy sections.
 * @param {object} collected
 * @param {object} [planOverrides]
 */
export function mergePolicySections(collected, planOverrides = {}) {
  return {
    ...collected,
    ...(planOverrides ?? {}),
  };
}

/**
 * Extract enabled component ids from an ImplementationPlan.
 * @param {object} plan
 */
export function componentIdsFromPlan(plan) {
  return (plan.components ?? [])
    .filter((c) => c.enabled)
    .map((c) => c.id);
}

/**
 * Build connector extension block for base-node.json from plan.
 * @param {object} plan
 */
export function connectorsFromPlan(plan) {
  const connectors = {};
  for (const comp of plan.components ?? []) {
    if (!comp.enabled || !comp.config) continue;
    if (comp.id.startsWith("connector-")) {
      connectors[comp.id] = comp.config;
    }
  }
  if (plan.connectors && typeof plan.connectors === "object") {
    Object.assign(connectors, plan.connectors);
  }
  return connectors;
}