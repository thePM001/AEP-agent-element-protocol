// @PAD: aep-admit-js-v1
// @GCDE: gaplune-decode hmac-sha256:cf615d8461e660d9232bafbcaf9738eb8182be543ef75c52ed30ded45d595edc
// Canonical JS Admit. Live crossing: Admit collect-all walls then Apply.
// Writing.gap compiles into Admit walls on the same collect-all pass.
// Sequential LatticeFilter and PolicyEvaluator are lab-only.
// Lattice policy at runtime is OPA AEP-Components/dynAEP/policies/lattice-policy.rego
// (package dynaep.lattice, deny_lattice collect-all). Admit does not carry a restricted
// Rego subset. HyperlatticeFilter.filterCrossing remains Admit collect-all walls then Apply.

import { readFileSync } from "node:fs";
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

function hasChar(text, ch) {
  return String(text ?? "").includes(ch);
}

function oxfordAndPattern() {
  return "," + " " + "and ";
}

function oxfordOrPattern() {
  return "," + " " + "or ";
}

function hasOxfordComma(text) {
  const t = String(text ?? "");
  return t.includes(oxfordAndPattern()) || t.includes(oxfordOrPattern());
}

function hasDoubleHyphenProse(text) {
  return String(text ?? "").includes(" " + "-" + "-" + " ");
}

function hasPunctWordSpaceFail(text) {
  const t = String(text ?? "");
  for (let i = 0; i < t.length - 1; i++) {
    const ch = t[i];
    const next = t[i + 1];
    if ((ch === "?" || ch === "!") && /[A-Za-z0-9]/.test(next)) return true;
  }
  return false;
}

function writingWall(rule, closed, reason) {
  const id = writingWallId(rule);
  return closed ? admitWallClose(id, reason) : admitWallOpen(id);
}

export function compileWritingWalls(text) {
  const t = String(text ?? "");
  const walls = [];
  walls.push(
    writingWall(
      WRITING_RULE_NO_EM_DASHES,
      hasChar(t, "\u2014"),
      "Em dash U+2014 forbidden by writing.gap",
    ),
  );
  walls.push(
    writingWall(
      WRITING_RULE_NO_EN_DASHES,
      hasChar(t, "\u2013"),
      "En dash U+2013 forbidden by writing.gap",
    ),
  );
  const subst = hasChar(t, "\u2015") || hasChar(t, "\u2e3a") || hasChar(t, "\u2e3b");
  walls.push(
    writingWall(
      WRITING_RULE_NO_DASH_SUBSTITUTES,
      subst,
      "Dash substitute U+2015 U+2E3A U+2E3B forbidden by writing.gap",
    ),
  );
  const boxd = hasChar(t, "\u2500") || hasChar(t, "\u2501");
  walls.push(
    writingWall(
      WRITING_RULE_NO_BOX_DRAWING_DASHES,
      boxd,
      "Box drawing dash U+2500 U+2501 forbidden by writing.gap",
    ),
  );
  walls.push(
    writingWall(
      WRITING_RULE_NO_MINUS_AS_DASH,
      hasChar(t, "\u2212"),
      "Minus sign U+2212 used as dash forbidden by writing.gap",
    ),
  );
  walls.push(
    writingWall(
      WRITING_RULE_NO_DOUBLE_HYPHEN,
      hasDoubleHyphenProse(t),
      "Double hyphen prose separator forbidden by writing.gap",
    ),
  );
  walls.push(
    writingWall(
      WRITING_RULE_NO_OXFORD_COMMA,
      hasOxfordComma(t),
      "Oxford comma forbidden by writing.gap",
    ),
  );
  walls.push(
    writingWall(
      WRITING_RULE_PUNCTUATION_WORD_SPACE,
      hasPunctWordSpaceFail(t),
      "Space after ? or ! before the next word required by writing.gap",
    ),
  );
  return walls;
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
