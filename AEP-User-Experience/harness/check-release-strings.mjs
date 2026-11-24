#!/usr/bin/env node
// @ts-check
/*
 * check-release-strings.mjs
 *
 * One product release string for the AEP tree. Policy VERSION-286-P0.
 *
 * The tree carries exactly one release string. Two classes of line are exempt
 * and every exempt line is named in the allow list beside this file. The first
 * exempt class is an historical line, for example a changelog heading or a
 * sentence that compares this release with an older one. The second exempt
 * class is a third party dependency pin, because a package number has nothing
 * to do with this release.
 *
 * Reads: AEP-User-Experience/harness/release-allow.list
 * Run:   node AEP-User-Experience/harness/check-release-strings.mjs [tree root] [skip path]
 *        A skip path is a folder that does not ship, for example a local build
 *        output folder. The check skips it and it also skips every path that the
 *        tree attributes file marks export-ignore.
 * Exit:  0 when every stale string is allow listed, 1 otherwise.
 *
 * The internal export area is skipped, because that area does not ship and it
 * keeps the identifiers that belong to its own record.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELEASE = '2.9.0';
export const STALE = ['2.8.6', '2.8.x', '2.8.5', '2.8.0', '2.75', 'AEP 2.8 ', 'AEP 2.8.', 'AEP v2.8', 'AEP-2.8'];

/** Separates the path from the line in an allow list key. */
const SEP = String.fromCharCode(0);

const BASE_SKIP_DIRS = ['.git', 'node_modules', 'target', 'dist', 'build', '.next'];

/* The allow list and this tool carry the stale strings as their own data, so the
 * check does not read them. */
const SKIP_FILES = new Set([
  'AEP-User-Experience/harness/release-allow.list',
  'AEP-User-Experience/harness/release-pending.list',
  'AEP-User-Experience/harness/check-release-strings.mjs',
]);

const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.eot',
  '.ots', '.zip', '.gz', '.tgz', '.wasm', '.so', '.dylib', '.dll', '.bin', '.db', '.lmlog', '.lmsnap',
  '.lock',
]);

/**
 * @param {string} path
 * @returns {string | null}
 */
function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * A path that the tree attributes file marks export-ignore does not ship, so
 * the check does not read it. The attributes file is the single statement of
 * that set.
 * @param {string} root
 * @returns {Set<string>}
 */
export function readExportIgnore(root) {
  /** @type {Set<string>} */
  const skip = new Set();
  const text = readText(join(root, '.gitattributes'));
  if (text === null) return skip;
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (row.length === 0 || row.startsWith('#')) continue;
    const parts = row.split(/\s+/);
    const first = parts[0];
    if (parts.length < 2 || first === undefined || !parts.includes('export-ignore')) continue;
    skip.add(first.replace(/\/$/, ''));
  }
  return skip;
}

/**
 * Parse the allow list: each row is a path, a tab, the exact line and an
 * optional tab with a reason.
 * @param {string} text
 */
export function parseAllow(text) {
  /** @type {Set<string>} */
  const allow = new Set();
  let count = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0 || line.startsWith('#')) continue;
    const first = line.indexOf('\t');
    if (first < 0) continue;
    const rest = line.slice(first + 1);
    const second = rest.indexOf('\t');
    const body = second < 0 ? rest : rest.slice(0, second);
    allow.add(line.slice(0, first) + SEP + body);
    count += 1;
  }
  return { allow, count };
}

/**
 * AEP29-VER-010: files that still carry the old release string because a node
 * scan refuses a new landing of the file. Each row names the exact number of
 * stale lines. A row whose count is not a whole number is a problem.
 * @param {string} root
 * @param {string[]} problems
 * @returns {Map<string, number>}
 */
