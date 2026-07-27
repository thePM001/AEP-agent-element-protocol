#!/usr/bin/env node

import { buildRegistryContext } from "./registry-context.mjs";
import { validatePlanAgainstRegistry } from "./plan-schema.mjs";
import { epscomEnforceWritingValue } from "../../lattice-channels/lib/lattice-transport.mjs";
import {
  matchIntentFromCatalog,
  buildPlanComponents,
  buildTopologyFromCatalog,
} from "./component-catalog.mjs";
import { loadGapContext } from "./gap-context.mjs";
import { loadCodingGovernanceContext } from "../../coding-governance/lib/coding-governance-context.mjs";
import {
  loadPolicySystemContext,
  resolveComplianceModulesForLrps,
} from "./policy-system-context.mjs";
import {
  loadDynaepContext,
  buildDynaepPolicyOverrides,
} from "./dynaep-context.mjs";
import { applyHyperlatticeOverrides } from "../../hyperlattice/lib/hyperlattice.mjs";
import { listGapCawProfiles } from "../../gap/lib/gap-compile.mjs";

/**
 * Rule-based plan generation (always available; no LLM required).
 * @param {string} userIntent
 * @param {string} [dataDir]
 * @param {object} [env]
 */
export async function generatePlanFromIntent(userIntent, dataDir, env = process.env) {
  const context = await buildRegistryContext(dataDir, env);
  const match = matchIntentFromCatalog(userIntent, context);

  const inference = match.inferenceOverride ?? {
    provider: context.environment.recommended_inference.provider,
    model: context.environment.recommended_inference.model_hint,
    base_url:
      context.environment.recommended_inference.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : "http://127.0.0.1:8080/v1",
  };

  const components = buildPlanComponents(
    context.components,
    match.componentIds,
    userIntent,
    env,
  );

  const topology = buildTopologyFromCatalog(
    match.componentIds,
    userIntent,
    context.components,
  );

  const plan = {
    plan_version: "1",
    created_by: "cca",
    created_at: new Date().toISOString(),
    user_intent: userIntent,
    environment_snapshot: context.environment,
    components,
    lrps: match.lrps,
    inference,
    topology,
    policy_overrides: {},
    connectors: {},
    security: {
      lattice_strict: true,
      internet_up: context.environment.network.internet_up,
      ucb_enabled: match.componentIds.includes("ucb"),
    },
    warnings: match.warnings,
  };

  for (const comp of components) {
    if (!comp.id?.startsWith("connector-") || !comp.config) continue;
    const key = comp.id.replace(/^connector-/, "").replace(/-/g, "_");
    plan.connectors[key] = comp.config;
  }
  if (Object.keys(plan.connectors).length > 0) {
    plan.security.ucb_enabled = true;
    if (!match.componentIds.includes("ucb")) {
      plan.warnings = [...(plan.warnings ?? []), "connectors require UCB egress"];
    }
  }

  applyAllPolicyOverrides(plan, context);

  const validation = validatePlanAgainstRegistry(plan, context.components, context.environment);
  if (!validation.valid) {
    plan.warnings = [...(plan.warnings ?? []), ...validation.errors.map((e) => `validation: ${e}`)];
  }

  const enforcedPlan = epscomEnforceWritingValue(plan);
  return { plan: enforcedPlan, context, validation };
}

/**
 * Extract ImplementationPlan JSON from LLM reply text.
 * @param {string} text
 */
export function extractPlanFromLlmReply(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed?.plan_version === "1") return parsed;
  } catch {
    return null;
  }
  return null;
}

/**
 * Wire GAP reference policies into plan policy_overrides when gap-related components enabled.
 * @param {object} plan
 * @param {object} context
 */
/**
 * Apply all policy_overrides for an ImplementationPlan.
 * @param {object} plan
 * @param {object} context
 */
export function applyAllPolicyOverrides(plan, context) {
  applyGapPolicyOverrides(plan, context);
  applyCawFrameworkOverrides(plan, context);
  applyCodingGovernanceOverrides(plan, context);
  applyComplianceLrpPolicyOverrides(plan, context);
  applyPolicyLatticeOverrides(plan, context);
  applyDynaepPolicyOverrides(plan, context);
  applyHyperlatticeOverrides(plan, context);
}

function applyGapPolicyOverrides(plan, context) {
  const enabledIds = new Set(plan.components.filter((c) => c.enabled).map((c) => c.id));
  if (!enabledIds.has("gap") && !enabledIds.has("coding-governance") && !enabledIds.has("caw-framework")) {
    return;
  }

  const gap = context.gap ?? loadGapContext();
  plan.policy_overrides = plan.policy_overrides ?? {};

  plan.policy_overrides.gap = {
    enabled: true,
    meta_schema: "AEP-Components/gap/schemas/gap-meta-schema-v1.2.json",
    policy_system_root: "AEP-Policy-System",
    reference_policies: gap.reference_policies.map((p) => p.file),
    component_reference_policies: gap.component_reference_policies?.map((p) => p.file) ?? [],
    gap_instruction:
      "AEP-Components/gap/policies/reference/implementation-plan-v1.gap",
  };
}

/**
 * Wire GAP-compiled CAW mount profiles into plan policy_overrides.
 * @param {object} plan
 * @param {object} context
 */
