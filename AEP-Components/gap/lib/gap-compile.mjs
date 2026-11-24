#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GAP_ROOT = join(__dirname, "..");
export const GAP_REFERENCE_DIR = join(GAP_ROOT, "policies/reference");
export const GAP_POLICY_SYSTEM_DIR = join(GAP_ROOT, "../../AEP-Policy-System/reference");

const AEP_RUNTIME_KINDS = new Set([
  "aep.caw.profile",
  "aep.caw.mount_policy",
  "aep.caw.egress_policy",
  "aep.caw.toolset",
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
      enforcement_tier: profile.enforcement_tier ?? "none",
      egress_policy: profile.egress_policy ?? null,
      toolset: profile.toolset ?? null,
      llm_proxy: profile.llm_proxy !== false,
      compiled_runtime: profile.compiled_runtime === true,
    };
  }
  return profiles;
}

/** The only tier the Rust CAW runs. */
export const CAW_TIER_GVISOR = "gvisor";

/** Name and version of the resolved profile record. */
export const CAW_RESOLVED_RECORD = "aep.caw.resolved_profile";
export const CAW_RESOLVED_VERSION = 1;

/** A reference policy that cannot be compiled. `code` names the reason. */
export class GapCompileError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "GapCompileError";
    this.code = code;
  }
}

const PROFILE_KEYS = new Set([
  "kind",
  "profile_id",
  "name",
  "base_policy",
  "enforcement_tier",
  "llm_proxy",
  "compiled_runtime",
  "mounts",
  "egress_policy",
  "toolset",
]);
const MOUNT_KEYS = new Set(["path", "policy"]);
const POLICY_KEYS = new Set(["version", "name", "description", "file_rules", "command_rules"]);
const FILE_RULE_KEYS = new Set(["name", "description", "paths", "operations", "decision"]);
const COMMAND_RULE_KEYS = new Set(["name", "description", "commands", "decision"]);
const EGRESS_KEYS = new Set(["kind", "name", "description", "unmatched", "routes"]);
const ROUTE_KEYS = new Set(["name", "scheme", "host", "port", "decision"]);
const TOOLSET_KEYS = new Set(["kind", "name", "description", "programs", "trees"]);
const TREE_KEYS = new Set(["name", "source", "path", "bin"]);
const PROGRAM_KEYS = new Set(["name", "source", "path"]);

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const HOST_VARIABLE_RE = /^\$\{[A-Z][A-Z0-9_]*\}$/;
const PROGRAM_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
// A tree source is an absolute path. It may start with one variable.
const TREE_SOURCE_RE = /^(\$\{[A-Z][A-Z0-9_]*\}|\/)[^\0]*$/;
// Trees of a toolset land in the program and library part of the root.
const TREE_ROOTS = ["/usr", "/lib", "/lib32", "/lib64", "/libx32"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refuseUnknownKeys(value, known, what) {
  if (!isObject(value)) {
    throw new GapCompileError("not-a-record", `${what} is not a record`);
  }
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw new GapCompileError("unknown-key", `${what} holds the unknown key ${key}`);
    }
  }
}

function requireString(value, what) {
  if (typeof value !== "string" || value === "") {
    throw new GapCompileError("missing-field", `${what} must be a text that is not empty`);
  }
  return value;
}

function requireStringList(value, what) {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string" || v === "")) {
    throw new GapCompileError("missing-field", `${what} must be a list of texts that is not empty`);
  }
  return [...value];
}

/**
 * JSON text of a value with the keys of every record in sorted order and no
 * white space. Two equal values give the same text, so the text carries a digest.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (isObject(value)) {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Digest of a resolved profile record: sha256 over its canonical JSON without the
 * field digest.
 * @param {object} record
 * @returns {string}
 */
export function cawRecordDigest(record) {
  const { digest: _digest, ...rest } = record;
  return `sha256:${createHash("sha256").update(canonicalJson(rest), "utf8").digest("hex")}`;
}

