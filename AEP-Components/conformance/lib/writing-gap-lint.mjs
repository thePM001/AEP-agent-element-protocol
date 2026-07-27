/**
 * writing.gap documentation linter for AEP 2.8 conformance (CC-16).
 * Enforces reference policy AEP-Policy-System/reference/writing.gap.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dist", "build"]);

/** @typedef {{ file: string, line: number, rule: string, message: string, snippet: string }} Violation */

// Prose dash circumventions from writing.gap (box-drawing tree glyphs are allowed).
const FORBIDDEN_DASH_CHARS = [
  { char: "\u2014", code: "U+2014", name: "em dash", rule: "no_em_dashes" },
  { char: "\u2013", code: "U+2013", name: "en dash", rule: "no_en_dashes" },
  { char: "\u2015", code: "U+2015", name: "horizontal bar", rule: "no_dash_substitutes" },
  { char: "\u2e3a", code: "U+2E3A", name: "two-em dash", rule: "no_dash_substitutes" },
  { char: "\u2e3b", code: "U+2E3B", name: "three-em dash", rule: "no_dash_substitutes" },
  { char: "\u2212", code: "U+2212", name: "minus sign used as dash", rule: "no_minus_as_dash" },
];

const DEFAULT_GLOBS = [
  { ext: ".md", kind: "markdown" },
  { ext: ".json", kind: "json", under: "registry" },
];

/** Prompt block for agents that must follow writing.gap prose rules. */
export const WRITING_GAP_AGENT_RULES = `Writing conventions (writing.gap - mandatory for all human-readable text):
- Never use em-dashes, en-dashes or Unicode dash substitutes; use a plain hyphen (-) or rewrite the sentence.
- Never use double-hyphen ( -- ) as a sentence separator in prose; use hyphen (-) or rewrite.
- Never use Oxford commas: write "foo, bar and baz" not "foo, bar, and baz". Same rule for "or".
- Apply these rules to summaries, explanations, labels, warnings and string fields in JSON output.`;

/**
 * @param {string} root
 * @param {{ extensions?: Array<{ ext: string, kind: string, under?: string }> }} [options]
 */
export function collectWritingGapFiles(root, options = {}) {
  const specs = options.extensions ?? DEFAULT_GLOBS;
  const files = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, full).replace(/\\/g, "/");
      for (const spec of specs) {
        if (!entry.name.endsWith(spec.ext)) continue;
        if (spec.under && !rel.startsWith(`${spec.under}/`)) continue;
        files.push({ path: full, rel, kind: spec.kind });
        break;
      }
    }
  }

  walk(root);
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}

/** @param {string} content */
export function stripMarkdownCode(content) {
  return content.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]+`/g, "");
}

/** @param {string} line */
function isAllowedDoubleHyphenLine(line) {
  if (line.includes("-->")) return true;
  if (/^\s*---+\s*$/.test(line)) return true;
  if (/\d--\d/.test(line)) return true;
  if (/\bgit\b/.test(line) && /\bcheckout\b/.test(line) && line.includes(" -- ")) return true;
  if (/\bcargo\b/.test(line) && line.includes(" -- ")) return true;
  if (/\bnpm\b/.test(line) && line.includes(" -- ")) return true;
  if (/\bnode\b/.test(line) && line.includes(" -- ")) return true;
  return false;
}

/** @param {string} line */
function isTreeDiagramLine(line) {
  return /[├└│┌┐┘┬┴┤┼]/.test(line) || /^\s*[|`]/.test(line);
}

/** @param {string} line */
export function fixWritingGapProseLine(line) {
  if (isAllowedDoubleHyphenLine(line) || isTreeDiagramLine(line)) return line;
  let out = line;
  for (const dash of FORBIDDEN_DASH_CHARS) {
    const replacement = dash.char === "\u2013" || dash.char === "\u2212" ? "-" : " - ";
    out = out.split(dash.char).join(replacement);
  }
  out = out.replace(/, and /g, " and ");
  out = out.replace(/, or /g, " or ");
  if (!isAllowedDoubleHyphenLine(out) && out.includes(" -- ")) {
    out = out.replace(/ -- /g, " - ");
  }
  return out;
}

/** @param {string} text */
export function fixWritingGapProse(text) {
  return String(text ?? "")
    .split("\n")
    .map(fixWritingGapProseLine)
    .join("\n");
}

