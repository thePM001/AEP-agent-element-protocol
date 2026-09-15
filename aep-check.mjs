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

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "build"]);
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

const SECTIONS = [
  { name: "links", run: linksSection },
];

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(process.argv[2] ?? here);
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
