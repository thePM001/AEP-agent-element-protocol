#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GAP_ROOT = join(__dirname, "..");
export const GAP_REFERENCE_DIR = join(GAP_ROOT, "policies/reference");
export const GAP_POLICY_SYSTEM_DIR = join(GAP_ROOT, "../../AEP-Policy-System/reference");

const AEP_RUNTIME_KINDS = new Set([
  "aep.caw.profile",
  "aep.caw.mount_policy",
  "aep.task_manifest.template",
  "aep.implementation_plan.template",
]);

/**
 * Parse a .gap file (one or more YAML documents).
 * @param {string} filePath
 */
export function parseGapFile(filePath) {
  const raw = readFileSync(filePath, "utf8");
  const docs = YAML.parseAllDocuments(raw).map((d) => d.toJSON());
  const instruction = docs.find((d) => d?.address?.domain && d?.address?.id) ?? null;
  const runtime = docs.filter((d) => d?.kind && AEP_RUNTIME_KINDS.has(d.kind));
  return { instruction, runtime, path: filePath };
}

/**
 * List all reference GAP policy paths under gap/policies/reference.
 * @param {string} [repoRoot]
 */
export function listGapReferencePolicies(repoRoot) {
  const dir = join(repoRoot ?? join(GAP_ROOT, "../.."), "AEP-Components/gap/policies/reference");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".gap"))
    .map((f) => join(dir, f))
    .sort();
}

/**
 * Resolve profile short name or full GAP address to a .gap file.
 * @param {string} profileRef
 * @param {string} [repoRoot]
 */
export function resolveGapProfileFile(profileRef, repoRoot) {
  const root = repoRoot ?? join(GAP_ROOT, "../..");
  const refDir = join(root, "AEP-Components/gap/policies/reference");
  if (!existsSync(refDir)) return null;

  const normalized = profileRef.trim();
  for (const file of readdirSync(refDir).filter((f) => f.endsWith(".gap"))) {
    const full = join(refDir, file);
    const { instruction, runtime } = parseGapFile(full);
    const profile = runtime.find((r) => r.kind === "aep.caw.profile");
    if (!profile) continue;
    const addr = instruction
      ? `${instruction.address.domain}/${instruction.address.id}`
      : null;
    if (
      profile.profile_id === normalized
      || profile.name === normalized
      || addr === normalized
      || basename(file, ".gap") === normalized
      || basename(file, ".gap").replace(/^caw-/, "") === normalized
    ) {
      return { file: full, instruction, profile, address: addr };
    }
  }
  return null;
}

/**
 * Extract all CAW mount profiles from GAP reference policies.
 * @param {string} [repoRoot]
 */
export function compileMountProfilesFromGap(repoRoot) {
  const profiles = {};
  for (const path of listGapReferencePolicies(repoRoot)) {
    const { instruction, runtime } = parseGapFile(path);
    const profile = runtime.find((r) => r.kind === "aep.caw.profile");
    if (!profile?.profile_id) continue;
    profiles[profile.profile_id] = {
      base_policy: profile.base_policy,
      mounts: (profile.mounts ?? []).map((m) => ({
        path: m.path,
        policy: m.policy,
      })),
      gap_address: instruction
        ? `${instruction.address.domain}/${instruction.address.id}`
        : null,
      enforcement_tier: profile.enforcement_tier ?? "shim",
      llm_proxy: profile.llm_proxy !== false,
      compiled_runtime: profile.compiled_runtime === true,
    };
  }
  return profiles;
}

/**
 * Build mount_profiles YAML block for CAW server config.
 * @param {string} [repoRoot]
 */