export function applyCawFrameworkOverrides(plan, context) {
  const enabledIds = new Set(plan.components.filter((c) => c.enabled).map((c) => c.id));
  if (!enabledIds.has("caw-framework")) return;

  const profiles = listGapCawProfiles(context.repo_root);
  const intent = plan.user_intent ?? "";
  let mountProfile = "agent-sandbox";
  let gapAddress = "dev.aep.caw/agent-sandbox.v1";
  let compiledRuntime = false;

  if (/compiled[\s-]*runtime|plan[\s-]*once|no[\s-]*llm[\s-]*proxy/i.test(intent)) {
    mountProfile = "compiled-runtime";
    gapAddress = "dev.aep.caw/compiled-runtime.v1";
    compiledRuntime = true;
  } else if (/coding\s*agent|governed\s*agent|hermes|aep[\s-]*agent|composer/i.test(intent)) {
    mountProfile = "coding-agent";
    gapAddress = "dev.aep.caw/coding-agent.v1";
  } else if (/restricted|untrusted|minimal/i.test(intent)) {
    mountProfile = "restricted";
    gapAddress = "dev.aep.caw/restricted.v1";
  } else if (/multi[\s-]*repo|frontend.*backend/i.test(intent)) {
    mountProfile = "dev-multi-repo";
    gapAddress = "dev.aep.caw/dev-multi-repo.v1";
  }

  const selected = profiles.find((p) => p.name === mountProfile) ?? profiles[0];
  if (selected?.gap_address) gapAddress = selected.gap_address;

  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.caw_framework = {
    enabled: true,
    mount_profile: mountProfile,
    gap_address: gapAddress,
    policy_name: selected?.base_policy ?? "agent-sandbox",
    compiled_runtime: compiledRuntime,
    llm_proxy: selected?.llm_proxy !== false,
    enforcement_tier: selected?.enforcement_tier ?? "shim",
    available_profiles: profiles.map((p) => p.name),
    gap_profiles_root: "AEP-Components/gap/policies/reference/",
  };

  plan.agent_runtime = plan.agent_runtime ?? {};
  plan.agent_runtime.caw = {
    enabled: true,
    mount_profile: mountProfile,
    gap_address: gapAddress,
  };
}

function applyComplianceLrpPolicyOverrides(plan, context) {
  const lrps = plan.lrps ?? [];
  if (!lrps.length) return;

  const catalog = context.policy_system?.catalog ?? loadPolicySystemContext().catalog;
  const modules = resolveComplianceModulesForLrps(lrps, catalog);
  if (!modules.length) return;

  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.regulation_lrps = {
    enabled: true,
    modules,
  };
}

function applyPolicyLatticeOverrides(plan, context) {
  const ps = context.policy_system ?? loadPolicySystemContext();
  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.policy_lattice = {
    enabled: true,
    hierarchy: ps.hierarchy.map((h) => h.label),
    mandatory_gap: ps.mandatory_gap,
    reference_policy_paths: ps.reference_policies.map((p) => p.path),
    yaml_presets: ps.yaml_presets.map((p) => p.path),
  };
}

/**
 * Wire dynAEP lattice registry, governance mode and SDK paths into plan.
 * @param {object} plan
 * @param {object} context
 */
export function applyDynaepPolicyOverrides(plan, context) {
  const enabledIds = new Set(plan.components.filter((c) => c.enabled).map((c) => c.id));
  if (!enabledIds.has("dynaep-core") && !enabledIds.has("gap")) return;

  const dyn = context.dynaep ?? loadDynaepContext();
  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.dynaep = buildDynaepPolicyOverrides(plan, dyn);
}

/**
 * Wire coding-governance + git integration for CCA-built coding agents.
 * @param {object} plan
 * @param {object} context
 */
export function applyCodingGovernanceOverrides(plan, context) {
  const enabledIds = new Set(plan.components.filter((c) => c.enabled).map((c) => c.id));
  if (!enabledIds.has("coding-governance")) return;

  const cg = context.coding_governance ?? loadCodingGovernanceContext();
  const codingAgentPlan =
    enabledIds.has("caw-framework")
    || /coding\s*agent|claude\s*code|cursor|codex|pre[\s-]*change|propose|blast\s*radius|nool/i.test(
      plan.user_intent ?? "",
    );

  plan.policy_overrides = plan.policy_overrides ?? {};
  plan.policy_overrides.coding_governance = {
    ...cg.policy_overrides_template,
    require_propose: codingAgentPlan || enabledIds.has("coding-governance"),
    git_integration: true,
    auto_git_refs: true,
    semantic_strict: codingAgentPlan,
    subprotocol: "coding-governance",
    reference_policies: [
      "AEP-Components/gap/policies/reference/coding-governance-propose.gap",
      "AEP-Components/gap/policies/reference/semantic-impact-envelope.gap",
    ],
    workflow: cg.workflow_cli,
    agent_instructions: [
      "Before editing: aep propose --intent \"...\" --paths <allowed paths>",
      "While editing: gateway enforces propose token when AEP_SEMANTIC_STRICT=1",
      "After editing + git commit: aep solidify --intent-id INT-... (auto git_refs)",
      "Multi-agent: aep announce --intent-id INT-... --agent-id <id>",
    ],
  };

  if (codingAgentPlan) {
    plan.agent_runtime = plan.agent_runtime ?? {};
    plan.agent_runtime.coding_governance = {
      enabled: true,
      env: {
        AEP_SEMANTIC_STRICT: "1",
        AEP_GIT_INTEGRATION: "1",
      },
    };
  }
}