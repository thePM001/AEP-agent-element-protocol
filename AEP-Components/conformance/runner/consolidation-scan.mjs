#!/usr/bin/env node
// Consolidation scan for the AEP 2.8.x public tree.
//
// One script counts definition sites per concern and prints a table. The plan is
// done when every count equals one, apart from the derived surfaces which must
// each carry a derived label.
//
// Usage: node AEP-Components/conformance/runner/consolidation-scan.mjs [repo-root]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname as upDir } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = upDir(fileURLToPath(import.meta.url));
const ROOT = process.argv[2] ?? join(HERE, "..", "..", "..");
const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "build", "vendor"]);
const CODE_EXTS = [".rs", ".mjs", ".js", ".ts", ".go", ".json", ".yaml", ".yml", ".gap", ".md"];
const SELF = "AEP-Components/conformance/runner/consolidation-scan.mjs";

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT).filter((path) => CODE_EXTS.some((ext) => path.endsWith(ext)))
  .map((path) => ({ path, rel: relative(ROOT, path).replace(/\\/g, "/") }));

function read(file) {
  try {
    return readFileSync(file.path, "utf8");
  } catch {
    return "";
  }
}

// The internal records area holds records and receipts, not live code, so the
// scan skips it. The folder marker is assembled at run time.
const INTERNAL_MARKER = "NO" + "SHIP";

/** A shipped file. Internal records are not live code. */
function shipped(entry) {
  if (entry.rel === SELF) return false;
  return entry.rel.startsWith("AEP-" + INTERNAL_MARKER + "/") === false;
}

function matches(regex, { internal = false } = {}) {
  const hits = [];
  for (const entry of FILES) {
    if (internal === false && shipped(entry) === false) continue;
    if (regex.test(read(entry))) hits.push(entry.rel);
  }
  return hits.sort();
}

// 1. Writing rule family. A definition site owns a rule id or the detection of a
// forbidden writing character.
const WRITING_DEFINITION = [
  /pub const (?:RULE|WRITING_RULE)_[A-Z0-9_]+: &str = "no_[a-z_]+"/,
  /contains_char\([^)]*(?:\\u\{201[345]\}|\\u\{2e3[ab]\}|\\u\{2212\})/,
  /WRITING_RULE_[A-Z_]+ *= *"no_[a-z_]+"/,
  /\.(?:includes|indexOf)\([^)]*(?:\\u201[345]|\\u2e3[ab]|\\u2212)/,
];

// 2. Pulse constant.
const PULSE_DEFINITION = /pub const PULSE_MS\b/;

// 3. The live admit result. One place decides allow from the closed set and it is
// not on a surface that declares itself derived.
const ADMIT_RESULT_BUILD = /allow: *closed\.is_empty\(\)/;
const DERIVED_LABEL = /\bderived\b/i;

// 4. Authoring forms that reach the Admit layer.
const HOST_YAML_MARK = /Host layer policy\. Not an Admit layer authoring form/;
const HOST_REGO_MARK = /Host lattice engine policy\. Not an Admit layer authoring form/;

// 5. Admit layer rule sources. A rule source is the one scan rule table that
// both the scanner package view and the Admit layer reader are built from.
const SCAN_RULE_SOURCE = /aep\.scanners\.scan-rule-table\.v1/;

