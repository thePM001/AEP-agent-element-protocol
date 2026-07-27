#!/usr/bin/env node
/**
 * Build DynAEPBridgeConfig from Base Node config.dynaep (CCA plan-executor output).
 */

import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

/**
 * @param {object} dynaepConfig - config.dynaep from Base Node JSON
 * @param {string} repoRoot - absolute path to AEP 2.8 repo root
 * @returns {import("../../AEP-SDKs/typescript/dynaep/src/bridge.js").DynAEPBridgeConfig | null}
 */
export function buildBridgeConfigFromDynaep(dynaepConfig, repoRoot) {
  if (!dynaepConfig?.enabled) return null;

  const registryRel = dynaepConfig.lattice_registry ?? dynaepConfig.bridge?.lattice?.registry;
  if (!registryRel) return null;

  const registryPath = isAbsolute(registryRel)
    ? registryRel
    : join(repoRoot, registryRel);

  if (!existsSync(registryPath)) {
    throw new Error(`dynAEP lattice registry not found: ${registryPath}`);
  }

  const composerCcaRel =
    dynaepConfig.composer_cca_registry ??
    dynaepConfig.bridge?.lattice?.composer_cca_registry ??
    "AEP-Composer-Lite/registries/composer-cca-lattice.yaml";
  const composerCcaRegistry = isAbsolute(composerCcaRel)
    ? composerCcaRel
    : join(repoRoot, composerCcaRel);

  const governance =
    dynaepConfig.governance_mode ??
    dynaepConfig.bridge?.lattice?.governance ??
    "filter_all";

  const hook =
    dynaepConfig.validation_hook ??
    dynaepConfig.bridge?.lattice?.hook ??
    "mle";

  const latticePolicyRel =
    dynaepConfig.bridge?.rego?.separate_policy_paths?.lattice ??
    "AEP-Components/dynAEP/policies/lattice-policy.rego";
  const latticePolicyPath = isAbsolute(latticePolicyRel)
    ? latticePolicyRel
    : join(repoRoot, latticePolicyRel);

  return {
    validation: dynaepConfig.bridge?.validation ?? {
      mode: "strict",
      jit_on_every_delta: true,
    },
    runtime_reflection: dynaepConfig.bridge?.runtime_reflection ?? {
      enabled: false,
      method: "observer",
      debounce_ms: 250,
      broadcast_to_agent: false,
    },
    approval_policy: dynaepConfig.bridge?.approval_policy ?? {},
    conflict_resolution: dynaepConfig.bridge?.conflict_resolution ?? {
      mode: "last_write_wins",
    },
    id_minting: dynaepConfig.bridge?.id_minting ?? {
      enabled: true,
      counters_persist: false,
    },
    lattice: {
      registry: registryPath,
      composer_cca_registry: existsSync(composerCcaRegistry) ? composerCcaRegistry : undefined,
      governance,
      agent_interest_enabled:
        dynaepConfig.agent_interest_enabled ??
        dynaepConfig.bridge?.lattice?.agent_interest_enabled ??
        true,
      hook,
    },
    rego: {
      policyPath: dynaepConfig.bridge?.rego?.policy_path ?? join(repoRoot, "AEP-Components/dynAEP/policies/aep-policy.rego"),
      evaluation: dynaepConfig.bridge?.rego?.evaluation ?? "precompiled",
      bundleMode: dynaepConfig.bridge?.rego?.bundle_mode ?? "separate",
      decisionCacheSize: dynaepConfig.bridge?.rego?.decision_cache_size ?? 5000,
      cacheInvalidateOnReload: true,
      separatePolicyPaths: {
        structural: dynaepConfig.bridge?.rego?.separate_policy_paths?.structural ?? join(repoRoot, "AEP-Components/dynAEP/policies/aep-policy.rego"),
        temporal: dynaepConfig.bridge?.rego?.separate_policy_paths?.temporal ?? join(repoRoot, "AEP-Components/dynAEP/policies/temporal-policy.rego"),
        perception: dynaepConfig.bridge?.rego?.separate_policy_paths?.perception ?? join(repoRoot, "AEP-Components/dynAEP/policies/perception-policy.rego"),
        lattice: latticePolicyPath,
      },
    },
    hyperlattice: {
      lattice_policy_path: latticePolicyPath,
      gap_writing_lint: true,
      mode: dynaepConfig.bridge?.validation?.mode ?? "strict",
    },
  };
}

/**
 * Observer adapter launch hints from config.dynaep.observers.
 * @param {object} dynaepConfig
 */
export function listDynaepObserverSpecs(dynaepConfig) {
  const observers = dynaepConfig?.observers;
  if (!observers || typeof observers !== "object") return [];
  return Object.entries(observers)
    .filter(([, spec]) => spec?.enabled)
    .map(([id, spec]) => ({ id, ...spec }));
}