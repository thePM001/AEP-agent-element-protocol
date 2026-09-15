#!/usr/bin/env node
/*
 * check-writing-rule-sites.mjs
 *
 * Counts the definition sites of the writing rule family. The policy for this check is the writing rule consolidation.
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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.argv[2] ? process.argv[2] : process.cwd();
const ONE_SITE = 'AEP-Components/admit/crate/src/lib.rs';
const SOURCE = 'AEP-Policy-System/reference/writing.gap';

const FAMILY = [
  'no_em_dashes', 'no_en_dashes', 'no_dash_substitutes', 'no_box_drawing_dashes',
  'no_minus_as_dash', 'no_double_hyphen', 'no_oxford_comma', 'punctuation_word_space',
  'space_before_spaced_signs', 'attach_comma_semicolon', 'attach_double_colon',
];

const READS_THE_SET = [
  'line_closes_rule', 'compile_writing_walls', 'compileWritingWalls',
  'writingRuleNamed', 'writingRuleTable', 'kernelClosedRules', 'runCorrectwritingEnValidateWriting',
];
const CODE_EXT = new Set(['.rs', '.mjs', '.js', '.ts', '.tsx', '.mts', '.cjs']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'build']);
const DOC_EXT = new Set(['.md', '.gap', '.gap-format', '.json', '.yaml', '.yml', '.txt', '.html']);

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch (e) { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile()) {
      const ext = extname(name).toLowerCase();
      if (DOC_EXT.has(ext)) continue;
      if (!CODE_EXT.has(ext)) continue;
      if (st.size > 2000000) continue;
      out.push(relative(ROOT, full));
    }
  }
}

const TEST_OPS = ['.includes(', '.contains(', '.indexOf(', '.test(', '.match(', 'contains_char(', 'has('];

/** A matcher is a test of a writing pattern, not a string that carries a sample. */
function carriesMatcher(text) {
  const dashLiteral = (ch) => text.includes(ch);
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

function readsTheSet(text) {
  return READS_THE_SET.some((marker) => text.includes(marker));
}

const files = [];
walk(ROOT, files);
files.sort();

const sites = [];
const consumers = [];
const labels = [];

for (const rel of files) {
  let text = '';
  try { text = readFileSync(join(ROOT, rel), 'utf8'); } catch (e) { continue; }
  const isOneSite = rel === ONE_SITE;
  const decidedHere = carriesMatcher(text);
  const reads = readsTheSet(text);
  if (isOneSite) { sites.push(rel); continue; }
  if (decidedHere && !reads) sites.push(rel);
  else if (reads) consumers.push(rel);
  else if (FAMILY.filter((id) => text.includes(id)).length >= 3) labels.push(rel);
}

const sourceText = readFileSync(join(ROOT, SOURCE), 'utf8');
const sourceIds = FAMILY.filter((id) => sourceText.includes('"' + id + '"'));

process.stdout.write('check-writing-rule-sites: family rules ' + String(FAMILY.length) + '\n');
process.stdout.write('check-writing-rule-sites: the rule source names ' + String(sourceIds.length) + ' rules\n');
process.stdout.write('check-writing-rule-sites: definition sites ' + String(sites.length) + '\n');
for (const s of sites) process.stdout.write('  decides ' + s + '\n');
process.stdout.write('check-writing-rule-sites: consumers ' + String(consumers.length) + '\n');
for (const c of consumers) process.stdout.write('  reads ' + c + '\n');
process.stdout.write('check-writing-rule-sites: id label lists ' + String(labels.length) + '\n');
for (const l of labels) process.stdout.write('  labels ' + l + '\n');

if (sites.length !== 1) {
  process.stdout.write('check-writing-rule-sites: FAIL, the family has ' + String(sites.length) + ' definition sites\n');
  process.exit(1);
}
if (sourceIds.length !== FAMILY.length) {
  process.stdout.write('check-writing-rule-sites: FAIL, the rule source names ' + String(sourceIds.length) + ' of ' + String(FAMILY.length) + '\n');
  process.exit(1);
}
process.stdout.write('check-writing-rule-sites: PASS, one definition site and ' + String(consumers.length) + ' consumers\n');