function normalizePolicy(doc, what) {
  const policy = doc.policy ?? {};
  refuseUnknownKeys(policy, POLICY_KEYS, what);
  const fileRules = (policy.file_rules ?? []).map((rule, i) => {
    const ruleWhat = `${what} file rule ${rule?.name ?? i + 1}`;
    refuseUnknownKeys(rule, FILE_RULE_KEYS, ruleWhat);
    return {
      name: requireString(rule.name, `the name of ${ruleWhat}`),
      paths: requireStringList(rule.paths, `the paths of ${ruleWhat}`),
      operations: requireStringList(rule.operations, `the operations of ${ruleWhat}`),
      decision: requireString(rule.decision, `the decision of ${ruleWhat}`),
    };
  });
  const commandRules = (policy.command_rules ?? []).map((rule, i) => {
    const ruleWhat = `${what} command rule ${rule?.name ?? i + 1}`;
    refuseUnknownKeys(rule, COMMAND_RULE_KEYS, ruleWhat);
    return {
      name: requireString(rule.name, `the name of ${ruleWhat}`),
      commands: requireStringList(rule.commands, `the commands of ${ruleWhat}`),
      decision: requireString(rule.decision, `the decision of ${ruleWhat}`),
    };
  });
  return { name: doc.name, file_rules: fileRules, command_rules: commandRules };
}

function normalizeEgressPolicy(doc) {
  const what = `egress policy ${doc.name}`;
  refuseUnknownKeys(doc, EGRESS_KEYS, what);
  if (doc.unmatched !== undefined && doc.unmatched !== "deny") {
    throw new GapCompileError(
      "egress-unmatched",
      `${what} sets unmatched to ${doc.unmatched}. A destination with no route is always denied.`,
    );
  }
  if (!Array.isArray(doc.routes) || doc.routes.length === 0) {
    throw new GapCompileError("missing-field", `${what} has no route`);
  }
  const seen = new Set();
  const routes = doc.routes.map((route, i) => {
    const routeWhat = `${what} route ${route?.name ?? i + 1}`;
    refuseUnknownKeys(route, ROUTE_KEYS, routeWhat);
    const name = requireString(route.name, `the name of ${routeWhat}`);
    if (seen.has(name)) {
      throw new GapCompileError("duplicate-name", `${what} holds two routes named ${name}`);
    }
    seen.add(name);
    if (route.scheme !== "http" && route.scheme !== "https") {
      throw new GapCompileError("egress-route", `${routeWhat} needs the scheme http or https`);
    }
    const host = requireString(route.host, `the host of ${routeWhat}`);
    const numericEnd = /^[0-9]+$/.test(host.split(".").pop() ?? "");
    if ((!HOST_RE.test(host) || numericEnd) && !HOST_VARIABLE_RE.test(host)) {
      throw new GapCompileError(
        "egress-route",
        `${routeWhat} needs a lower case host name, a wildcard under one domain or one variable. An address is not a host name.`,
      );
    }
    if (!Number.isInteger(route.port) || route.port < 1 || route.port > 65535) {
      throw new GapCompileError("egress-route", `${routeWhat} needs a port from 1 to 65535`);
    }
    if (route.decision !== "allow" && route.decision !== "deny") {
      throw new GapCompileError("egress-route", `${routeWhat} needs the decision allow or deny`);
    }
    return { name, scheme: route.scheme, host, port: route.port, decision: route.decision };
  });
  return { name: doc.name, unmatched: "deny", routes };
}

