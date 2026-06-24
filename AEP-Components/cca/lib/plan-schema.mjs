#!/usr/bin/env node

import { validateRegulationLrpGapRefs } from "./policy-sections.mjs";
import { gapRefExists } from "./policy-system-context.mjs";
import { validateComposerTopology } from "../../../AEP-Composer-Lite/lib/hyperlattice/composer-protocol.mjs";

const PLAN_REQUIRED = [
  "plan_version",
  "created_by",
  "created_at",
  "user_intent",
  "components",
  "lrps",
  "inference",
  "topology",
  "security",
];

/**
 * @param {object} plan
 */
export function validateImplementationPlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") {
    return { valid: false, errors: ["plan must be an object"] };
  }

  for (const key of PLAN_REQUIRED) {
    if (plan[key] === undefined) errors.push(`missing plan field: ${key}`);
  }

  if (plan.plan_version !== "1") errors.push('plan_version must be "1"');

  if (!Array.isArray(plan.components)) errors.push("components must be an array");
  if (!Array.isArray(plan.lrps)) errors.push("lrps must be an array");
  if (!Array.isArray(plan.topology?.nodes)) errors.push("topology.nodes must be an array");
  if (!Array.isArray(plan.topology?.edges)) errors.push("topology.edges must be an array");

  if (plan.security?.lattice_strict !== true) {
    errors.push("security.lattice_strict must be true for AEP-conformant plans");
  }

  for (const comp of plan.components ?? []) {
    if (!comp.id) errors.push("component entry missing id");
    if (typeof comp.enabled !== "boolean") errors.push(`component ${comp.id} missing enabled boolean`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {object} plan
 * @param {object[]} registryComponents
 * @param {object} environment
 */
export function validatePlanAgainstRegistry(plan, registryComponents, environment) {
  const errors = [];
  const base = validateImplementationPlan(plan);
  errors.push(...base.errors);

  const byId = new Map(registryComponents.map((c) => [c.id, c]));

  for (const comp of plan.components ?? []) {
    if (!comp.enabled) continue;
    const reg = byId.get(comp.id);
    if (!reg) {
      errors.push(`unknown component id in plan: ${comp.id}`);
      continue;
    }
    const req = reg.resource_requirements ?? reg.manifest?.resource_requirements;
    if (req && environment) {
      if (req.min_memory_mb > environment.memory_total_mb) {
        errors.push(
          `${comp.id} requires ${req.min_memory_mb}MB RAM but environment has ${environment.memory_total_mb}MB`,
        );
      }
      if (req.gpu_required && !environment.gpu?.present) {
        errors.push(`${comp.id} requires GPU but none detected`);
      }
    }
  }

  for (const edge of plan.topology?.edges ?? []) {
    if (edge.transport === "raw_http" || edge.bypass_lattice === true) {
      errors.push(`edge ${edge.from}->${edge.to} violates lattice channel policy`);
    }
  }

  const topo = validateComposerTopology(plan.topology ?? {});
  if (!topo.valid) {
    errors.push(...topo.errors);
  }

  errors.push(...validateRegulationLrpGapRefs(plan.lrps ?? []));

  for (const ref of plan.policy_overrides?.gap?.reference_policies ?? []) {
    if (!gapRefExists(ref)) {
      errors.push(`gap reference policy not found: ${ref}`);
    }
  }

  for (const mod of plan.policy_overrides?.regulation_lrps?.modules ?? []) {
    if (mod.gap_ref && !gapRefExists(mod.gap_ref)) {
      errors.push(`regulation LRP gap_ref not found: ${mod.lrp_id} -> ${mod.gap_ref}`);
    }
  }

  return { valid: errors.length === 0, errors };
}