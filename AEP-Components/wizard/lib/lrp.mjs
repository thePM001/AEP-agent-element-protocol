#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");

export function loadLrpCatalog() {
  const path = join(__dirname, "..", "lrp", "catalog.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadLrpModule(manifestPath) {
  const resolved = manifestPath.startsWith("/")
    ? manifestPath
    : join(REPO_ROOT, manifestPath);
  if (!existsSync(resolved)) return null;
  return JSON.parse(readFileSync(resolved, "utf8"));
}

export function listPlatformContracts(catalog) {
  return catalog.platform_contracts ?? [];
}

export function listPlatformMandatoryPolicies(catalog) {
  return catalog.platform_mandatory_policies ?? [];
}

export function groupLrpsByCategory(catalog) {
  const groups = { compliance: [] };
  for (const lrp of catalog.lrps ?? []) {
    const category = lrp.category ?? "compliance";
    if (!groups[category]) groups[category] = [];
    groups[category].push(lrp);
  }
  return groups;
}

const CATEGORY_LABELS = {
  compliance: "Regulation LRPs (sovereign / regional / international)",
};

async function promptLrpGroup(rl, promptYesNo, label, lrps, selected) {
  if (!lrps.length) return;
  console.log(`\n${label}:`);
  for (const lrp of lrps) {
    const hint = lrp.framework ? ` [${lrp.framework}]` : "";
    const jurisdiction = lrp.jurisdiction ? ` (${lrp.jurisdiction})` : "";
    const enable = await promptYesNo(
      rl,
      `  Enable ${lrp.name} (${lrp.id})${hint}${jurisdiction}?`,
      lrp.default_enabled,
    );
    if (enable) selected.push(lrp.id);
  }
}

export async function selectLrpsInteractive(catalog, rl, promptYesNo) {
  const selected = [];
  console.log(
    `\nEPSCOM: ${catalog.epscom.name} (mandatory platform authority, priority ${catalog.epscom.priority}; not an LRP)`,
  );

  const platform = listPlatformContracts(catalog);
  if (platform.length) {
    console.log("\nPlatform kernel contracts (always active via Base Node bootstrap; not LRPs):");
    for (const contract of platform.filter((c) => c.kind === "kernel_contract")) {
      console.log(`  - ${contract.name} (${contract.id})`);
    }
  }

  const groups = groupLrpsByCategory(catalog);
  await promptLrpGroup(
    rl,
    promptYesNo,
    CATEGORY_LABELS.compliance,
    groups.compliance,
    selected,
  );
  return selected;
}

/** Returns enabled regulation LRP IDs only. EPSCOM and kernel contracts are not LRPs. */
export function selectLrpsDefault(catalog) {
  return (catalog.lrps ?? [])
    .filter((l) => l.default_enabled)
    .map((l) => l.id);
}

export function listComplianceModules(catalog) {
  return (catalog.lrps ?? [])
    .filter((l) => l.category === "compliance")
    .map((l) => ({
      id: l.id,
      name: l.name,
      framework: l.framework ?? l.name,
      jurisdiction: l.jurisdiction ?? null,
      gap_ref: l.gap_ref ?? null,
      module_manifest: l.module_manifest ?? null,
      priority: l.priority,
      default_enabled: l.default_enabled,
    }));
}