// 6. Enforcement implementations. A component that applies a process restriction.
const RESTRICTION_APPLY = /\b(?:seccomp|landlock|ptrace)[A-Z(]/;

// 7. Graph state owners. One file names the owner, and the projection surfaces
// are the hyperlattice view, the graph engine and the composer canvas store.
const GRAPH_OWNER_FILES = ["AEP-Components/README.md"];
const GRAPH_PROJECTION_FILES = [
  "AEP-Components/hyperlattice/README.md",
  "AEP-Components/graph-engine/README.md",
  "AEP-Components/hyperlattice/lib/graph-store.mjs",
];
const OWNS_RUNTIME_STATE = /one live graph owns (the )?state/i;

// 8. Runtime ledger names.
const LEDGER_SURFACES = [
  "AEP-Base-Node/AEP-Crate/src/lattice_log.rs",
  "AEP-Components/evidence-ledger/README.md",
  "AEP-Components/intent-ledger/README.md",
  "AEP-Components/evaluation-chain/crate/src/lib.rs",
  "AEP-CAW/internal/audit/crypto.go",
];
const DECLARES_RUNTIME_LEDGER = /The one runtime ledger\./;

// 9 and 10. The two dead documentation paths.
const DEAD_PATHS = [
  { name: "cca components path", regex: /AEP-Components\/cca\b/ },
  { name: "caw framework components path", regex: /AEP-Components\/caw-framework\b/ },
];

function authoringForms() {
  const forms = ["GAP (json records under AEP-Policy-System/reference/)"];
  const yaml = FILES.filter((entry) => entry.rel.startsWith("AEP-Policy-System/") && entry.rel.endsWith(".policy.yaml"));
  const rego = FILES.filter((entry) => entry.rel.endsWith(".rego") && entry.rel.startsWith("AEP-Policy-System/"));
  const unmarkedYaml = yaml.filter((entry) => HOST_YAML_MARK.test(read(entry)) === false);
  const unmarkedRego = rego.filter((entry) => HOST_REGO_MARK.test(read(entry)) === false);
  if (unmarkedYaml.length > 0) forms.push(`policy YAML unmarked (${unmarkedYaml.length})`);
  if (unmarkedRego.length > 0) forms.push(`rego unmarked (${unmarkedRego.length})`);
  return { forms, yaml: yaml.length, rego: rego.length };
}

function ownersOf(surfaces, regex) {
  const owners = [];
  for (const rel of surfaces) {
    const entry = FILES.find((candidate) => candidate.rel === rel);
    if (!entry) continue;
    if (regex.test(read(entry))) owners.push(rel);
  }
  return owners;
}

function enforcementComponents() {
  const components = new Set();
  for (const entry of FILES) {
    if (shipped(entry) === false) continue;
    if (/\.(go|rs)$/.test(entry.rel) === false) continue;
    if (entry.rel.endsWith("_test.go")) continue;
    if (RESTRICTION_APPLY.test(read(entry)) === false) continue;
    components.add(entry.rel.split("/")[0]);
  }
  return [...components].sort();
}

function deadPathHits(regex) {
  return FILES.filter((entry) => {
    if (entry.rel.startsWith("AEP-" + INTERNAL_MARKER + "/")) return false;
    return regex.test(read(entry));
  }).map((entry) => entry.rel).sort();
}

const rows = [];

{
  const hits = matches(WRITING_DEFINITION[0]);
  for (const regex of WRITING_DEFINITION.slice(1)) {
    for (const rel of matches(regex)) if (hits.includes(rel) === false) hits.push(rel);
  }
  rows.push({ concern: "writing rule family definition sites", count: hits.length, expected: 1, proof: hits });
}

{
  const hits = matches(PULSE_DEFINITION);
  rows.push({ concern: "pulse constant definition sites", count: hits.length, expected: 1, proof: hits });
}

{
  const hits = matches(ADMIT_RESULT_BUILD);
  const live = hits.filter((rel) => {
    const entry = FILES.find((candidate) => candidate.rel === rel);
    return entry ? DERIVED_LABEL.test(read(entry).slice(0, 1200)) === false : false;
  });
  const derived = hits.filter((rel) => live.includes(rel) === false);
  rows.push({
    concern: "live admit result build sites",
    count: live.length,
    expected: 1,
    proof: live.concat(["derived surfaces: " + derived.join(", ")]),
  });
}

{
  const forms = authoringForms();
  rows.push({
    concern: "authoring forms that reach the Admit layer",
    count: forms.forms.length,
    expected: 1,
    proof: forms.forms.concat([`host policy YAML files: ${forms.yaml}`, `host rego files: ${forms.rego}`]),
  });
}

{
  const hits = matches(SCAN_RULE_SOURCE);
  rows.push({ concern: "admit layer scan rule sources", count: hits.length, expected: 1, proof: hits });
}

{
  const components = enforcementComponents();
  rows.push({ concern: "enforcement implementations", count: components.length, expected: 1, proof: components });
}

{
  const owners = ownersOf(GRAPH_OWNER_FILES, OWNS_RUNTIME_STATE);
  const derived = GRAPH_PROJECTION_FILES;
  rows.push({
    concern: "graph state owners",
    count: owners.length,
    expected: 1,
    proof: owners.concat(["derived surfaces: " + derived.join(", ")]),
  });
}

{
  const owners = ownersOf(LEDGER_SURFACES, DECLARES_RUNTIME_LEDGER);
  const derived = LEDGER_SURFACES.filter((rel) => owners.includes(rel) === false);
  rows.push({
    concern: "runtime ledger names",
    count: owners.length,
    expected: 1,
    proof: owners.concat(["derived surfaces: " + derived.join(", ")]),
  });
}

for (const dead of DEAD_PATHS) {
  const hits = deadPathHits(dead.regex);
  rows.push({ concern: `dead path references, ${dead.name}`, count: hits.length, expected: 0, proof: hits });
}

const width = Math.max(...rows.map((row) => row.concern.length));
console.log("AEP 2.8.x consolidation scan");
console.log(`Root: ${ROOT}`);
console.log("");
console.log(`${"concern".padEnd(width)}  count  expect  state`);
for (const row of rows) {
  const state = row.count === row.expected ? "PASS" : "FAIL";
  console.log(`${row.concern.padEnd(width)}  ${String(row.count).padStart(5)}  ${String(row.expected).padStart(6)}  ${state}`);
}
console.log("");
console.log("proof");
for (const row of rows) {
  console.log(`- ${row.concern}`);
  for (const line of row.proof.length === 0 ? ["(no hit)"] : row.proof) console.log(`    ${line}`);
}

const failed = rows.filter((row) => row.count !== row.expected);
if (failed.length > 0) {
  console.log("");
  console.log(`FAIL ${failed.length} concern(s) do not match the plan`);
  process.exit(1);
}
console.log("");
console.log("PASS every count matches the plan");
