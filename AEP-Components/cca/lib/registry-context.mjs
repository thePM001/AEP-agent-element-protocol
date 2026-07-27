#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadComponentRegistry, loadInstalledExtensions } from "../../../AEP-Base-Node/registry/lib/registry.mjs";
import { NODE_PALETTE } from "../../../AEP-Composer-Lite/lib/graph-store.mjs";
import { probeEnvironment } from "./environment-probe.mjs";
import { loadGapContext, formatGapForPrompt } from "./gap-context.mjs";
import {
  loadCodingGovernanceContext,
  formatCodingGovernanceForPrompt,
} from "../../coding-governance/lib/coding-governance-context.mjs";
import {
  loadSignaturesContext,
  formatSignaturesForPrompt,
} from "../../../AEP-Base-Node/signatures/lib/signatures-context.mjs";
import {
  loadPolicySystemContext,
  formatPolicySystemForPrompt,
} from "./policy-system-context.mjs";
import {
  loadDynaepContext,
  formatDynaepForPrompt,
} from "./dynaep-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

const DOCK_IDS = [
  { id: "inference_engine", name: "Inference Engine Dock", suffix: "/inference" },
  { id: "validation_engine", name: "Validation Engine Dock", suffix: "/validation" },
  { id: "regulation_module", name: "Regulation Module Dock", suffix: "/regulation" },
  { id: "future_features", name: "Future Features Dock", suffix: "/future" },
];

/**
 * @param {string} [dataDir]
 * @param {object} [env]
 */
export async function buildRegistryContext(dataDir, env = process.env) {
  const registry = await loadComponentRegistry(env, REPO_ROOT);
  const installed = dataDir ? loadInstalledExtensions(dataDir) : { installed: [] };
  const installedIds = new Set(installed.installed.map((e) => e.id));
  const environment = await probeEnvironment(env);

  const socketBase = env.AEP_SOCKET_BASE || (dataDir ? `${dataDir}/sockets` : "/data/aep/sockets");

  const components = registry.components
    .filter((c) => c.bundled !== false || c.kind === "template")
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      path: c.path,
      description: c.description,
      default_enabled: c.default_enabled,
      lrp_id: c.lrp_id ?? c.manifest?.lrp_id ?? null,
      gap_ref: c.gap_ref ?? c.manifest?.gap_ref ?? null,
      capabilities: c.manifest?.capabilities ?? [],
      actions: c.manifest?.actions ?? [],
      setup_hooks: c.manifest?.setup_hooks ?? [],
      resource_requirements: c.manifest?.resource_requirements ?? null,
      cca: c.manifest?.cca ?? null,
      composer: c.manifest?.composer ?? null,
      composer_node: c.manifest?.composer_node ?? null,
      implementation: c.manifest?.implementation ?? null,
      requires: c.manifest?.requires ?? [],
      installed: installedIds.has(c.id) || Boolean(c.default_enabled),
    }));

  const gap = loadGapContext(REPO_ROOT);
  const coding_governance = loadCodingGovernanceContext(REPO_ROOT);
  const epscom_signatures = loadSignaturesContext(REPO_ROOT, env);
  const policy_system = loadPolicySystemContext(REPO_ROOT);
  const dynaep = loadDynaepContext(REPO_ROOT);

  return {
    catalog_version: registry.version,
    protocol_version: registry.protocol_version,
    generated_at: new Date().toISOString(),
    components,
    gap,
    coding_governance,
    epscom_signatures,
    policy_system,
    dynaep,
    docks: DOCK_IDS.map((d) => ({
      ...d,
      socket: `${socketBase.replace(/\/$/, "")}${d.suffix}`,
    })),
    builtin_palette: NODE_PALETTE,
    environment,
    installed: [...installedIds],
  };
}

/**
 * Compact text summary for LLM system prompt.
 * @param {object} context
 */
export function formatContextForPrompt(context) {
  const lines = [
    "AEP 2.8 Component Registry (CCA knowledge bundle):",
    `Environment: ${context.environment.cpu_cores} cores, ${context.environment.memory_total_mb}MB RAM, constraints: ${context.environment.constraints.join(", ") || "none"}`,
    `Recommended inference: ${context.environment.recommended_inference.provider} / ${context.environment.recommended_inference.model_hint}`,
    "",
    "Components:",
  ];

  for (const c of context.components) {
    if (!c.cca?.summary) continue;
    const tag = c.installed ? "[installed]" : "[available]";
    lines.push(`- ${c.id} (${c.kind}) ${tag}: ${c.cca.summary}`);
    if (c.lrp_id) lines.push(`  lrp_id: ${c.lrp_id}`);
    if (c.gap_ref) lines.push(`  gap_ref: ${c.gap_ref}`);
    if (c.cca.use_when?.length) {
      lines.push(`  use_when: ${c.cca.use_when.join("; ")}`);
    }
    if (c.cca.avoid_when?.length) {
      lines.push(`  avoid_when: ${c.cca.avoid_when.join("; ")}`);
    }
    if (c.cca.pairs_with?.length) {
      lines.push(`  pairs_with: ${c.cca.pairs_with.join(", ")}`);
    }
    if (c.capabilities?.length) {
      lines.push(`  capabilities: ${c.capabilities.join(", ")}`);
    }
    if (c.actions?.length) {
      const actionIds = c.actions.map((a) => a.id).join(", ");
      lines.push(`  actions: ${actionIds}`);
    }
    if (c.setup_hooks?.length) {
      const hookIds = c.setup_hooks.map((h) => h.id ?? h.setup_hook).join(", ");
      lines.push(`  setup_hooks: ${hookIds}`);
    }
    if (c.requires?.length) {
      lines.push(`  requires: ${c.requires.join(", ")}`);
    }
  }

  lines.push("", "Docking ports (lattice-gated Unix sockets only):");
  for (const d of context.docks) {
    lines.push(`- ${d.id}: ${d.socket}`);
  }

  lines.push(
    "",
    "Security: All agent traffic MUST use lattice channels. No raw HTTP between AEP nodes.",
    "Writing rules are enforced by EPSCOM kernel (epscom-core platform authority, not an LRP), not validation dock.",
    "Output: human summary + ```json ImplementationPlan ``` block with plan_version 1.",
    "Full-stack intents (all components, 100% coverage) must enable every bundled catalog entry.",
  );

  if (context.gap) {
    lines.push(formatGapForPrompt(context.gap));
  }

  if (context.coding_governance) {
    lines.push(formatCodingGovernanceForPrompt(context.coding_governance));
  }

  if (context.epscom_signatures) {
    lines.push(formatSignaturesForPrompt(context.epscom_signatures));
  }

  if (context.policy_system) {
    lines.push(formatPolicySystemForPrompt(context.policy_system));
  }

  if (context.dynaep) {
    lines.push(formatDynaepForPrompt(context.dynaep));
  }

  return lines.join("\n");
}

export function loadImplementationPlanSchema() {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, "AEP-Base-Node/registry/schemas/implementation-plan-v1.json"), "utf8"),
  );
}