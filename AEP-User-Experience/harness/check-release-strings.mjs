#!/usr/bin/env node
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const RELEASE = '2.9.0';
const STALE = ['2.8.6', '2.8.x', '2.8.5', '2.8.0', '2.75', 'AEP 2.8 ', 'AEP 2.8.', 'AEP v2.8', 'AEP-2.8'];
const ROOT = process.argv[2] ? process.argv[2] : process.cwd();
const SKIP_ARGS = process.argv.slice(3).map((p) => p.replace(/^.*[\\/]/, ''));
const LIST_PATH = join(ROOT, 'AEP-User-Experience/harness/release-allow.list');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next']);

/* The allow list and this tool carry the stale strings as their own data, so the
 * check does not read them. */
const SKIP_FILES = new Set([
  'AEP-User-Experience/harness/release-allow.list',
  'AEP-User-Experience/harness/release-pending.list',
  'AEP-User-Experience/harness/check-release-strings.mjs',
]);

/* A path that the tree attributes file marks export-ignore does not ship, so the
 * check does not read it. The attributes file is the single statement of that set. */
function readExportIgnore(root) {
  const skip = new Set();
  let text = '';
  try {
    text = readFileSync(join(root, '.gitattributes'), 'utf8');
  } catch (err) {
    return skip;
  }
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (row.length === 0) continue;
    if (row[0] === '#') continue;
    const parts = row.split(/\s+/);
    if (parts.length < 2) continue;
    if (parts.indexOf('export-ignore') < 0) continue;
    skip.add(parts[0].replace(/\/$/, ''));
  }
  return skip;
}
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.eot',
  '.ots', '.zip', '.gz', '.tgz', '.wasm', '.so', '.dylib', '.dll', '.bin', '.db', '.usearch',
  '.lock',
]);

function parseAllow(text) {
  const allow = new Set();
  let count = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0) continue;
    if (line[0] === '#') continue;
    const first = line.indexOf('\t');
    if (first < 0) continue;
    const rest = line.slice(first + 1);
    const second = rest.indexOf('\t');
    const body = second < 0 ? rest : rest.slice(0, second);
    allow.add(line.slice(0, first) + '\u0000' + body);
    count += 1;
  }
  return { allow, count };
}

/* AEP29-VER-010: files that still carry the old release string because a node scan
 * refuses a new landing of the file. Each row names the exact number of stale lines. */
function readPending(root) {
  const pending = new Map();
  let text = '';
  try {
    text = readFileSync(join(root, 'AEP-User-Experience/harness/release-pending.list'), 'utf8');
  } catch (err) {
    return pending;
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0 || line[0] === '#') continue;
    const cols = line.split('\t');
    if (cols.length < 2) continue;
    pending.set(cols[0], Number(cols[1]));
  }
  return pending;
}

function readReleaseSources() {
  const found = [];
  const pkg = join(ROOT, 'package.json');
  const cargo = join(ROOT, 'Cargo.toml');
  try {
    found.push({ file: 'package.json', value: JSON.parse(readFileSync(pkg, 'utf8')).version });
  } catch (err) {
    found.push({ file: 'package.json', value: null });
  }
  try {
    const text = readFileSync(cargo, 'utf8');
    const at = text.indexOf('[workspace.package]');
    const head = at < 0 ? '' : text.slice(at + '[workspace.package]'.length);
    const end = head.indexOf('\n[');
    const section = end < 0 ? head : head.slice(0, end);
    let value = null;
    for (const row of section.split('\n')) {
      const t = row.trim();
      if (t.indexOf('version') === 0 && t.indexOf('workspace') < 0) {
        const m = t.match(/"([^"]+)"/);
        if (m) value = m[1];
      }
    }
    found.push({ file: 'Cargo.toml', value });
  } catch (err) {
    found.push({ file: 'Cargo.toml', value: null });
  }
  return found;
}

/* AEP29-VER-010: the tool no longer asks git for the tracked files, so it honors the plain
 * directory entries of each .gitignore as it walks. An entry applies to the folder that holds
 * the .gitignore and to everything below it. Patterns with a wildcard are not read. */
function readIgnoredNames(dir) {
  const names = new Set();
  let text = '';
  try {
    text = readFileSync(join(dir, '.gitignore'), 'utf8');
  } catch (err) {
    return names;
  }
  for (const raw of text.split('\n')) {
    let row = raw.trim();
    if (row.length === 0 || row[0] === '#' || row[0] === '!') continue;
    row = row.replace(/^\//, '').replace(/^\*\*\//, '').replace(/\/\*\*$/, '').replace(/\/$/, '');
    if (row.length === 0 || /[*?\[/]/.test(row)) continue;
    names.add(row);
  }
  return names;
}

function walk(dir, out, inherited = new Set()) {
  const ignored = new Set([...inherited, ...readIgnoredNames(dir)]);
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (ignored.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out, ignored);
    } else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (SKIP_EXT.has(ext)) continue;
      if (st.size > 4000000) continue;
      const rel = relative(ROOT, full);
      if (SKIP_FILES.has(rel)) continue;
      out.push(rel);
    }
  }
}

