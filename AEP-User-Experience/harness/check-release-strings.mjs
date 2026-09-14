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

const RELEASE = '2.8.6';
const STALE = ['2.8.5', '2.75', '2.8.0'];
const ROOT = process.argv[2] ? process.argv[2] : process.cwd();
const SKIP_ARGS = process.argv.slice(3).map((p) => p.replace(/^.*[\\/]/, ''));
const LIST_PATH = join(ROOT, 'AEP-User-Experience/harness/release-allow.list');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build', '.next']);

/* The allow list and this tool carry the stale strings as their own data, so the
 * check does not read them. */
const SKIP_FILES = new Set([
  'AEP-User-Experience/harness/release-allow.list',
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

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch (err) {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
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

const files = [];
walk(ROOT, files);
files.sort();

let scanned = 0;
for (const rel of files) {
  let text;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch (err) {
    continue;
  }
  scanned += 1;
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i += 1) {
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
    problems.push(rel + ':' + String(i + 1) + ' stale release string: ' + line.trim());
  }
}

process.stdout.write('check-release-strings: release string ' + RELEASE + '\n');
process.stdout.write('check-release-strings: files scanned ' + String(scanned) + '\n');
process.stdout.write('check-release-strings: allow listed lines ' + String(allowCount) + '\n');
if (problems.length === 0) {
  process.stdout.write('check-release-strings: PASS, every stale string is allow listed\n');
  process.exit(0);
}
process.stdout.write('check-release-strings: FAIL, ' + String(problems.length) + ' stale lines\n');
for (const p of problems.slice(0, 200)) {
  process.stdout.write('  ' + p + '\n');
}
process.exit(1);
