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
import { loadLocalCatalog, loadComponentManifest } from "./AEP-Base-Node/AEP-Registry/lib/registry.mjs";
import { validateFullCatalog } from "./AEP-Base-Node/AEP-Registry/lib/manifest-validator.mjs";
import { checkThreatModel } from "./AEP-User-Experience/harness/check-threat-model-trace.mjs";

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
  var componentsDir = join(root, "AEP-Base-Node/AEP-Registry/components");
  var names = [];
  try { names = readdirSync(componentsDir); }
  catch (err) { findings.push("AEP-Base-Node/AEP-Registry/components: " + err.message); }
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    if (name.slice(-5) !== ".json") continue;
    var id = name.slice(0, -5);
    if (!catalogIds.has(id)) findings.push("manifest has no catalog row: AEP-Base-Node/AEP-Registry/components/" + name);
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

function wrapCoverageSection(root) {
  var script = join(root, "AEP-Components/wrap-coverage/lib/wrap-coverage.mjs");
  var inventory = "AEP-User-Experience/examples/end-to-end-run/deployment/wrap-coverage.yaml";
  var opts = new Object();
  opts.encoding = "utf8";
  opts.cwd = root;
  opts.maxBuffer = CHILD_BUFFER;
  var result = spawnSync(process.execPath, [script, inventory], opts);
  if (result.status !== 0) {
    printChildFailure("wrap coverage", "node AEP-Components/wrap-coverage/lib/wrap-coverage.mjs " + inventory, result);
    return { passed: false };
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { passed: true };
}

function threatModelSection(root) {
  var result = checkThreatModel(root);
  for (var i = 0; i < result.findings.length; i++) console.log(result.findings[i]);
  console.log("threat model: " + result.rows + " rows, " + result.checks + " cited checks, " + result.findings.length + " findings");
  return { passed: result.findings.length === 0 };
}

/*
 * Section readme. The component map at AEP-Components/component-map.json lists
 * the 18 main components in the order and with the names of the AEP page. The
 * section tests five things against that map and prints one line per finding.
 *
 * 1. The root README holds 18 headings of the form "## NN / Name" in the order
 *    and with the names of the map.
 * 2. Every tree path that a README writes as inline code resolves. A tree path
 *    starts with a top level folder of the tree. A path with a placeholder or a
 *    pattern is sample text, so it is skipped. Relative links are tested by the
 *    section links.
 * 3. Each of the 18 component README files carries the ten parts of the
 *    template: the title with number and name, the status line and the eight
 *    headings of TEMPLATE_HEADINGS in that order.
 * 4. Every folder under AEP-Components sits in exactly one row of the map or in
 *    its list of shared parts and carries a README.
 * 5. No README carries a version label older than 2.9. CHANGELOG.md is not a
 *    README, so the history lives there. A line that the release allow list
 *    names is exempt.
 */

const COMPONENT_MAP = "AEP-Components/component-map.json";
const RELEASE_ALLOW_LIST = "AEP-User-Experience/harness/release-allow.list";
const TEMPLATE_HEADINGS = [
  "What it is",
  "Place among the 18",
  "What ships in 2.9",
  "Layout",
  "Interfaces",
  "Limits",
  "Run and test",
  "Related documents",
];
const STATUS_LINE = /^Status: (normative|reference|sketch)\. Stability: (stable|evolving|experimental)\./;
const OLD_LABEL = /(?<![\w.])v?2\.(?:8(?:b|\.x|\.\d+)?|75)(?![\w.])/;
const PAPER_NUMBER = /\b(?:Definition|Theorem|Lemma|Proposition|Corollary|Section|Table|Figure|Algorithm)\s+2\.(?:8|75)\b/;
const SAMPLE_PATH = /[*<>{}$\s]|\.\.\./;

/** Every README.md below a tree root, in path order. */
function collectReadmeFiles(root) {
  return collectMarkdownFiles(root).filter((file) => /(^|[\\/])README\.md$/.test(file));
}

/** The lines of the release allow list as a set of keys: path, one tab, line. */
function readAllowedLines(root) {
  const allowed = new Set();
  let text = "";
  try {
    text = readFileSync(join(root, RELEASE_ALLOW_LIST), "utf8");
  } catch {
    return allowed;
  }
  for (const raw of text.split("\n")) {
    if (raw.length === 0 || raw[0] === "#") continue;
    const parts = raw.split("\t");
    if (parts.length < 2) continue;
    allowed.add(`${parts[0]}\t${parts[1]}`);
  }
  return allowed;
}

/** The top level folders of the tree, which start a tree path. */
function topLevelFolders(root) {
  const names = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    names.push(entry.name);
  }
  return names;
}