/**
 * Auto-correct writing.gap violations in agent output while preserving fenced code blocks.
 * @param {string} text
 */
export function enforceWritingGapText(text) {
  if (!text) return text;
  const parts = String(text).split(/(```[\s\S]*?```)/g);
  return parts.map((part) => (part.startsWith("```") ? part : fixWritingGapProse(part))).join("");
}

/**
 * Sanitize string fields on CCA ImplementationPlan objects.
 * @param {object} plan
 */
export function enforceWritingGapPlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const next = { ...plan };
  if (typeof next.user_intent === "string") {
    next.user_intent = fixWritingGapProse(next.user_intent);
  }
  if (Array.isArray(next.warnings)) {
    next.warnings = next.warnings.map((w) => (typeof w === "string" ? fixWritingGapProse(w) : w));
  }
  if (Array.isArray(next.components)) {
    next.components = next.components.map((c) => ({
      ...c,
      reason: typeof c.reason === "string" ? fixWritingGapProse(c.reason) : c.reason,
    }));
  }
  if (next.topology && Array.isArray(next.topology.nodes)) {
    next.topology = {
      ...next.topology,
      nodes: next.topology.nodes.map((n) => ({
        ...n,
        label: typeof n.label === "string" ? fixWritingGapProse(n.label) : n.label,
      })),
    };
  }
  return next;
}

export function lintWritingGapContent(content, rel, kind = "markdown") {
  /** @type {Violation[]} */
  const violations = [];
  const prose = kind === "markdown" ? stripMarkdownCode(content) : content;
  const proseLines = prose.split("\n");

  for (let i = 0; i < proseLines.length; i++) {
    const line = proseLines[i];
    if (isTreeDiagramLine(line)) continue;
    for (const dash of FORBIDDEN_DASH_CHARS) {
      let idx = 0;
      while ((idx = line.indexOf(dash.char, idx)) !== -1) {
        violations.push({
          file: rel,
          line: i + 1,
          rule: dash.rule,
          message: `${dash.name} (${dash.code}) forbidden by writing.gap`,
          snippet: line.trim().slice(Math.max(0, idx - 24), idx + 24),
        });
        idx += 1;
      }
    }
  }

  for (let i = 0; i < proseLines.length; i++) {
    const line = proseLines[i];
    if (line.includes(", and ")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "no_oxford_comma",
        message: "Oxford comma before \"and\" forbidden by writing.gap",
        snippet: line.trim().slice(0, 80),
      });
    }
    if (line.includes(", or ")) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "no_oxford_comma",
        message: "Oxford comma before \"or\" forbidden by writing.gap",
        snippet: line.trim().slice(0, 80),
      });
    }
    if (line.includes(" -- ") && !isAllowedDoubleHyphenLine(line)) {
      violations.push({
        file: rel,
        line: i + 1,
        rule: "no_double_hyphen",
        message: "Double-hyphen word separator forbidden by writing.gap",
        snippet: line.trim().slice(0, 80),
      });
    }
  }

  return violations;
}

/**
 * @param {string} root
 * @param {{ extensions?: Array<{ ext: string, kind: string, under?: string }> }} [options]
 * @returns {{ violations: Violation[], scanned: number }}
 */
export function lintWritingGapTree(root, options = {}) {
  const files = collectWritingGapFiles(root, options);
  /** @type {Violation[]} */
  const violations = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(file.path, "utf8");
    } catch (err) {
      violations.push({
        file: file.rel,
        line: 0,
        rule: "read_error",
        message: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        snippet: "",
      });
      continue;
    }
    violations.push(...lintWritingGapContent(content, file.rel, file.kind));
  }
  return { violations, scanned: files.length };
}

/**
 * @param {Violation[]} violations
 */
export function formatWritingGapReport(violations) {
  if (violations.length === 0) {
    return "PASS writing.gap: no documentation style violations.";
  }
  const lines = [`FAIL writing.gap: ${violations.length} violation(s):`];
  for (const v of violations.slice(0, 50)) {
    lines.push(`  ${v.file}:${v.line} [${v.rule}] ${v.message}`);
    if (v.snippet) lines.push(`    ${v.snippet}`);
  }
  if (violations.length > 50) {
    lines.push(`  ... and ${violations.length - 50} more`);
  }
  return lines.join("\n");
}