#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGraph } from "../../../AEP-Composer-Lite/lib/graph-store.mjs";
import yaml from "yaml";
import { buildPolicyLatticeView } from "../../../AEP-Composer-Lite/lib/policy-lattice.mjs";
import { buildDynaepPolicyOverrides, loadDynaepContext } from "../../../AEP-Components/cca/lib/dynaep-context.mjs";
import { loadPolicySystemContext } from "../../../AEP-Components/cca/lib/policy-system-context.mjs";
import {
  buildComposerProtocolSpec,
  validateComposerTopology,
} from "./composer-protocol.mjs";
import { loadCcaGapPolicies } from "./gap-constrained-engine.mjs";
import { COMPOSER_CCA_LATTICE_REGISTRY } from "./paths.mjs";

/** Canonical topology identifier for the one AEP Hyperlattice mechanism. */
export const HYPERLATTICE_TOPOLOGY = "hyperlattice";

function parseActionRegistryDoc(doc, relPath) {
  const actions = doc?.actions ?? {};
  const action_nodes = Object.entries(actions).map(([action_path, node]) => ({
    node_family: "event",
    action_path,
    label: node?.label ?? action_path,
    category: node?.category ?? "unknown",
    parents: node?.parents ?? [],
    children: node?.children ?? [],
    trust_floor: node?.trust_floor ?? 1,
  }));
  return {
    path: relPath,
    aep_version: doc?.aep_version ?? null,
    dynaep_version: doc?.dynaep_version ?? null,
    lattice_revision: doc?.lattice_revision ?? null,
    action_nodes,
    action_count: action_nodes.length,
  };
}

/**
 * Load dynAEP action_path nodes from aep-lattice.yaml (event node family).
 * @param {string} repoRoot
 * @param {string} [relativePath]
 */
export function loadActionLatticeRegistry(repoRoot, relativePath) {
  const rel = relativePath ?? "AEP-Components/dynAEP/registries/aep-lattice.yaml";
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`hyperlattice: missing action registry ${rel}`);
  }
  const doc = yaml.parse(readFileSync(abs, "utf8"));
  return parseActionRegistryDoc(doc, rel);
}

/**
 * Load Composer Lite CCA action paths (canonical hyperlattice for CCA).
 * @param {string} repoRoot
 */
export function loadComposerCcaLatticeRegistry(repoRoot) {
  const rel = COMPOSER_CCA_LATTICE_REGISTRY;
  const abs = join(repoRoot, rel);
  if (!existsSync(abs)) {
    throw new Error(`hyperlattice: missing Composer CCA registry ${rel}`);
  }
  const doc = yaml.parse(readFileSync(abs, "utf8"));
  return parseActionRegistryDoc(doc, rel);
}

/**
 * Merge base dynAEP registry with Composer CCA registry (CCA paths win on collision).
 * @param {object} baseRegistry
 * @param {object} ccaRegistry
 */
export function mergeActionLatticeRegistries(baseRegistry, ccaRegistry) {
  const byPath = new Map();
  for (const node of baseRegistry.action_nodes) {
    byPath.set(node.action_path, node);
  }
  for (const node of ccaRegistry.action_nodes) {
    byPath.set(node.action_path, node);
  }
  const action_nodes = [...byPath.values()];
  return {
    path: baseRegistry.path,
    composer_cca_registry: ccaRegistry.path,
    aep_version: baseRegistry.aep_version,
    dynaep_version: baseRegistry.dynaep_version,
    lattice_revision: baseRegistry.lattice_revision,
    action_nodes,
    action_count: action_nodes.length,
  };
}

/**
 * Detect cycles in action_path parent partial order.
 * @param {{ action_path: string, parents: string[] }[]} actionNodes
 */
export function detectActionLatticeCycles(actionNodes) {
  const byPath = new Map(actionNodes.map((n) => [n.action_path, n]));
  const visiting = new Set();
  const visited = new Set();
  const cycles = [];

  function dfs(path, stack) {
    if (visited.has(path)) return;
    if (visiting.has(path)) {
      const idx = stack.indexOf(path);
      cycles.push(stack.slice(idx).concat(path));
      return;
    }
    visiting.add(path);
    const node = byPath.get(path);
    for (const parent of node?.parents ?? []) {
      if (byPath.has(parent)) dfs(parent, stack.concat(path));
    }
    visiting.delete(path);
    visited.add(path);
  }

  for (const node of actionNodes) dfs(node.action_path, []);
  return cycles;
}

/**
 * Validate one hyperlattice view (structure + event + GAP + canvas bindings).
 * @param {object} view
 */
