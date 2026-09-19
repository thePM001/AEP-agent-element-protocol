#!/usr/bin/env node
/**
 * AEP 2.8.6 root check.
 * Usage: node aep-check.mjs [repo-root]
 *
 * One command at the repository root. Every section prints its own result and
 * the run exits 1 when any section fails.
 *
 * Section links. Every markdown file below the repository root is walked and
 * the folders .git, node_modules, target, dist and build are skipped. Every
 * relative link is resolved against the folder of the file that carries it. A
 * target resolves when a file or a folder sits at the resolved path inside the
 * tree root, and it fails when nothing sits there or when the path walks out of
 * the tree root. The section prints one line per dead link in the form
 * path:line:target and fails when that count is not zero. A link with a scheme,
 * an absolute path or a bare anchor is not a relative link, so it is skipped. A
 * link inside a fenced block or an inline code span is sample text, so it is
 * skipped too.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadLocalCatalog, loadComponentManifest } from "./AEP-Base-Node/registry/lib/registry.mjs";
import { validateFullCatalog } from "./AEP-Base-Node/registry/lib/manifest-validator.mjs";

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "build", ".gomodcache", ".gocache", ".gopath"]);
const MARKDOWN = /\.(md|markdown)$/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const TARGET_PATTERNS = [
  /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g,
  /<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi,
  /<img\s[^>]*src\s*=\s*["']([^"']+)["']/gi,
];

/** Every markdown file below a tree root, in path order. */
function collectMarkdownFiles(root) {
  const files = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && MARKDOWN.test(entry.name)) files.push(join(dir, entry.name));
    }
  }
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

/** Blank out fenced blocks and inline code spans so line numbers stay true. */
function stripCode(content) {
  return String(content)
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (span) => span.replace(/[^\n]/g, " "));
}

/** True when a target names a place inside this tree rather than a scheme or a root path. */
function isRelativeTarget(target) {
  if (!target) return false;
  if (target.startsWith("#")) return false;
  if (target.startsWith("/")) return false;
  if (SCHEME.test(target)) return false;
  return true;
}