function normalizeToolset(doc) {
  const what = `toolset ${doc.name}`;
  refuseUnknownKeys(doc, TOOLSET_KEYS, what);
  if (!Array.isArray(doc.programs) || doc.programs.length === 0) {
    throw new GapCompileError("missing-field", `${what} has no program`);
  }
  const names = new Set();
  const paths = new Set();
  const programs = doc.programs.map((program, i) => {
    const programWhat = `${what} program ${program?.name ?? i + 1}`;
    refuseUnknownKeys(program, PROGRAM_KEYS, programWhat);
    const name = requireString(program.name, `the name of ${programWhat}`);
    if (!PROGRAM_NAME_RE.test(name)) {
      throw new GapCompileError("toolset-program", `${programWhat} has a name that is not a plain program name`);
    }
    const source = requireString(program.source, `the source of ${programWhat}`);
    const path = program.path === undefined ? `/usr/bin/${name}` : requireString(program.path, `the path of ${programWhat}`);
    for (const [label, value] of [["source", source], ["path", path]]) {
      if (!value.startsWith("/") || value.split("/").includes("..")) {
        throw new GapCompileError("toolset-program", `the ${label} of ${programWhat} must be an absolute path with no parent step`);
      }
    }
    if (names.has(name)) {
      throw new GapCompileError("duplicate-name", `${what} holds two programs named ${name}`);
    }
    if (paths.has(path)) {
      throw new GapCompileError("duplicate-name", `${what} places two programs at ${path}`);
    }
    names.add(name);
    paths.add(path);
    return { name, source, path };
  });
  const treeNames = new Set();
  const treePaths = [];
  const trees = (doc.trees ?? []).map((tree, i) => {
    const treeWhat = `${what} tree ${tree?.name ?? i + 1}`;
    refuseUnknownKeys(tree, TREE_KEYS, treeWhat);
    const name = requireString(tree.name, `the name of ${treeWhat}`);
    if (!NAME_RE.test(name)) {
      throw new GapCompileError("toolset-tree", `${treeWhat} has no plain lower case name`);
    }
    const source = requireString(tree.source, `the source of ${treeWhat}`);
    const path = requireString(tree.path, `the path of ${treeWhat}`);
    const steps = (value) => value.split("/").some((part) => part === ".." || part === ".");
    if (!TREE_SOURCE_RE.test(source) || steps(source) || source.endsWith("/")) {
      throw new GapCompileError(
        "toolset-tree",
        `the source of ${treeWhat} must be an absolute folder path or start with one variable, with no parent step`,
      );
    }
    const inRoot = TREE_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
    if (!path.startsWith("/") || steps(path) || path.endsWith("/") || path.includes("//") || !inRoot || TREE_ROOTS.includes(path)) {
      throw new GapCompileError(
        "toolset-tree",
        `the path of ${treeWhat} must be a folder below /usr or a library folder of the root, in plain form`,
      );
    }
    let bin = null;
    if (tree.bin !== undefined && tree.bin !== null) {
      bin = requireString(tree.bin, `the bin folder of ${treeWhat}`);
      if (bin.startsWith("/") || steps(bin) || bin.endsWith("/") || bin.includes("//")) {
        throw new GapCompileError("toolset-tree", `the bin folder of ${treeWhat} must be a plain path inside the tree`);
      }
    }
    if (treeNames.has(name)) {
      throw new GapCompileError("duplicate-name", `${what} holds two trees named ${name}`);
    }
    for (const other of treePaths) {
      if (other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`)) {
        throw new GapCompileError("toolset-tree", `${what} places the trees ${other} and ${path} inside each other`);
      }
    }
    for (const program of programs) {
      if (program.path === path || program.path.startsWith(`${path}/`)) {
        throw new GapCompileError(
          "toolset-tree",
          `${what} places the program ${program.name} inside the tree ${name}. The tree brings its own programs.`,
        );
      }
    }
    treeNames.add(name);
    treePaths.push(path);
    return { name, source, path, bin };
  });
  return { name: doc.name, programs, trees };
}

/**
 * Collect every CAW record of the reference policies, each kind by its name.
 * Two records of one kind with the same name are refused.
 * @param {string} [repoRoot]
 */
export function collectCawRecords(repoRoot) {
  const profiles = new Map();
  const mountPolicies = new Map();
  const egressPolicies = new Map();
  const toolsets = new Map();
  const add = (map, name, value, kind, path) => {
    if (typeof name !== "string" || !NAME_RE.test(name)) {
      throw new GapCompileError("record-name", `a record of the kind ${kind} in ${basename(path)} has no plain lower case name`);
    }
    if (map.has(name)) {
      throw new GapCompileError("duplicate-name", `two records of the kind ${kind} are named ${name}`);
    }
    map.set(name, value);
  };
  for (const path of listGapReferencePolicies(repoRoot)) {
    const { instruction, runtime } = parseGapFile(path);
    for (const doc of runtime) {
      if (doc.kind === "aep.caw.profile") {
        const address = instruction ? `${instruction.address.domain}/${instruction.address.id}` : null;
        add(profiles, doc.profile_id, { doc, address }, doc.kind, path);
      } else if (doc.kind === "aep.caw.mount_policy") {
        add(mountPolicies, doc.name, doc, doc.kind, path);
      } else if (doc.kind === "aep.caw.egress_policy") {
        add(egressPolicies, doc.name, doc, doc.kind, path);
      } else if (doc.kind === "aep.caw.toolset") {
        add(toolsets, doc.name, doc, doc.kind, path);
      }
    }
  }
  return { profiles, mountPolicies, egressPolicies, toolsets };
}

function resolveFromRecords(profileId, records) {
  const hit = records.profiles.get(profileId);
  if (!hit) {
    throw new GapCompileError("unknown-profile", `no CAW profile is named ${profileId}`);
  }
  const { doc, address } = hit;
  const what = `profile ${profileId}`;
  refuseUnknownKeys(doc, PROFILE_KEYS, what);
  if (doc.enforcement_tier !== CAW_TIER_GVISOR) {
    throw new GapCompileError(
      "tier",
      `${what} has the tier ${doc.enforcement_tier ?? "none"}. The CAW runs only profiles of the tier ${CAW_TIER_GVISOR}.`,
    );
  }
  for (const field of ["llm_proxy", "compiled_runtime"]) {
    if (typeof doc[field] !== "boolean") {
      throw new GapCompileError("missing-field", `${what} must set ${field} to true or false`);
    }
  }
  const policyOf = (name, use) => {
    const policyDoc = records.mountPolicies.get(requireString(name, `the ${use} of ${what}`));
    if (!policyDoc) {
      throw new GapCompileError("unknown-policy", `${what} names the mount policy ${name}, which no reference policy defines`);
    }
    return normalizePolicy(policyDoc, `mount policy ${name}`);
  };
  if (!Array.isArray(doc.mounts) || doc.mounts.length === 0) {
    throw new GapCompileError("missing-field", `${what} has no mount`);
  }
  const mounts = doc.mounts.map((mount, i) => {
    refuseUnknownKeys(mount, MOUNT_KEYS, `mount ${i + 1} of ${what}`);
    return {
      path: requireString(mount.path, `the path of mount ${i + 1} of ${what}`),
      policy: policyOf(mount.policy, `policy of mount ${i + 1}`),
    };
  });
  if (doc.toolset === undefined || doc.toolset === null) {
    throw new GapCompileError("no-toolset", `${what} names no toolset. A sandbox with no program runs nothing.`);
  }
  const toolsetDoc = records.toolsets.get(requireString(doc.toolset, `the toolset of ${what}`));
  if (!toolsetDoc) {
    throw new GapCompileError("unknown-toolset", `${what} names the toolset ${doc.toolset}, which no reference policy defines`);
  }
  let egress = null;
  if (doc.egress_policy !== undefined && doc.egress_policy !== null) {
    const egressDoc = records.egressPolicies.get(requireString(doc.egress_policy, `the egress policy of ${what}`));
    if (!egressDoc) {
      throw new GapCompileError("unknown-egress-policy", `${what} names the egress policy ${doc.egress_policy}, which no reference policy defines`);
    }
    egress = normalizeEgressPolicy(egressDoc);
  }
  if (doc.llm_proxy && !egress) {
    throw new GapCompileError(
      "llm-proxy-without-route",
      `${what} sets llm_proxy to true and names no egress policy. The route to the model gateway must be written down.`,
    );
  }
  const record = {
    record: CAW_RESOLVED_RECORD,
    version: CAW_RESOLVED_VERSION,
    profile_id: profileId,
    gap_address: address,
    enforcement_tier: CAW_TIER_GVISOR,
    llm_proxy: doc.llm_proxy,
    compiled_runtime: doc.compiled_runtime,
    base_policy: policyOf(doc.base_policy, "base policy"),
    mounts,
    egress_policy: egress,
    toolset: normalizeToolset(toolsetDoc),
  };
  return { ...record, digest: cawRecordDigest(record) };
}

/**
 * Resolve one CAW profile of the tier gvisor into its record: the profile with its
 * mount policies, egress policy and toolset in one value with a sha256 digest. The
 * record is the only policy input of the CAW. Variables such as PROJECT_ROOT are
 * kept as written. The CAW fills them at session create.
 * @param {string} profileId
 * @param {string} [repoRoot]
 */
export function resolveCawProfile(profileId, repoRoot) {
  return resolveFromRecords(profileId, collectCawRecords(repoRoot));
}

/**
 * Write the resolved record of every profile of the tier gvisor to
 * <dataDir>/caw-framework/profiles/<profile>.json. A profile of another tier is
 * listed as skipped, because the CAW does not run it. One profile that cannot be
 * resolved refuses the whole call and nothing is written.
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function materializeCawProfilesFromGap(dataDir, repoRoot) {
  const records = collectCawRecords(repoRoot);
  const resolved = [];
  const skipped = [];
  for (const [profileId, { doc }] of [...records.profiles].sort(([a], [b]) => a.localeCompare(b))) {
    if (doc.enforcement_tier !== CAW_TIER_GVISOR) {
      skipped.push({ profile_id: profileId, enforcement_tier: doc.enforcement_tier ?? "none" });
      continue;
    }
    resolved.push(resolveFromRecords(profileId, records));
  }
  const profilesDir = join(dataDir, "caw-framework", "profiles");
  mkdirSync(profilesDir, { recursive: true });
  const written = resolved.map((record) => {
    const path = join(profilesDir, `${record.profile_id}.json`);
    writeFileSync(path, `${canonicalJson(record)}\n`, "utf8");
    return { profile_id: record.profile_id, path, digest: record.digest };
  });
  return { profilesDir, profiles: written, skipped };
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
    egress_policy: p.egress_policy,
    toolset: p.toolset,
    llm_proxy: p.llm_proxy,
    compiled_runtime: p.compiled_runtime,
  }));
}

function isMain(importMetaUrl) {
  const entry = process.argv[1] ?? "";
  if (entry === "") return false;
  return importMetaUrl.endsWith(entry) || entry.endsWith("gap-compile.mjs");
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const repoRoot = join(GAP_ROOT, "../..");
  if (args.includes("--list-profiles")) {
    console.log(JSON.stringify(listGapCawProfiles(repoRoot), null, 2));
    process.exit(0);
  }
  try {
    if (args[0] === "--resolve" && args[1]) {
      console.log(JSON.stringify(resolveCawProfile(args[1], repoRoot), null, 2));
      process.exit(0);
    }
    if (args[0] === "--materialize" && args[1]) {
      console.log(JSON.stringify(materializeCawProfilesFromGap(args[1], repoRoot), null, 2));
      process.exit(0);
    }
  } catch (err) {
    if (err instanceof GapCompileError) {
      console.error(`gap-compile: ${err.code}: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  console.error("Usage: gap-compile.mjs --list-profiles | --resolve <profile> | --materialize <AEP_DATA>");
  process.exit(1);
}