#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLrpCatalog,
  listComplianceModules,
  listPlatformContracts,
  listPlatformMandatoryPolicies,
  loadLrpModule,
} from "../../wizard/lib/lrp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

export const POLICY_SYSTEM_ROOT = "AEP-Policy-System";

const LATTICE_HIERARCHY = [
  { id: "system", label: "SYSTEM", level: 0 },
  { id: "governance.gap", label: "governance.gap", level: 1 },
  { id: "deployment.gap", label: "deployment.gap", level: 2 },
  { id: "writing.gap", label: "writing.gap", level: 3 },
  { id: "security.gap", label: "security.gap", level: 4 },
  { id: "sandbox", label: "SANDBOX", level: 5 },
];

function parseGapJson(raw, file) {
  try {
    const parsed = JSON.parse(raw);
    return {
      file,
      path: `${POLICY_SYSTEM_ROOT}/reference/${file}`,
      domain: parsed?.address?.domain ?? basename(file, ".gap"),
      id: parsed?.address?.id ?? null,
      lrp_id: parsed?.metadata?.lrp_id ?? null,
      framework: parsed?.metadata?.framework ?? null,
    };
  } catch {
    return {
      file,
      path: `${POLICY_SYSTEM_ROOT}/reference/${file}`,
      domain: basename(file, ".gap"),
      id: null,
      lrp_id: null,
      framework: null,
    };
  }
}

function loadReferenceGapPolicies(repoRoot) {
  const refDir = join(repoRoot, POLICY_SYSTEM_ROOT, "reference");
  if (!existsSync(refDir)) return [];
  return readdirSync(refDir)
    .filter((f) => f.endsWith(".gap"))
    .sort()
    .map((file) => parseGapJson(readFileSync(join(refDir, file), "utf8"), file));
}

function loadYamlPresets(repoRoot) {
  const root = join(repoRoot, POLICY_SYSTEM_ROOT);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith(".policy.yaml"))
    .sort()
    .map((file) => ({
      file,
      path: `${POLICY_SYSTEM_ROOT}/${file}`,
      name: file.replace(/\.policy\.yaml$/, ""),
    }));
}

function loadLatticeMandatoryRules(repoRoot) {
  const path = join(repoRoot, POLICY_SYSTEM_ROOT, "lattice-channel-mandatory.gap");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const rules = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*-\s*id:\s*(\S+)/);
    if (m) rules.push(m[1]);
  }
  return rules;
}

/**
 * @param {string} [repoRoot]
 */
export function loadPolicySystemContext(repoRoot = REPO_ROOT) {
  const catalog = loadLrpCatalog();
  return {
    root: POLICY_SYSTEM_ROOT,
    hierarchy: LATTICE_HIERARCHY,
    reference_policies: loadReferenceGapPolicies(repoRoot),
    yaml_presets: loadYamlPresets(repoRoot),
    lattice_mandatory_rules: loadLatticeMandatoryRules(repoRoot),
    mandatory_gap: `${POLICY_SYSTEM_ROOT}/lattice-channel-mandatory.gap`,
    catalog,
    compliance_modules: listComplianceModules(catalog),
    platform_contracts: listPlatformContracts(catalog),
    platform_mandatory_policies: listPlatformMandatoryPolicies(catalog),
    epscom: catalog.epscom,
  };
}

/**
 * @param {string[]} lrpIds
 * @param {object} [catalog]
 */
export function resolveComplianceModulesForLrps(lrpIds, catalog = loadLrpCatalog()) {
  const modules = [];
  for (const lrpId of lrpIds ?? []) {
    const meta = catalog.lrps?.find((l) => l.id === lrpId);
    if (!meta) continue;
    const manifest = meta.module_manifest
      ? loadLrpModule(meta.module_manifest)
      : null;
    modules.push({
      lrp_id: lrpId,
      name: meta.name,
      framework: meta.framework ?? meta.name,
      jurisdiction: meta.jurisdiction ?? null,
      gap_ref: meta.gap_ref ?? manifest?.gap_ref ?? null,
      module_manifest: meta.module_manifest ?? null,
      dock: manifest?.dock ?? "regulation_module",
      priority: meta.priority ?? 150,
    });
  }
  return modules.filter((m) => m.gap_ref);
}

/**
 * @param {string} gapRef
 * @param {string} [repoRoot]
 */
export function gapRefExists(gapRef, repoRoot = REPO_ROOT) {
  if (!gapRef) return false;
  return existsSync(join(repoRoot, gapRef));
}

/**
 * @param {ReturnType<typeof loadPolicySystemContext>} ctx
 */
export function formatPolicySystemForPrompt(ctx) {
  const lines = [
    "",
    "AEP Policy System (canonical: AEP-Policy-System/):",
    `EPSCOM (${ctx.epscom.id}, priority ${ctx.epscom.priority}) is supreme platform authority — not an LRP.`,
    "",
    "Policy lattice hierarchy (most permissive → most restrictive):",
    ctx.hierarchy.map((h) => `- ${h.label}`).join("\n"),
    "",
    "Reference GAP policies (AEP-Policy-System/reference/):",
  ];
  for (const pol of ctx.reference_policies) {
    const tag = pol.framework ? ` [${pol.framework}]` : "";
    lines.push(`- ${pol.domain}${tag} -> ${pol.path}`);
  }

  lines.push(
    "",
    "Regulation LRPs (sovereign / regional / international only):",
  );
  for (const mod of ctx.compliance_modules) {
    const j = mod.jurisdiction ? ` (${mod.jurisdiction})` : "";
    lines.push(`- ${mod.id}: ${mod.name}${j} -> ${mod.gap_ref ?? "no gap_ref"}`);
  }

  lines.push(
    "",
    "Platform kernel contracts (NOT LRPs; Base Node bootstrap):",
  );
  for (const c of ctx.platform_contracts.filter((p) => p.kind === "kernel_contract")) {
    lines.push(`- ${c.id}: ${c.name}`);
  }

  if (ctx.platform_mandatory_policies?.length) {
    lines.push(
      "",
      "Platform mandatory policies (EPSCOM/platform authority; NOT LRPs; not selectable in plan.lrps):",
    );
    for (const p of ctx.platform_mandatory_policies) {
      const gap = p.gap_ref ? ` -> ${p.gap_ref}` : "";
      lines.push(`- ${p.id}: ${p.name}${gap}`);
    }
  }

  if (ctx.yaml_presets.length) {
    lines.push("", "Agent YAML policy presets (AEP-Policy-System/*.policy.yaml):");
    for (const preset of ctx.yaml_presets) {
      lines.push(`- ${preset.name} -> ${preset.path}`);
    }
  }

  if (ctx.lattice_mandatory_rules.length) {
    lines.push(
      "",
      `Lattice mandatory rules (${ctx.mandatory_gap}):`,
      ctx.lattice_mandatory_rules.map((r) => `- ${r}`).join("\n"),
    );
  }

  lines.push(
    "",
    "CCA planning rules:",
    "- Enable regulation LRP IDs in plan.lrps when user requests compliance (eu-ai-act, gdpr, hipaa, etc.).",
    "- Set policy_overrides.regulation_lrps.modules with gap_ref paths from the table above.",
    "- Set policy_overrides.gap.reference_policies to AEP-Policy-System/reference/*.gap paths.",
    "- writing.gap is EPSCOM prose lint enforced by Base Node kernel — distinct from GAP instruction language.",
    "- Composer Lite exposes GET /api/policy-lattice for runtime policy lattice view.",
  );

  return lines.join("\n");
}