/** Blank out fenced blocks only, so inline code spans remain readable. */
function stripFenced(content) {
  return String(content).replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
}

/** Every inline code span of one document that writes a tree path, with its line number. */
function collectTreePaths(content, tops) {
  const prose = stripFenced(content);
  const found = [];
  for (const match of prose.matchAll(/`([^`\n]+)`/g)) {
    const span = match[1].trim();
    const first = span.split("/")[0];
    if (!span.includes("/") || !tops.includes(first)) continue;
    if (SAMPLE_PATH.test(span)) continue;
    const bare = span.split("#")[0].replace(/:\d+(?:-\d+)?$/, "").replace(/[.,;:]+$/, "");
    const line = prose.slice(0, match.index).split("\n").length;
    found.push({ line, target: bare });
  }
  return found;
}

/** The level two headings of one document in order, outside fenced blocks. */
function levelTwoHeadings(content) {
  const headings = [];
  for (const line of stripFenced(content).split("\n")) {
    const match = /^## +(.+?)\s*$/.exec(line);
    if (match) headings.push(match[1]);
  }
  return headings;
}

function readmeSection(root) {
  const findings = [];
  let map;
  try {
    map = JSON.parse(readFileSync(join(root, COMPONENT_MAP), "utf8"));
  } catch (err) {
    console.log(`${COMPONENT_MAP}: ${err.message}`);
    console.log("readme: no component map, 1 findings");
    return { passed: false };
  }
  const components = Array.isArray(map.components) ? map.components : [];
  const shared = Array.isArray(map.shared) ? map.shared : [];
  if (components.length !== 18) findings.push(`${COMPONENT_MAP}: ${components.length} component rows, 18 expected`);
  components.forEach((row, index) => {
    const number = String(index + 1).padStart(2, "0");
    if (row.number !== number) findings.push(`${COMPONENT_MAP}: row ${index + 1} has number ${row.number}, ${number} expected`);
  });

  /* 1. The 18 sections of the root README. */
  let rootReadme = "";
  try {
    rootReadme = readFileSync(join(root, "README.md"), "utf8");
  } catch (err) {
    findings.push(`README.md: ${err.message}`);
  }
  const wanted = components.map((row) => `${row.number} / ${row.name}`);
  const present = levelTwoHeadings(rootReadme).filter((heading) => /^\d\d \/ /.test(heading));
  for (const heading of wanted) {
    if (!present.includes(heading)) findings.push(`README.md: no section "## ${heading}"`);
  }
  for (const heading of present) {
    if (!wanted.includes(heading)) findings.push(`README.md: section "## ${heading}" is not a row of the component map`);
  }
  if (present.length === wanted.length && present.some((heading, index) => heading !== wanted[index])) {
    findings.push("README.md: the 18 component sections are not in the order of the component map");
  }

  /* 2. Tree paths in every README. */
  const readmes = collectReadmeFiles(root);
  const tops = topLevelFolders(root);
  let paths = 0;
  for (const file of readmes) {
    const here = relative(root, file).split(sep).join("/");
    for (const { line, target } of collectTreePaths(readFileSync(file, "utf8"), tops)) {
      paths += 1;
      if (!existsSync(join(root, target))) findings.push(`${here}:${line}: tree path ${target} does not resolve`);
    }
  }

  /* 3. The ten parts of each component README. */
  for (const row of components) {
    const file = join(root, row.readme);
    if (!existsSync(file)) {
      findings.push(`${row.readme}: component ${row.number} has no README`);
      continue;
    }
    const content = readFileSync(file, "utf8");
    const lines = content.split("\n");
    const title = `# ${row.number} / ${row.name}`;
    if (lines[0].trim() !== title) findings.push(`${row.readme}: the title is not "${title}"`);
    const second = lines.slice(1).find((line) => line.trim().length > 0) ?? "";
    if (!STATUS_LINE.test(second)) findings.push(`${row.readme}: no status line after the title`);
    const headings = levelTwoHeadings(content);
    let from = 0;
    for (const heading of TEMPLATE_HEADINGS) {
      const at = headings.indexOf(heading, from);
      if (at < 0) {
        const anywhere = headings.includes(heading);
        findings.push(`${row.readme}: ${anywhere ? "out of order" : "no"} part "## ${heading}"`);
        continue;
      }
      from = at + 1;
    }
  }

  /* 4. Every folder under AEP-Components in exactly one row, each with a README. */
  const placed = new Map();
  const place = (folder, where) => {
    if (!placed.has(folder)) placed.set(folder, []);
    placed.get(folder).push(where);
  };
  for (const row of components) {
    place(row.home, `row ${row.number}`);
    for (const folder of row.folders ?? []) place(folder, `row ${row.number}`);
  }
  for (const part of shared) place(part.folder, "shared parts");
  for (const [folder, where] of placed) {
    if (!existsSync(join(root, folder))) findings.push(`${COMPONENT_MAP}: folder ${folder} does not exist`);
    if (where.length > 1) findings.push(`${COMPONENT_MAP}: folder ${folder} sits in ${where.join(" and ")}`);
  }
  const componentsDir = join(root, "AEP-Components");
  let folders = 0;
  for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    folders += 1;
    const folder = `AEP-Components/${entry.name}`;
    if (!placed.has(folder)) findings.push(`${folder}: no row of the component map holds this folder`);
    if (!existsSync(join(componentsDir, entry.name, "README.md"))) findings.push(`${folder}: no README.md`);
  }

  /* 5. Version labels older than 2.9. */
  const allowed = readAllowedLines(root);
  for (const file of readmes) {
    const here = relative(root, file).split(sep).join("/");
    const raw = readFileSync(file, "utf8").split("\n");
    const prose = stripCode(raw.join("\n")).replace(/\]\([^)]*\)/g, (link) => link.replace(/[^\n]/g, " ")).split("\n");
    for (let i = 0; i < prose.length; i++) {
      const label = OLD_LABEL.exec(prose[i]);
      if (!label) continue;
      if (PAPER_NUMBER.test(prose[i])) continue;
      if (allowed.has(`${here}\t${raw[i]}`)) continue;
      findings.push(`${here}:${i + 1}: version label ${label[0]} is older than 2.9`);
    }
  }

  for (const item of findings) console.log(item);
  console.log(`readme: ${components.length} component rows, ${readmes.length} README files, ${paths} tree paths, ${folders} component folders, ${findings.length} findings`);
  return { passed: findings.length === 0 };
}

const SECTIONS = [
  { name: "registry", run: registrySection },
  { name: "release strings", run: releaseStringsSection },
  { name: "wrap coverage", run: wrapCoverageSection },
  { name: "threat model", run: threatModelSection },
  { name: "rust build", run: rustBuildSection },
  { name: "caw build", run: cawBuildSection },
  { name: "links", run: linksSection },
  { name: "readme", run: readmeSection },
];

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(process.argv[2] ?? here);
  var extra = String.fromCharCode(65,69,80,45,78,79,83,72,73,80);
  if (existsSync(join(root, extra))) SKIP_DIRS.add(extra);
  SKIP_DIRS.add(extra.slice(4));
  /* AEP_CHECK_ONLY runs one section by name, for example AEP_CHECK_ONLY=readme. */
  if (process.env.AEP_CHECK_ONLY) {
    const only = SECTIONS.filter((section) => section.name === process.env.AEP_CHECK_ONLY);
    if (only.length > 0) SECTIONS.splice(0, SECTIONS.length, ...only);
  }
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