export function readPending(root, problems) {
  /** @type {Map<string, number>} */
  const pending = new Map();
  const text = readText(join(root, 'AEP-User-Experience/harness/release-pending.list'));
  if (text === null) return pending;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0 || line.startsWith('#')) continue;
    const cols = line.split('\t');
    const file = cols[0];
    const count = Number(cols[1]);
    if (file === undefined || cols.length < 2) continue;
    if (!Number.isInteger(count) || count < 0) {
      problems.push(`release-pending.list row ${file} names no whole count`);
      continue;
    }
    pending.set(file, count);
  }
  return pending;
}

/**
 * The release of package.json and of the workspace package of Cargo.toml.
 * @param {string} root
 * @returns {{ file: string, value: string | null }[]}
 */
export function readReleaseSources(root) {
  /** @type {{ file: string, value: string | null }[]} */
  const found = [];
  const pkgText = readText(join(root, 'package.json'));
  /** @returns {string | null} */
  const packageVersion = () => {
    try {
      /** @type {unknown} */
      const pkg = pkgText === null ? null : JSON.parse(pkgText);
      const v = pkg !== null && typeof pkg === 'object' ? /** @type {{ version?: unknown }} */ (pkg).version : undefined;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  };
  found.push({ file: 'package.json', value: packageVersion() });

  const text = readText(join(root, 'Cargo.toml'));
  /** @type {string | null} */
  let value = null;
  if (text !== null) {
    const at = text.indexOf('[workspace.package]');
    const head = at < 0 ? '' : text.slice(at + '[workspace.package]'.length);
    const end = head.indexOf('\n[');
    const section = end < 0 ? head : head.slice(0, end);
    for (const row of section.split('\n')) {
      const t = row.trim();
      if (t.startsWith('version') && !t.includes('workspace')) {
        const m = t.match(/"([^"]+)"/);
        if (m?.[1] !== undefined) value = m[1];
      }
    }
  }
  found.push({ file: 'Cargo.toml', value });
  return found;
}

/**
 * AEP29-VER-010: the tool does not ask git for the tracked files, so it honors
 * the plain directory entries of each .gitignore as it walks. An entry applies
 * to the folder that holds the .gitignore and to everything below it. Patterns
 * with a wildcard are not read.
 * @param {string} dir
 * @returns {Set<string>}
 */
export function readIgnoredNames(dir) {
  /** @type {Set<string>} */
  const names = new Set();
  const text = readText(join(dir, '.gitignore'));
  if (text === null) return names;
  for (const raw of text.split('\n')) {
    let row = raw.trim();
    if (row.length === 0 || row.startsWith('#') || row.startsWith('!')) continue;
    row = row.replace(/^\//, '').replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/\/$/, '');
    if (row.length === 0 || /[*?[/]/.test(row)) continue;
    names.add(row);
  }
  return names;
}

/**
 * Only the shipped roots describe the product. Files at the tree root always
 * ship. The list lives in shipped-roots.list so every check reads one set.
 * @param {string} root
 * @returns {Set<string> | null}
 */
export function readShippedRoots(root) {
  const text = readText(join(root, 'AEP-User-Experience/harness/shipped-roots.list'));
  if (text === null) return null;
  /** @type {Set<string>} */
  const roots = new Set();
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (row.length === 0 || row.startsWith('#')) continue;
    roots.add(row);
  }
  return roots;
}

/**
 * @param {string} rel
 * @param {Set<string> | null} roots
 */
export function isShipped(rel, roots) {
  if (roots === null) return true;
  const slash = rel.indexOf('/');
  if (slash < 0) return true;
  return roots.has(rel.slice(0, slash));
}

/**
 * CHANGELOG.md keeps the release history, so only sections under the current
 * release heading are checked. Older sections name older releases on purpose.
 * @param {string[]} rows
 * @returns {Set<number>}
 */
export function changelogHistoryLines(rows) {
  /** @type {Set<number>} */
  const history = new Set();
  let inHistory = false;
  rows.forEach((row, i) => {
    const m = /^##\s*\[([^\]]+)\]/.exec(row);
    if (m) inHistory = m[1] !== RELEASE;
    if (inHistory) history.add(i);
  });
  return history;
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {Set<string>} skipDirs
 * @param {string[]} out
 * @param {Set<string>} [inherited]
 */
function walk(root, dir, skipDirs, out, inherited = new Set()) {
  const ignored = new Set([...inherited, ...readIgnoredNames(dir)]);
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name) || ignored.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(root, full, skipDirs, out, ignored);
    } else if (st.isFile()) {
      if (SKIP_EXT.has(extname(name).toLowerCase())) continue;
      if (st.size > 4000000) continue;
      const rel = relative(root, full);
      if (SKIP_FILES.has(rel)) continue;
      out.push(rel);
    }
  }
}