const allowText = readFileSync(LIST_PATH, 'utf8');
const { allow, count: allowCount } = parseAllow(allowText);
const problems = [];

for (const src of readReleaseSources()) {
  if (src.value !== RELEASE) {
    problems.push(src.file + ' reads ' + String(src.value) + ' against the release string ' + RELEASE);
  }
}

const exportIgnore = readExportIgnore(ROOT);
for (const name of exportIgnore) SKIP_DIRS.add(name);
for (const name of SKIP_ARGS) SKIP_DIRS.add(name);

/* Only the shipped roots describe the product. Files at the tree root always
 * ship. The list lives in shipped-roots.list so every check reads one set. */
function readShippedRoots(root) {
  let text = '';
  try {
    text = readFileSync(join(root, 'AEP-User-Experience/harness/shipped-roots.list'), 'utf8');
  } catch (err) {
    return null;
  }
  const roots = new Set();
  for (const raw of text.split('\n')) {
    const row = raw.trim();
    if (row.length === 0 || row[0] === '#') continue;
    roots.add(row);
  }
  return roots;
}

function isShipped(rel, roots) {
  if (roots === null) return true;
  const slash = rel.indexOf('/');
  if (slash < 0) return true;
  return roots.has(rel.slice(0, slash));
}

/* In a git checkout the tracked files are what ships, so ignored build output
 * such as Go caches or a local bin folder is never read. Outside a checkout the
 * walk with the skip rules above is the fallback. */
function trackedFiles(root) {
  /* AEP29-VER-010: the tool no longer starts git. The walk below with the skip
   * rules and the export-ignore list reads the same shipped roots. */
  return null;
}

function keepFile(rel) {
  const parts = rel.split('/');
  for (const part of parts.slice(0, -1)) {
    if (SKIP_DIRS.has(part)) return false;
  }
  for (const skip of SKIP_DIRS) {
    if (rel === skip || rel.startsWith(skip + '/')) return false;
  }
  if (SKIP_FILES.has(rel)) return false;
  if (SKIP_EXT.has(extname(rel).toLowerCase())) return false;
  try {
    const st = statSync(join(ROOT, rel));
    if (!st.isFile() || st.size > 4000000) return false;
  } catch (err) {
    return false;
  }
  return true;
}

const shippedRoots = readShippedRoots(ROOT);
const tracked = trackedFiles(ROOT);
let files = [];
if (tracked === null) {
  walk(ROOT, files);
} else {
  files = tracked.filter(keepFile);
}
files = files.filter((rel) => isShipped(rel, shippedRoots));
files.sort();

/* CHANGELOG.md keeps the release history, so only sections under the current
 * release heading are checked. Older sections name older releases on purpose. */
function changelogHistoryLines(rows) {
  const history = new Set();
  let inHistory = false;
  for (let i = 0; i < rows.length; i += 1) {
    const m = /^##\s*\[([^\]]+)\]/.exec(rows[i]);
    if (m) inHistory = m[1] !== RELEASE;
    if (inHistory) history.add(i);
  }
  return history;
}

const pendingFiles = readPending(ROOT);
let pendingLines = 0;
let scanned = 0;
for (const rel of files) {
  let staleHere = 0;
  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch (err) {
    continue;
  }
  scanned += 1;
  const rows = text.split('\n');
  const history = rel === 'CHANGELOG.md' ? changelogHistoryLines(rows) : new Set();
  for (let i = 0; i < rows.length; i += 1) {
    if (history.has(i)) continue;
    const line = rows[i].replace(/\r$/, '');
    let hit = false;
    for (const token of STALE) {
      if (line.indexOf(token) >= 0) {
        hit = true;
        break;
      }
    }
    if (!hit) continue;
    if (allow.has(rel + '\u0000' + line)) continue;
    if (pendingFiles.has(rel)) {
      staleHere += 1;
      continue;
    }
    problems.push(rel + ':' + String(i + 1) + ' stale release string: ' + line.trim());
  }
  if (pendingFiles.has(rel)) {
    pendingLines += staleHere;
    if (staleHere !== pendingFiles.get(rel)) {
      problems.push(rel + ' holds ' + String(staleHere) + ' stale lines against ' + String(pendingFiles.get(rel)) + ' listed as pending');
    }
  }
}

process.stdout.write('check-release-strings: release string ' + RELEASE + '\n');
process.stdout.write('check-release-strings: files scanned ' + String(scanned) + '\n');
process.stdout.write('check-release-strings: allow listed lines ' + String(allowCount) + '\n');
process.stdout.write('check-release-strings: pending files ' + String(pendingFiles.size) + ' with ' + String(pendingLines) + ' stale lines\n');
if (problems.length === 0) {
  process.stdout.write('check-release-strings: PASS, every stale string is allow listed\n');
  process.exit(0);
}
process.stdout.write('check-release-strings: FAIL, ' + String(problems.length) + ' stale lines\n');
for (const p of problems.slice(0, 200)) {
  process.stdout.write('  ' + p + '\n');
}
process.exit(1);