export function buildMountProfilesYaml(repoRoot) {
  const profiles = compileMountProfilesFromGap(repoRoot);
  const lines = ["mount_profiles:"];
  for (const [name, p] of Object.entries(profiles).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${name}:`);
    lines.push(`    base_policy: "${p.base_policy}"`);
    lines.push("    mounts:");
    for (const m of p.mounts) {
      lines.push(`      - path: "${m.path}"`);
      lines.push(`        policy: "${m.policy}"`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Merge GAP-compiled mount_profiles into a CAW server-config.yaml.
 * @param {string} serverConfigPath
 * @param {string} [repoRoot]
 */
export function mergeGapProfilesIntoCawConfig(serverConfigPath, repoRoot) {
  const profiles = compileMountProfilesFromGap(repoRoot);
  const parsed = existsSync(serverConfigPath)
    ? (YAML.parse(readFileSync(serverConfigPath, "utf8")) ?? {})
    : {};
  parsed.mount_profiles = {};
  for (const [name, profile] of Object.entries(profiles).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    parsed.mount_profiles[name] = {
      base_policy: profile.base_policy,
      mounts: (profile.mounts ?? []).map((mount) => ({
        path: mount.path,
        policy: mount.policy,
      })),
    };
  }
  writeFileSync(serverConfigPath, YAML.stringify(parsed), "utf8");
  return serverConfigPath;
}

/**
 * Materialize CAW runtime under AEP_DATA from GAP + bundled defaults.
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function materializeCawRuntimeFromGap(dataDir, repoRoot) {
  const root = repoRoot ?? join(GAP_ROOT, "../..");
  const cawRoot = join(dataDir, "caw-framework");
  const configPath = join(cawRoot, "server-config.yaml");
  const policiesDir = join(cawRoot, "policies");
  const bundledConfig = join(root, "AEP-Components/caw-framework/configs/server-config.yaml");
  const bundledPolicies = join(root, "AEP-Components/caw-framework/configs/policies");

  mkdirSync(cawRoot, { recursive: true });
  mkdirSync(policiesDir, { recursive: true });

  if (!existsSync(configPath) && existsSync(bundledConfig)) {
    copyFileSync(bundledConfig, configPath);
  }
  if (existsSync(bundledPolicies)) {
    for (const f of readdirSync(bundledPolicies).filter((n) => n.endsWith(".yaml"))) {
      const dest = join(policiesDir, f);
      if (!existsSync(dest)) copyFileSync(join(bundledPolicies, f), dest);
    }
  }

  for (const path of listGapReferencePolicies(root)) {
    const { runtime } = parseGapFile(path);
    for (const doc of runtime) {
      if (doc.kind !== "aep.caw.mount_policy" || !doc.name) continue;
      const out = join(policiesDir, `${doc.name}.yaml`);
      writeFileSync(out, YAML.stringify(doc.policy ?? {}), "utf8");
    }
  }

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf8");
    const parsed = YAML.parse(raw) ?? {};
    parsed.policies = parsed.policies ?? {};
    parsed.policies.dir = policiesDir;
    writeFileSync(configPath, YAML.stringify(parsed), "utf8");
  }

  mergeGapProfilesIntoCawConfig(configPath, root);
  return { configPath, policiesDir, profiles: compileMountProfilesFromGap(root) };
}

/**
 * Synthesize task-manifest-v1 from GAP template + request fields.
 * @param {object} req
 * @param {string} [repoRoot]
 */
export function synthesizeTaskManifestFromGap(req, repoRoot) {
  const root = repoRoot ?? join(GAP_ROOT, "../..");
  const templatePath = join(root, "AEP-Components/gap/policies/reference/task-manifest-v1.gap");
  if (!existsSync(templatePath)) {
    throw new Error("missing task-manifest-v1.gap");
  }
  const { runtime } = parseGapFile(templatePath);
  const tmpl = runtime.find((r) => r.kind === "aep.task_manifest.template");
  if (!tmpl) throw new Error("task-manifest-v1.gap missing aep.task_manifest.template document");

  const now = Math.floor(Date.now() / 1000);
  const agentId = req.agent_id ?? "agent-default";
  const sessionId = req.session_id ?? "";
  const id = req.id ?? `TM-${agentId}-${now}`;

  return {
    manifest_version: "1",
    id,
    agent_id: agentId,
    session_id: sessionId || undefined,
    intent: {
      summary: req.intent_summary ?? req.intent ?? "",
      allowed_operations: req.allowed_operations ?? req.operations ?? ["lattice:cross"],
      caw_profile: req.caw_profile ?? tmpl.defaults?.caw_profile ?? "agent-sandbox",
      gap_address: req.gap_address ?? tmpl.defaults?.gap_address ?? "dev.aep.caw/agent-sandbox.v1",
      coding_governance: req.coding_governance ?? undefined,
    },
    trust: {
      tier: req.trust_tier ?? tmpl.defaults?.trust_tier ?? "standard",
      max_trust_score: req.trust_score ?? tmpl.defaults?.max_trust_score ?? 700,
    },
    mcp: req.mcp ?? tmpl.defaults?.mcp,
    provisional: req.provisional ?? false,
    synthesized_by: "gap_constrained",
    created_at_unix: now,
  };
}

/**
 * Validate plan materialization fields against GAP implementation-plan template.
 * @param {object} plan
 * @param {string} [repoRoot]
 */
export function validatePlanAgainstGapTemplate(plan, repoRoot) {
  const root = repoRoot ?? join(GAP_ROOT, "../..");
  const templatePath = join(root, "AEP-Components/gap/policies/reference/implementation-plan-v1.gap");
  if (!existsSync(templatePath)) return { valid: true, warnings: [] };
  const { runtime } = parseGapFile(templatePath);
  const tmpl = runtime.find((r) => r.kind === "aep.implementation_plan.template");
  const warnings = [];
  if (!plan.plan_version) warnings.push("plan_version required");
  if (!plan.policy_overrides?.gap?.enabled && tmpl?.require_gap !== false) {
    warnings.push("GAP-centric plans should set policy_overrides.gap.enabled");
  }
  return { valid: warnings.length === 0, warnings };
}

/**
 * List GAP CAW profiles for registry/API.
 * @param {string} [repoRoot]
 */
export function listGapCawProfiles(repoRoot) {
  return Object.entries(compileMountProfilesFromGap(repoRoot)).map(([name, p]) => ({
    name,
    base_policy: p.base_policy,
    mounts: p.mounts,
    gap_address: p.gap_address,
    enforcement_tier: p.enforcement_tier,
    llm_proxy: p.llm_proxy,
    compiled_runtime: p.compiled_runtime,
  }));
}

function isMain(importMetaUrl) {
  const entry = process.argv[1] ?? "";
  return importMetaUrl.endsWith(entry) || entry.endsWith("gap-compile.mjs");
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const repoRoot = join(GAP_ROOT, "../..");
  if (args.includes("--emit-mount-profiles")) {
    process.stdout.write(buildMountProfilesYaml(repoRoot));
    process.exit(0);
  }
  if (args.includes("--list-profiles")) {
    console.log(JSON.stringify(listGapCawProfiles(repoRoot), null, 2));
    process.exit(0);
  }
  if (args[0] === "--materialize" && args[1]) {
    const out = materializeCawRuntimeFromGap(args[1], repoRoot);
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  console.error("Usage: gap-compile.mjs --list-profiles | --emit-mount-profiles | --materialize <AEP_DATA>");
  process.exit(1);
}