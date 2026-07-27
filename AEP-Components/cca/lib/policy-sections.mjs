#!/usr/bin/env node

import { loadLrpCatalog } from "../../wizard/lib/lrp.mjs";
import {
  resolveComplianceModulesForLrps,
  gapRefExists,
  POLICY_SYSTEM_ROOT,
} from "./policy-system-context.mjs";

/**
 * Build policy_sections for base-node.json from plan overrides and enabled LRPs.
 * @param {object} plan
 * @param {object} mergedSections - from mergePolicySections
 * @param {string[]} lrps
 */
export function buildRegulationPolicySections(plan, mergedSections, lrps) {
  const sections = { ...mergedSections };
  const catalog = loadLrpCatalog();

  const modules =
    plan.policy_overrides?.regulation_lrps?.modules
    ?? resolveComplianceModulesForLrps(lrps, catalog);

  if (modules.length) {
    sections.regulation_lrps = {
      enabled: true,
      modules: modules.map((m) => ({
        lrp_id: m.lrp_id,
        gap_ref: m.gap_ref,
        framework: m.framework,
        jurisdiction: m.jurisdiction ?? null,
        dock: m.dock ?? "regulation_module",
      })),
    };
    for (const mod of modules) {
      sections[mod.lrp_id] = {
        enabled: true,
        gap_ref: mod.gap_ref,
        framework: mod.framework,
        dock: mod.dock ?? "regulation_module",
      };
    }
  }

  if (plan.policy_overrides?.gap) {
    sections.gap = {
      ...(sections.gap ?? {}),
      ...plan.policy_overrides.gap,
      policy_system_root: POLICY_SYSTEM_ROOT,
    };
  }

  if (plan.policy_overrides?.hyperlattice) {
    sections.hyperlattice = plan.policy_overrides.hyperlattice;
    if (plan.policy_overrides.hyperlattice.policy_lattice) {
      sections.policy_lattice = plan.policy_overrides.hyperlattice.policy_lattice;
    }
    if (plan.policy_overrides.hyperlattice.dynaep) {
      sections.dynaep = plan.policy_overrides.hyperlattice.dynaep;
    }
  } else {
    if (plan.policy_overrides?.policy_lattice) {
      sections.policy_lattice = plan.policy_overrides.policy_lattice;
    }
    if (plan.policy_overrides?.dynaep) {
      sections.dynaep = plan.policy_overrides.dynaep;
    }
  }

  return sections;
}

/**
 * @param {string[]} lrps
 * @param {object} [catalog]
 */
export function validateRegulationLrpGapRefs(lrps, catalog = loadLrpCatalog()) {
  const errors = [];
  const modules = resolveComplianceModulesForLrps(lrps, catalog);
  for (const mod of modules) {
    if (!gapRefExists(mod.gap_ref)) {
      errors.push(`missing gap_ref file for LRP ${mod.lrp_id}: ${mod.gap_ref}`);
    }
  }
  return errors;
}