/**
 * Check the tree under root. skipArgs names folders that do not ship.
 * @param {string} root
 * @param {string[]} [skipArgs]
 */
export function checkReleaseStrings(root, skipArgs = []) {
  /** @type {string[]} */
  const problems = [];
  const allowText = readText(join(root, 'AEP-User-Experience/harness/release-allow.list'));
  if (allowText === null) problems.push('AEP-User-Experience/harness/release-allow.list is missing');
  const { allow, count: allowCount } = parseAllow(allowText ?? '');

  for (const src of readReleaseSources(root)) {
    if (src.value !== RELEASE) {
      problems.push(src.file + ' reads ' + String(src.value) + ' against the release string ' + RELEASE);
    }
  }

  const skipDirs = new Set(BASE_SKIP_DIRS);
  for (const name of readExportIgnore(root)) skipDirs.add(name);
  for (const p of skipArgs) skipDirs.add(p.replace(/^.*[\\/]/, ''));

  const shippedRoots = readShippedRoots(root);
  /** @type {string[]} */
  const walked = [];
  walk(root, root, skipDirs, walked);
  const files = walked.filter((rel) => isShipped(rel, shippedRoots)).sort();

  const pendingFiles = readPending(root, problems);
  let pendingLines = 0;
  let scanned = 0;
  for (const rel of files) {
    const text = readText(join(root, rel));
    if (text === null) continue;
    scanned += 1;
    let staleHere = 0;
    const rows = text.split('\n');
    const history = rel === 'CHANGELOG.md' ? changelogHistoryLines(rows) : new Set();
    rows.forEach((row, i) => {
      if (history.has(i)) return;
      const line = row.replace(/\r$/, '');
      if (!STALE.some((token) => line.includes(token))) return;
      if (allow.has(rel + SEP + line)) return;
      if (pendingFiles.has(rel)) {
        staleHere += 1;
        return;
      }
      problems.push(rel + ':' + String(i + 1) + ' stale release string: ' + line.trim());
    });
    const listed = pendingFiles.get(rel);
    if (listed !== undefined) {
      pendingLines += staleHere;
      if (staleHere !== listed) {
        problems.push(rel + ' holds ' + String(staleHere) + ' stale lines against ' + String(listed) + ' listed as pending');
      }
    }
  }

  return { problems, scanned, allowCount, pendingFiles: pendingFiles.size, pendingLines };
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
  const r = checkReleaseStrings(root, process.argv.slice(3));
  const out = (/** @type {string} */ line) => process.stdout.write(line + '\n');
  out('check-release-strings: release string ' + RELEASE);
  out('check-release-strings: files scanned ' + String(r.scanned));
  out('check-release-strings: allow listed lines ' + String(r.allowCount));
  out('check-release-strings: pending files ' + String(r.pendingFiles) + ' with ' + String(r.pendingLines) + ' stale lines');
  if (r.problems.length === 0) {
    out('check-release-strings: PASS, every stale string is allow listed');
    process.exitCode = 0;
  } else {
    out('check-release-strings: FAIL, ' + String(r.problems.length) + ' stale lines');
    for (const p of r.problems.slice(0, 200)) out('  ' + p);
    process.exitCode = 1;
  }
}
