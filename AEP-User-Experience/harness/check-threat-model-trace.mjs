#!/usr/bin/env node
// @ts-check
/*
 * check-threat-model-trace.mjs
 *
 * Proves that THREAT_MODEL.md traces every mitigation to a check that exists.
 *
 * Every threat row of THREAT_MODEL.md is a table row of a layer section whose
 * first cell is an id such as BN-1 and whose last cell names its checks in
 * backticks. A check is a conformance id (CC-NN) that the conformance
 * manifest lists as a check and not as a planned one. A check can also be a
 * test written as path::name. The path must be a file of the tree. The name is
 * a Rust fn that a test attribute marks and no ignore attribute skips, or a Go
 * func whose name starts with Test. It can also be a quoted title that an it
 * or test call of the file opens with, where the call is not skipped.
 *
 * The check also asks for the five layers of the model (Base Node, docks, UCB,
 * CAW and lattice channels) each with assets, trust boundaries, attacker
 * capabilities and residual risk. README.md must link
 * the model.
 *
 * Run:  node AEP-User-Experience/harness/check-threat-model-trace.mjs [tree root]
 * Exit: 0 when every row traces, 1 otherwise.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODEL = 'THREAT_MODEL.md';
export const MANIFEST = 'AEP-Components/conformance/tests/manifest.json';
export const LINKED_FROM = ['README.md'];
export const LAYERS = ['Base Node', 'Docks', 'UCB', 'CAW', 'Lattice channels'];
export const LAYER_PARTS = ['**Assets.**', '**Trust boundaries.**', '**Attacker capabilities.**', '**Residual risk.**'];

const ROW = /^\|\s*([A-Z]{2}-\d+)\s*\|(.*)\|\s*$/;
const TICKED = /`([^`]+)`/g;

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The ids the conformance manifest lists as checks.
 * @param {string} root
 * @returns {Set<string>}
 */
export function listedChecks(root) {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
  const checks = manifest !== null && typeof manifest === 'object' && Array.isArray(/** @type {{ checks?: unknown }} */ (manifest).checks)
    ? /** @type {unknown[]} */ (/** @type {{ checks: unknown[] }} */ (manifest).checks)
    : [];
  /** @type {Set<string>} */
  const ids = new Set();
  for (const c of checks) {
    const id = c !== null && typeof c === 'object' ? /** @type {{ id?: unknown }} */ (c).id : undefined;
    if (typeof id === 'string') ids.add(id);
  }
  return ids;
}

/**
 * Split the model into layer sections keyed by their heading text.
 * @param {string} text
 * @returns {Map<string, string[]>}
 */
export function layerSections(text) {
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  /** @type {string[] | null} */
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^## Layer \d+: (.+)$/);
    if (heading) {
      current = [];
      sections.set((heading[1] ?? '').trim(), current);
    } else if (/^## /.test(line)) {
      current = null;
    } else if (current !== null) {
      current.push(line);
    }
  }
  return sections;
}

/**
 * The lines of a source file with every line comment line blanked, so a
 * declaration or a call that sits in a // comment never counts.
 * @param {string} src
 */