export function validateHyperlattice(view) {
  const errors = [];
  const actionNodes = view?.event_nodes ?? [];
  const knownPaths = new Set(actionNodes.map((n) => n.action_path));

  for (const node of actionNodes) {
    for (const parent of node.parents ?? []) {
      if (!knownPaths.has(parent)) {
        errors.push(`unknown parent ${parent} for action_path ${node.action_path}`);
      }
    }
  }

  const cycles = detectActionLatticeCycles(actionNodes);
  for (const cycle of cycles) {
    errors.push(`action_path cycle: ${cycle.join(" -> ")}`);
  }

  for (const policy of view?.gap_policy_nodes ?? []) {
    const abs = join(view.repo_root ?? "", policy.path);
    if (view.repo_root && !existsSync(abs)) {
      errors.push(`missing GAP policy node file: ${policy.path}`);
    }
  }

  const bindings = view?.channel_bindings ?? [];
  const contractIds = new Set(bindings.map((b) => b.contract_id));
  for (const canvas of view?.canvas_nodes ?? []) {
    if (canvas.contract_id && !contractIds.has(canvas.contract_id)) {
      errors.push(
        `canvas node ${canvas.id} contract_id ${canvas.contract_id} not in hyperlattice channel_bindings`,
      );
    }
  }

  return { valid: errors.length === 0, errors, cycle_count: cycles.length };
}

/**
 * Build the canonical unified hyperlattice view (one mechanism, one graph projection).
 * @param {object} [opts]
 * @param {string} [opts.repoRoot]
 * @param {string[]} [opts.activeRegulationLrps]
 * @param {object|null} [opts.composerGraph]
 */
export function buildHyperlatticeView(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const activeRegulationLrps = opts.activeRegulationLrps ?? [];
  const composerGraph = opts.composerGraph ?? null;

  const policyView = buildPolicyLatticeView(activeRegulationLrps);
  const dyn = loadDynaepContext(repoRoot);
  const baseRegistry = loadActionLatticeRegistry(repoRoot, dyn.lattice_registry);
  const ccaRegistry = loadComposerCcaLatticeRegistry(repoRoot);
  const actionRegistry = mergeActionLatticeRegistries(baseRegistry, ccaRegistry);

  const ccaGapPolicies = loadCcaGapPolicies(repoRoot);
  const gap_policy_nodes = [
    ...(policyView.reference_policies ?? []).map((p) => ({
      node_family: "gap_policy",
      id: p.file,
      domain: p.domain,
      path: p.path,
    })),
    ...ccaGapPolicies.map((p) => ({
      node_family: "gap_policy",
      id: p.file,
      domain: p.address?.domain ?? p.file,
      path: p.path,
      cca_agent: true,
      synthesized_by: "gapc_validated",
      gap_address: p.address ? `${p.address.domain}/${p.address.id}` : null,
    })),
  ];

  const event_nodes = actionRegistry.action_nodes;
  const composer_protocol = buildComposerProtocolSpec();
  const composer_protocol_nodes = composer_protocol.node_types.map((n) => ({
    node_family: "composer_protocol",
    ...n,
  }));
  const canvas_nodes = (composerGraph?.nodes ?? []).map((n) => ({
    node_family: "canvas",
    id: n.id,
    type: n.type,
    contract_id: n.data?.contract_id ?? null,
    lattice_id: n.data?.lattice_id ?? null,
    channel_id: n.data?.channel_id ?? null,
  }));

  const view = {
    topology: HYPERLATTICE_TOPOLOGY,
    mechanism: "one",
    repo_root: repoRoot,
    kernel_contract: dyn.kernel_contract,
    hierarchy: policyView.hierarchy,
    gap_policy_nodes,
    event_nodes,
    composer_protocol,
    composer_protocol_nodes,
    cca_gap_policies: ccaGapPolicies,
    canvas_nodes,
    action_registry: {
      path: actionRegistry.path,
      composer_cca_registry: actionRegistry.composer_cca_registry,
      action_count: actionRegistry.action_count,
      lattice_revision: actionRegistry.lattice_revision,
      dynaep_version: actionRegistry.dynaep_version,
    },
    channel_bindings: policyView.channel_bindings,
    reference_policies: policyView.reference_policies,
    platform_contracts: policyView.platform_contracts,
    active_regulation_lrps: policyView.active_regulation_lrps,
    compliance_modules: policyView.compliance_modules,
    epscom: policyView.epscom,
    node_counts: {
      gap_policy: gap_policy_nodes.length,
      event: event_nodes.length,
      composer_protocol: composer_protocol_nodes.length,
      canvas: canvas_nodes.length,
      channel_bindings: (policyView.channel_bindings ?? []).length,
    },
  };

  view.validation = validateHyperlattice(view);
  if (composerGraph?.nodes?.length) {
    view.composer_topology_validation = validateComposerTopology(composerGraph);
    if (!view.composer_topology_validation.valid) {
      view.validation.valid = false;
      view.validation.errors.push(...view.composer_topology_validation.errors);
    }
  }
  return view;
}

