// Canonical JS Admit. Live crossing: Admit collect-all walls then Apply.
// Writing.gap compiles into Admit walls on the same collect-all pass.
// Sequential LatticeFilter and PolicyEvaluator are lab-only.
// Lattice policy at runtime is OPA AEP-Components/dynAEP/policies/lattice-policy.rego
// (package dynaep.lattice, deny_lattice collect-all). Admit does not carry a restricted
// Rego subset. HyperlatticeFilter.filterCrossing remains Admit collect-all walls then Apply.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

export function labLatticeFilterEnabled() {
  const v = String(process.env.AEP_LAB_LATTICE_FILTER ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function labPolicyEvaluatorEnabled() {
  const v = String(process.env.AEP_LAB_POLICY_EVALUATOR ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export function admitWallOpen(id) {
  return { id: String(id), closed: false, reason: "" };
}

export function admitWallClose(id, reason) {
  return { id: String(id), closed: true, reason: String(reason ?? "") };
}

export function admitCollectAll(walls) {
  const closed = (walls ?? [])
    .filter((w) => w && w.closed)
    .map((w) => ({ id: String(w.id), closed: true, reason: String(w.reason ?? "") }));
  closed.sort((a, b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason));
  const deduped = [];
  for (const wall of closed) {
    const prev = deduped.length === 0 ? null : deduped[deduped.length - 1];
    if (prev === null || prev.id !== wall.id || prev.reason !== wall.reason) {
      deduped.push(wall);
    }
  }
  return { allow: deduped.length === 0, closed: deduped };
}

export function closedSetKey(result) {
  return (result?.closed ?? [])
    .map((w) => `${w.id}\u001f${w.reason}`)
    .slice()
    .sort()
    .join("\n");
}

export const WRITING_RULE_NO_EM_DASHES = "no_em_dashes";
export const WRITING_RULE_NO_EN_DASHES = "no_en_dashes";
export const WRITING_RULE_NO_DASH_SUBSTITUTES = "no_dash_substitutes";
export const WRITING_RULE_NO_BOX_DRAWING_DASHES = "no_box_drawing_dashes";
export const WRITING_RULE_NO_MINUS_AS_DASH = "no_minus_as_dash";
export const WRITING_RULE_NO_DOUBLE_HYPHEN = "no_double_hyphen";
export const WRITING_RULE_NO_OXFORD_COMMA = "no_oxford_comma";
export const WRITING_RULE_PUNCTUATION_WORD_SPACE = "punctuation_word_space";

export function writingWallId(rule) {
  return `writing:${rule}`;
}

/** The writing rule source ships in the tree. The rule set of this library is read
 * from that one source, so this file declares no rule family of its own. */
export function writingRuleTable() {
  let source = "";
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(process.cwd(), "AEP-Policy-System/reference/writing.gap"),
    join(here, "../../../AEP-Policy-System/reference/writing.gap"),
  ]) {
    try {
      source = readFileSync(candidate, "utf8");
      break;
    } catch (e) {
      continue;
    }
  }
  const ids = [];
  const m = source.match(/"constraints"\s*:\s*\[([\s\S]*?)\]/);
  if (m) {
    for (const part of m[1].split(",")) {
      const id = part.trim().replace(/^"|"$/g, "");
      if (id) ids.push(id);
    }
  }
  return ids.filter((id) => id.startsWith("no_") || id.startsWith("punctuation") || id.startsWith("space_before") || id.startsWith("attach_"));
}

const WRITING_RULES = [
  WRITING_RULE_NO_EM_DASHES,
  WRITING_RULE_NO_EN_DASHES,
  WRITING_RULE_NO_DASH_SUBSTITUTES,
  WRITING_RULE_NO_BOX_DRAWING_DASHES,
  WRITING_RULE_NO_MINUS_AS_DASH,
  WRITING_RULE_NO_DOUBLE_HYPHEN,
  WRITING_RULE_NO_OXFORD_COMMA,
  WRITING_RULE_PUNCTUATION_WORD_SPACE,
];

/** Ask the Base Node kernel for the one compiled writing wall set. */
function kernelClosedRules(text) {
  const bin = process.env.AEP_LATTICE_LOG_BIN || "aep-lattice-log";
  const out = execFileSync(bin, ["validate-writing"], {
    input: JSON.stringify({ text: String(text ?? "") }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(out);
  return new Set((parsed.violations ?? []).map((v) => String(v.rule)));
}

function writingWall(rule, closed, reason) {
  const id = writingWallId(rule);
  return closed ? admitWallClose(id, reason) : admitWallOpen(id);
}

export function compileWritingWalls(text) {
  let closed;
  try {
    closed = kernelClosedRules(text);
  } catch (e) {
    return WRITING_RULES.map((rule) =>
      writingWall(rule, true, "writing rules need the Base Node kernel: " + (e && e.message ? e.message : String(e))),
    );
  }
  return WRITING_RULES.map((rule) =>
    writingWall(rule, closed.has(rule), `writing.gap rule ${rule} decided by the Base Node kernel`),
  );
}

export function writingViolationsFromWalls(walls) {
  const out = [];
  for (const wall of walls ?? []) {
    if (!wall.closed) continue;
    if (!String(wall.id).startsWith("writing:")) continue;
    out.push({ rule: String(wall.id).slice("writing:".length), message: wall.reason });
  }
  return out;
}

function parseBool(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "closed";
}

export function parseWallLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("#") || trimmed.startsWith("@")) return [];
  if (trimmed.startsWith("writing_text=")) {
    return compileWritingWalls(trimmed.slice("writing_text=".length));
  }
  let id = "";
  let closed = false;
  let reason = "";
  for (const part of trimmed.split("\t")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === "id") id = v;
    else if (k === "closed") closed = parseBool(v);
    else if (k === "reason") reason = v;
  }
  if (!id) return [];
  return [closed ? admitWallClose(id, reason) : admitWallOpen(id)];
}

export function formatAdmitResult(result) {
  let out = `allow=${result.allow ? "true" : "false"}\n`;
  for (const wall of result.closed) {
    out += `closed=${wall.id}|${wall.reason}\n`;
  }
  return out;
}

function runningAsCli() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(process.argv[1]).href === import.meta.url;
  } catch {
    return false;
  }
}

if (runningAsCli()) {
  const buf = readFileSync(0, "utf8");
  const walls = buf.split(/\r?\n/).flatMap(parseWallLine);
  process.stdout.write(formatAdmitResult(admitCollectAll(walls)));
}
