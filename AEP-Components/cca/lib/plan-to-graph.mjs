#!/usr/bin/env node

/**
 * Convert ImplementationPlan topology to Composer Lite graph document.
 * @param {object} plan
 */
export function planToGraph(plan) {
  return {
    version: "2.8.0",
    composer: "composer-lite",
    updated_at: new Date().toISOString(),
    plan_id: plan.created_at,
    user_intent: plan.user_intent,
    nodes: (plan.topology?.nodes ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label ?? n.id,
      x: n.x ?? 0,
      y: n.y ?? 0,
      data: n.data ?? {},
    })),
    edges: (plan.topology?.edges ?? []).map((e) => ({
      id: e.id ?? `e-${e.from}-${e.to}`,
      from: e.from,
      to: e.to,
      data: { channel: e.channel ?? "lattice-channel-default" },
    })),
    viewport: { x: 0, y: 0, scale: 1 },
  };
}