/**
 * Canonical persisted hyperlattice config from plan policy_overrides (after facet wiring).
 * @param {object} plan
 * @param {object} [context]
 */
export function buildHyperlatticeConfig(plan, context = {}) {
  const ps = context.policy_system ?? loadPolicySystemContext();
  const dyn = context.dynaep ?? loadDynaepContext();
  const po = plan?.policy_overrides ?? {};

  const policy_lattice =
    po.policy_lattice ?? {
      enabled: true,
      hierarchy: ps.hierarchy.map((h) => h.label),
      mandatory_gap: ps.mandatory_gap,
      reference_policy_paths: ps.reference_policies.map((p) => p.path),
      yaml_presets: ps.yaml_presets.map((p) => p.path),
    };

  const dynaep = po.dynaep ?? buildDynaepPolicyOverrides(plan, dyn);

  return {
    topology: HYPERLATTICE_TOPOLOGY,
    mechanism: "one",
    enabled: true,
    kernel_contract: dyn.kernel_contract,
    lattice_registry: dynaep.lattice_registry,
    composer_cca_registry: COMPOSER_CCA_LATTICE_REGISTRY,
    governance_mode: dynaep.governance_mode,
    validation_hook: dynaep.validation_hook,
    policy_lattice,
    dynaep,
    gap: po.gap ?? null,
    regulation_lrps: po.regulation_lrps ?? null,
    coding_governance: po.coding_governance ?? null,
  };
}

/**
 * Wire canonical policy_overrides.hyperlattice after facet-specific overrides.
 * @param {object} plan
 * @param {object} [context]
 */
export function applyHyperlatticeOverrides(plan, context = {}) {
  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.hyperlattice = buildHyperlatticeConfig(plan, context);
}

/**
 * Validate hyperlattice on Base Node boot / config write.
 * @param {object} config - base-node.json
 * @param {string} repoRoot
 * @param {object} [opts]
 */
export function validateHyperlatticeOnBoot(config, repoRoot, opts = {}) {
  const errors = [];
  const lrps = config?.base_node?.lrps ?? [];
  const hyper =
    config?.policy_sections?.hyperlattice ??
    config?.hyperlattice ??
    config?.policy_sections?.dynaep ??
    null;

  let composerGraph = null;
  if (opts.dataDir) {
    try {
      composerGraph = loadGraph(opts.dataDir);
    } catch {
      /* optional canvas */
    }
  }

  const view = buildHyperlatticeView({
    repoRoot,
    activeRegulationLrps: lrps,
    composerGraph,
  });
  const structural = validateHyperlattice(view);
  if (!structural.valid) {
    errors.push(...structural.errors);
  }

  const registryPath = hyper?.lattice_registry ?? hyper?.dynaep?.lattice_registry;
  if (registryPath) {
    const abs = join(repoRoot, registryPath);
    if (!existsSync(abs)) {
      errors.push(`hyperlattice: missing lattice_registry ${registryPath}`);
    }
  }

  const ccaRegistryPath = hyper?.composer_cca_registry ?? COMPOSER_CCA_LATTICE_REGISTRY;
  const ccaAbs = join(repoRoot, ccaRegistryPath);
  if (!existsSync(ccaAbs)) {
    errors.push(`hyperlattice: missing composer_cca_registry ${ccaRegistryPath}`);
  }

  const latticePolicyRel =
    hyper?.dynaep?.bridge?.rego?.separate_policy_paths?.lattice ??
    "AEP-Components/dynAEP/policies/lattice-policy.rego";
  const latticePolicyAbs = join(repoRoot, latticePolicyRel);
  if (!existsSync(latticePolicyAbs)) {
    errors.push(`hyperlattice: missing lattice-policy.rego at ${latticePolicyRel}`);
  }

  if (config?.policy_sections && !config.policy_sections.hyperlattice) {
    errors.push("hyperlattice: policy_sections.hyperlattice missing on Base Node config");
  }

  return {
    topology: HYPERLATTICE_TOPOLOGY,
    valid: errors.length === 0,
    errors,
    node_counts: view.node_counts,
    action_registry: view.action_registry,
    lattice_policy_path: latticePolicyRel,
  };
}

/**
 * @param {object} config
 * @param {string} repoRoot
 * @param {object} [opts]
 */
export function assertHyperlatticeBoot(config, repoRoot, opts = {}) {
  const result = validateHyperlatticeOnBoot(config, repoRoot, opts);
  if (!result.valid) {
    throw new Error(`Hyperlattice boot validation failed: ${result.errors.join("; ")}`);
  }
  return result;
}