export function codeLines(src) {
  return src.split('\n').map((line) => (/^\s*\/\//.test(line) ? '' : line));
}

/**
 * Whether a Rust fn of the given name carries a test attribute and no ignore
 * attribute in the attribute lines just above it.
 * @param {string[]} lines
 * @param {string} name
 */
function rustTest(lines, name) {
  const decl = new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${escapeRegExp(name)}\\s*[(<]`);
  for (let i = 0; i < lines.length; i++) {
    if (!decl.test(lines[i] ?? '')) continue;
    let test = false;
    let ignored = false;
    for (let j = i - 1; j >= 0; j--) {
      const attr = (lines[j] ?? '').trim();
      if (attr === '') continue;
      if (!attr.startsWith('#[')) break;
      if (/^#\[(?:[\w:]+::)?test\b/.test(attr)) test = true;
      if (/^#\[ignore\b/.test(attr)) ignored = true;
    }
    if (test && !ignored) return true;
  }
  return false;
}

/**
 * Whether one path::name reference names a test that its file declares.
 * @param {string} root
 * @param {string} ref
 * @returns {{ ok: boolean, why: string }}
 */
export function testExists(root, ref) {
  const at = ref.indexOf('::');
  if (at <= 0) return { ok: false, why: 'is neither a conformance id nor path::name' };
  const rel = ref.slice(0, at);
  const name = ref.slice(at + 2);
  const file = resolve(root, rel);
  const inside = relative(resolve(root), file);
  if (isAbsolute(rel) || inside.startsWith('..') || isAbsolute(inside)) {
    return { ok: false, why: `names ${rel}, which is outside the tree` };
  }
  if (!existsSync(file)) return { ok: false, why: `names a missing file ${rel}` };
  const lines = codeLines(readFileSync(file, 'utf8'));

  if (name.length > 2 && name.startsWith('"') && name.endsWith('"')) {
    const title = escapeRegExp(name.slice(1, -1));
    // A skipped or todo call such as it.skip does not match, since only it or
    // test followed by an optional concurrent or sequential may open the call.
    const call = new RegExp(`(?:^|[^.\\w])(?:it|test)(?:\\.(?:concurrent|sequential))?\\s*\\(\\s*(?:"${title}"|'${title}'|\`${title}\`)`);
    if (lines.some((line) => call.test(line))) return { ok: true, why: '' };
    return { ok: false, why: `names a test title that no running it or test call of ${rel} holds` };
  }

  if (rel.endsWith('.go')) {
    if (!/^Test[A-Z0-9_]/.test(name)) return { ok: false, why: `names ${name}, which is not a Go test name` };
    const decl = new RegExp(`^func\\s+${escapeRegExp(name)}\\s*\\(\\s*\\w+\\s+\\*testing\\.T\\s*\\)`);
    if (lines.some((line) => decl.test(line))) return { ok: true, why: '' };
    return { ok: false, why: `names ${name}, which ${rel} does not declare as a test` };
  }

  if (rustTest(lines, name)) return { ok: true, why: '' };
  return { ok: false, why: `names ${name}, which ${rel} does not declare as a running test` };
}

/**
 * Check the model under a tree root. Returns the rows, the cited checks and the findings.
 * @param {string} root
 * @returns {{ rows: number, checks: number, findings: string[] }}
 */
export function checkThreatModel(root) {
  /** @type {string[]} */
  const findings = [];
  const modelPath = join(root, MODEL);
  if (!existsSync(modelPath)) return { rows: 0, checks: 0, findings: [`${MODEL} is missing`] };
  const text = readFileSync(modelPath, 'utf8');
  const listed = listedChecks(root);

  const sections = layerSections(text);
  for (const layer of LAYERS) {
    const key = [...sections.keys()].find((k) => k === layer || k.startsWith(`${layer} `));
    const body = key === undefined ? undefined : sections.get(key);
    if (!body) {
      findings.push(`${MODEL} has no section for the layer ${layer}`);
      continue;
    }
    const joined = body.join('\n');
    for (const part of LAYER_PARTS) {
      if (!joined.includes(part)) findings.push(`${MODEL} layer ${layer} names no ${part.replace(/\*/g, '')}`);
    }
  }

  let rows = 0;
  let checks = 0;
  /** @type {Set<string>} */
  const seen = new Set();
  const threatLines = [...sections.values()].flat();
  for (const line of threatLines) {
    const m = line.match(ROW);
    if (!m) continue;
    const id = m[1] ?? '';
    if (seen.has(id)) findings.push(`${MODEL} row ${id} appears twice`);
    seen.add(id);
    rows += 1;
    const cells = (m[2] ?? '').split('|');
    const last = cells[cells.length - 1] ?? '';
    const refs = [...last.matchAll(TICKED)].map((x) => (x[1] ?? '').trim());
    if (refs.length === 0) {
      findings.push(`${MODEL} row ${id} names no check`);
      continue;
    }
    for (const ref of refs) {
      checks += 1;
      if (/^CC-\d{2}$/.test(ref)) {
        if (!listed.has(ref)) findings.push(`${MODEL} row ${id} cites ${ref}, which ${MANIFEST} does not list as a check`);
        continue;
      }
      const found = testExists(root, ref);
      if (!found.ok) findings.push(`${MODEL} row ${id} cites ${ref}, which ${found.why}`);
    }
  }
  if (rows === 0) findings.push(`${MODEL} holds no threat row`);

  for (const rel of LINKED_FROM) {
    const p = join(root, rel);
    if (!existsSync(p) || !readFileSync(p, 'utf8').includes(MODEL)) findings.push(`${rel} does not link ${MODEL}`);
  }
  return { rows, checks, findings };
}

function isEntryScript() {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryScript()) {
  const root = resolve(process.argv[2] ? process.argv[2] : process.cwd());
  const result = checkThreatModel(root);
  for (const f of result.findings) console.log(f);
  console.log(`threat model: ${result.rows} rows, ${result.checks} cited checks, ${result.findings.length} findings`);
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}
