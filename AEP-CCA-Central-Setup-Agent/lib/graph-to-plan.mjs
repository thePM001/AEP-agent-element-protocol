#!/usr/bin/env node

import { componentIdsFromGraph } from "./component-catalog.mjs";
import { applyAllPolicyOverrides } from "./plan-generator.mjs";
import { syncLrpsFromComponents } from "../../../AEP-Base-Node/registry/lib/registry.mjs";

/**
 * Merge Composer graph edits into an existing ImplementationPlan.
 * Syncs topology and component enablement from graph nodes.
 * @param {object} plan
 * @param {object} graph
 * @param {object[]} [registryComponents]
 * @param {object} [context] - registry context for policy resync
 */
export function graphToPlan(plan, graph, registryComponents = [], context = null) {
  const graphIds = componentIdsFromGraph(graph, registryComponents);
  const existingById = new Map((plan.components ?? []).map((c) => [c.id, c]));

  let components = plan.components ?? [];
  if (registryComponents.length) {
    components = registryComponents
      .map((reg) => {
        const prev = existingById.get(reg.id);
        const fromGraph = graphIds.has(reg.id);
        const enabled = fromGraph || prev?.enabled || reg.default_enabled;
        if (!enabled) return null;
        return {
          id: reg.id,
          enabled: true,
          reason: prev?.reason ?? (fromGraph ? "Enabled via Composer graph" : undefined),
          config: prev?.config,
        };
      })
      .filter(Boolean);
  } else if (graphIds.size) {
    const merged = new Map(existingById);
    for (const id of graphIds) {
      merged.set(id, { id, enabled: true, reason: "Enabled via Composer graph" });
    }
    components = [...merged.values()].filter((c) => c.enabled);
  }

  const enabledIds = components.filter((c) => c.enabled).map((c) => c.id);
  let lrps = syncLrpsFromComponents(
    enabledIds,
    registryComponents,
    [...new Set(plan.lrps ?? [])],
  );

  const next = {
    ...plan,
    updated_at: new Date().toISOString(),
    components,
    lrps,
    topology: {
      nodes: (graph.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        x: n.x,
        y: n.y,
        data: n.data ?? {},
      })),
      edges: (graph.edges ?? []).map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        channel: e.data?.channel ?? e.channel ?? "lattice-channel-default",
      })),
    },
  };

  if (context) {
    applyAllPolicyOverrides(next, context);
  }

  return next;
}