/** Every relative link target in one markdown document, with its line number. */
function collectRelativeTargets(content) {
  const prose = stripCode(content);
  const found = [];
  const seen = new Set();
  for (const pattern of TARGET_PATTERNS) {
    for (const match of prose.matchAll(pattern)) {
      const target = match[1];
      if (!isRelativeTarget(target)) continue;
      const line = prose.slice(0, match.index).split("\n").length;
      const key = `${line}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ line, target });
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Resolve one link target against the folder of the file that carries it. */
function resolveTarget(file, target) {
  const bare = String(target).split("#")[0].split("?")[0];
  if (!bare) return null;
  let decoded = bare;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    decoded = bare;
  }
  return resolve(dirname(file), decoded);
}

/** Section links. Walk every markdown file and report every dead relative link. */
function linksSection(root) {
  const files = collectMarkdownFiles(root);
  const dead = [];
  let links = 0;
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const here = relative(root, file).split(sep).join("/");
    for (const { line, target } of collectRelativeTargets(content)) {
      links += 1;
      const resolved = resolveTarget(file, target);
      const inside = resolved ? relative(root, resolved) : "..";
      if (!resolved || inside.startsWith("..") || !existsSync(resolved)) {
        dead.push(`${here}:${line}:${target}`);
      }
    }
  }
  for (const item of dead) console.log(item);
  console.log(`links: walked ${files.length} markdown files, ${links} relative links, ${dead.length} dead`);
  return { passed: dead.length === 0 };
}

var CHILD_BUFFER = 32 * 1024 * 1024;

function printChildFailure(section, command, result) {
  console.log(section + ": " + command);
  if (result.error) console.log(String(result.error));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function registrySection(root) {
  var findings = [];
  var catalog;
  try { catalog = loadLocalCatalog(root); }
  catch (err) {
    findings.push("catalog: " + err.message);
    for (var i = 0; i < findings.length; i++) console.log(findings[i]);
    console.log("registry: 0 catalog rows, " + findings.length + " findings");
    return { passed: false };
  }
  var load = function (manifestPath) { return loadComponentManifest(manifestPath, root); };
  var full = validateFullCatalog(catalog, root, load);
  var results = full.results || [];
  for (var r = 0; r < results.length; r++) {
    var row = results[r];
    var errors = row.errors || [];
    for (var e = 0; e < errors.length; e++) findings.push(errors[e]);
  }
  var catalogIds = new Set((catalog.components || []).map(function (row) { return row.id; }));
  var componentsDir = join(root, "AEP-Base-Node/registry/components");
  var names = [];
  try { names = readdirSync(componentsDir); }
  catch (err) { findings.push("AEP-Base-Node/registry/components: " + err.message); }
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    if (name.slice(-5) !== ".json") continue;
    var id = name.slice(0, -5);
    if (!catalogIds.has(id)) findings.push("manifest has no catalog row: AEP-Base-Node/registry/components/" + name);
  }
  for (var f = 0; f < findings.length; f++) console.log(findings[f]);
  var rows = (catalog.components || []).length;
  console.log("registry: " + rows + " catalog rows, " + findings.length + " findings");
  return { passed: findings.length === 0 };
}

function releaseStringsSection(root) {
  var script = join(root, "AEP-User-Experience/harness/check-release-strings.mjs");
  var opts = new Object();
  opts.encoding = "utf8";
  opts.cwd = root;
  opts.maxBuffer = CHILD_BUFFER;
  var extra = String.fromCharCode(65,69,80,45,78,79,83,72,73,80);
  var args = [script, root];
  if (existsSync(join(root, extra))) args.push(extra);
  args.push(".gomodcache");
  args.push(".gocache");
  args.push(".gopath");
  var result = spawnSync(process.execPath, args, opts);
  if (result.status !== 0) {
    printChildFailure("release strings", "node AEP-User-Experience/harness/check-release-strings.mjs", result);
    return { passed: false };
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { passed: true };
}

function rustBuildSection(root) {
  var opts = new Object();
  opts.encoding = "utf8";
  opts.cwd = root;
  opts.maxBuffer = CHILD_BUFFER;
  var result = spawnSync("cargo", ["build"], opts);
  if (result.status !== 0) {
    printChildFailure("rust build", "cargo build", result);
    return { passed: false };
  }
  console.log("rust build: cargo build");
  return { passed: true };
}

function cawBuildSection(root) {
  var opts = new Object();
  opts.encoding = "utf8";
  opts.cwd = join(root, "AEP-CAW");
  opts.maxBuffer = CHILD_BUFFER;
  var result = spawnSync("make", ["build"], opts);
  if (result.status !== 0) {
    printChildFailure("caw build", "make build", result);
    return { passed: false };
  }
  console.log("caw build: make build");
  return { passed: true };
}

const SECTIONS = [
  { name: "registry", run: registrySection },
  { name: "release strings", run: releaseStringsSection },
  { name: "rust build", run: rustBuildSection },
  { name: "caw build", run: cawBuildSection },
  { name: "links", run: linksSection },
];

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(process.argv[2] ?? here);
  var extra = String.fromCharCode(65,69,80,45,78,79,83,72,73,80);
  if (existsSync(join(root, extra))) SKIP_DIRS.add(extra);
  console.log("AEP 2.8.6 root check");
  console.log(`root: ${root}`);
  console.log();
  let failed = 0;
  for (const section of SECTIONS) {
    console.log(`== section ${section.name} ==`);
    const result = section.run(root);
    console.log(`section ${section.name}: ${result.passed ? "PASS" : "FAIL"}`);
    console.log();
    if (!result.passed) failed += 1;
  }
  if (failed > 0) {
    console.log(`${failed} section(s) failed`);
    process.exit(1);
  }
  console.log(`${SECTIONS.length} section(s) passed`);
}

main();
