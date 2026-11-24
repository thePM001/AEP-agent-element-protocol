#!/usr/bin/env node
// @ts-check
/*
 * check-writing-rule-sites.mjs
 *
 * Counts the definition sites of the writing rule family. Policy DUP-286-P1.
 *
 * A definition site is a code file that decides a writing rule on its own, which
 * means it carries a matcher for a family rule and it does not read the one
 * compiled wall set. A file that reads the compiled set is a consumer, and a file
 * that only declares the rule ids is a label list.
 *
 * The count must be one. The one site is the admit crate, which holds the rule
 * table and the one matcher dispatch, and the rule source is compiled there.
 *
 * Run:  node AEP-User-Experience/harness/check-writing-rule-sites.mjs [tree root]
 * Exit: 0 when the family has one definition site, 1 otherwise.
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ONE_SITE = 'AEP-Components/admit/crate/src/lib.rs';
const SOURCE = 'AEP-Policy-System/reference/writing.gap';

const FAMILY = [
  'no_em_dashes', 'no_en_dashes', 'no_dash_substitutes', 'no_box_drawing_dashes',
  'no_minus_as_dash', 'no_double_hyphen', 'no_oxford_comma', 'punctuation_word_space',
  'space_before_spaced_signs', 'attach_comma_semicolon', 'attach_double_colon',
];

const READS_THE_SET = [
  'line_closes_rule', 'compile_writing_walls', 'compileWritingWalls',
  'writingRuleNamed', 'writingRuleTable', 'kernelClosedRules', 'runEpscomValidateWriting',
];
const CODE_EXT = new Set(['.rs', '.mjs', '.js', '.ts', '.tsx', '.mts', '.cjs']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build']);
const DOC_EXT = new Set(['.md', '.gap', '.json', '.yaml', '.yml', '.txt', '.html']);

/**
 * @param {string} root
 * @param {string} dir
 * @param {string[]} out
 */
function walk(root, dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (DOC_EXT.has(ext)) continue;
      if (!CODE_EXT.has(ext)) continue;
      if (st.size > 2000000) continue;
      out.push(relative(root, full));
    }
  }
}

const TEST_OPS = ['.includes(', '.contains(', '.indexOf(', '.test(', '.match(', 'contains_char(', 'has('];

/**
 * A matcher is a test of a writing pattern, not a string that carries a sample.
 * @param {string} text
 */
export function carriesMatcher(text) {
  const patterns = ['\\u{2014}', '\\u2014', '\\u{2013}', '\\u2013', '\\u{2015}', '\\u2015',
    '\\u{2e3a}', '\\u2e3a', '\\u{2e3b}', '\\u2e3b', '\\u{2212}', '\\u2212', ', and ', ', or '];
  for (const line of text.split('\n')) {
    const carriesPattern = patterns.some((p) => line.includes(p));
    if (!carriesPattern) continue;
    if (!TEST_OPS.some((op) => line.includes(op))) continue;
    if (/^\s*(\*|#|\/\/)/.test(line)) continue;
    return true;
  }
  return false;
}

/** @param {string} text */
export function readsTheSet(text) {
  return READS_THE_SET.some((marker) => text.includes(marker));
}

/**
 * Count the definition sites, consumers and label lists of the family under a
 * tree root.
 * @param {string} root
 */
export function countWritingRuleSites(root) {
  /** @type {string[]} */
  const files = [];
  walk(root, root, files);
  files.sort();

  /** @type {string[]} */
  const sites = [];
  /** @type {string[]} */
  const consumers = [];
  /** @type {string[]} */
  const labels = [];

  for (const rel of files) {
    let text = '';
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    if (rel === ONE_SITE) { sites.push(rel); continue; }
    const decidedHere = carriesMatcher(text);
    const reads = readsTheSet(text);
    if (decidedHere && !reads) sites.push(rel);
    else if (reads) consumers.push(rel);
    else if (FAMILY.filter((id) => text.includes(id)).length >= 3) labels.push(rel);
  }

  const sourceText = readFileSync(join(root, SOURCE), 'utf8');
  const sourceIds = FAMILY.filter((id) => sourceText.includes('"' + id + '"'));
  /** @type {string[]} */
  const problems = [];
  if (sites.length !== 1) problems.push('the family has ' + String(sites.length) + ' definition sites');
  if (sourceIds.length !== FAMILY.length) {
    problems.push('the rule source names ' + String(sourceIds.length) + ' of ' + String(FAMILY.length));
  }
  return { family: FAMILY.length, sourceIds, sites, consumers, labels, problems };
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
  const r = countWritingRuleSites(resolve(process.argv[2] ? process.argv[2] : process.cwd()));
  const out = (/** @type {string} */ line) => process.stdout.write(line + '\n');
  out('check-writing-rule-sites: family rules ' + String(r.family));
  out('check-writing-rule-sites: the rule source names ' + String(r.sourceIds.length) + ' rules');
  out('check-writing-rule-sites: definition sites ' + String(r.sites.length));
  for (const s of r.sites) out('  decides ' + s);
  out('check-writing-rule-sites: consumers ' + String(r.consumers.length));
  for (const c of r.consumers) out('  reads ' + c);
  out('check-writing-rule-sites: id label lists ' + String(r.labels.length));
  for (const l of r.labels) out('  labels ' + l);
  for (const p of r.problems) out('check-writing-rule-sites: FAIL, ' + p);
  if (r.problems.length === 0) {
    out('check-writing-rule-sites: PASS, one definition site and ' + String(r.consumers.length) + ' consumers');
  }
  process.exitCode = r.problems.length === 0 ? 0 : 1;
}
