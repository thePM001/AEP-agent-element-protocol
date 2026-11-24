#!/usr/bin/env node
/**
 * The hostile agent corpus of the conformance suite (CC-36).
 *
 *   node hostile-corpus.mjs validate [repo-root]
 *   node hostile-corpus.mjs runs     [repo-root]
 *   node hostile-corpus.mjs account  <repo-root> <report-dir>
 *
 * Each case of hostile/corpus.json plays one attack of an agent against the stack and
 * names the test that proves the attack fails. Every finding of the code review that the
 * corpus follows sits in exactly one place: a case that replays it, the open list whose
 * remediation still owes its case or the elsewhere list that names the suite that proves
 * it.
 *
 * runs prints one line per cargo run for run.sh: the run number, the package, the
 * target and the test names, separated by tabs. run.sh runs each one and leaves its
 * output in hostile-<n>.out and its exit status in hostile-<n>.code of the report
 * folder. account then fails unless the corpus is sound and every case ran exactly its
 * one test to a pass.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CASE_ID_RE = /^HA-\d{2}$/;
const FINDING_RE = /^[A-Z]+ \d{2}$/;
// "--lib --bins" tells run.sh to build the programs of the package with cargo build
// first, for a lib test that starts one of them, and then to run the lib tests.
const TARGET_RE = /^(--lib|--lib --bins|--test=[a-z0-9_]+)$/;
const TEST_RE = /^[a-z0-9_]+(::[a-z0-9_]+)*$/;
const PACKAGE_RE = /^[a-z0-9-]+$/;
export const CORPUS_PATH = "AEP-Components/conformance/hostile/corpus.json";

/**
 * @typedef {{ id: string, findings: string[], class: string, attack: string, expect: string,
 *   package: string, target: string, test: string, file: string }} HostileCase
 * @typedef {{ findings: string[], area?: string, reason: string }} FindingGroup
 * @typedef {{ suite: string, version: string, findings: string[], required_classes: string[],
 *   cases: HostileCase[], open: FindingGroup[], elsewhere: FindingGroup[] }} Corpus
 */

/** @param {unknown} v */
function text(v) {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Every problem with the corpus, empty when it is sound. With a repo root the files the
 * cases name must exist and hold the test function.
 * @param {Corpus} corpus
 * @param {string | null} repoRoot
 * @returns {string[]}
 */
export function validateCorpus(corpus, repoRoot) {
  const problems = [];
  const findings = Array.isArray(corpus.findings) ? corpus.findings : [];
  const cases = Array.isArray(corpus.cases) ? corpus.cases : [];
  const open = Array.isArray(corpus.open) ? corpus.open : [];
  const elsewhere = Array.isArray(corpus.elsewhere) ? corpus.elsewhere : [];
  const required = Array.isArray(corpus.required_classes) ? corpus.required_classes : [];
  if (!findings.length) problems.push("the corpus lists no findings");
  if (!cases.length) problems.push("the corpus holds no case");

  const known = new Set();
  for (const f of findings) {
    if (!FINDING_RE.test(f)) problems.push(`bad finding id ${JSON.stringify(f)}`);
    if (known.has(f)) problems.push(`finding ${f} is listed twice`);
    known.add(f);
  }

  /** @type {Map<string, string>} where each finding sits */
  const placed = new Map();
  /** @param {string} f @param {string} where */
  const place = (f, where) => {
    if (!known.has(f)) {
      problems.push(`${where} names ${f}, which the finding list does not hold`);
      return;
    }
    const before = placed.get(f);
    if (before && !(before.startsWith("case") && where.startsWith("case"))) {
      problems.push(`finding ${f} sits in ${before} and in ${where}`);
    }
    if (!before) placed.set(f, where);
  };

  const ids = new Set();
  const tests = new Set();
  const classes = new Set();
  for (const c of cases) {
    const where = `case ${c.id}`;
    if (!CASE_ID_RE.test(c.id ?? "")) problems.push(`bad case id ${JSON.stringify(c.id)}`);
    if (ids.has(c.id)) problems.push(`case ${c.id} is listed twice`);
    ids.add(c.id);
    const testKey = `${c.package} ${c.target} ${c.test}`;
    if (tests.has(testKey)) problems.push(`${where} repeats the test ${c.test}`);
    tests.add(testKey);
    // A case may guard a boundary that no finding named: its list is then empty.
    if (!Array.isArray(c.findings)) {
      problems.push(`${where} has no finding list`);
    } else {
      for (const f of c.findings) place(f, where);
    }
    for (const k of /** @type {const} */ (["class", "attack", "expect"])) {
      if (!text(c[k])) problems.push(`${where} has no ${k}`);
    }
    classes.add(c.class);
    if (!PACKAGE_RE.test(c.package ?? "")) problems.push(`${where} has a bad package`);
    if (!TARGET_RE.test(c.target ?? "")) problems.push(`${where} has a bad target`);
    if (!TEST_RE.test(c.test ?? "")) {
      problems.push(`${where} has a bad test path`);
      continue;
    }
    if (repoRoot) {
      const file = join(repoRoot, c.file ?? "");
      if (!text(c.file) || !existsSync(file)) {
        problems.push(`${where} file ${c.file} does not exist`);
        continue;
      }
      const name = c.test.split("::").pop();
      const body = readFileSync(file, "utf8");
      if (!new RegExp(`\\bfn ${name}\\s*\\(`).test(body)) {
        problems.push(`${where} file ${c.file} holds no test fn ${name}`);
      }
    }
  }
  for (const [list, label] of /** @type {const} */ ([
    [open, "open"],
    [elsewhere, "elsewhere"],
  ])) {
    for (const g of list) {
      if (!text(g.reason)) problems.push(`an ${label} group gives no reason`);
      if (!Array.isArray(g.findings) || !g.findings.length) {
        problems.push(`an ${label} group names no finding`);
        continue;
      }
      for (const f of g.findings) place(f, label);
    }
  }
  for (const f of known) {
    if (!placed.has(f)) problems.push(`finding ${f} has no case and no open or elsewhere entry`);
  }
  for (const k of required) {
    if (!classes.has(k)) problems.push(`no case plays the class ${k}`);
  }
  return [...new Set(problems)];
}

/**
 * The cargo runs of the corpus: one per package and target, with every test of it.
 * @param {HostileCase[]} cases
 * @returns {{ package: string, target: string, tests: Map<string, string> }[]}
 */
export function cargoRuns(cases) {
  /** @type {Map<string, { package: string, target: string, tests: Map<string, string> }>} */
  const runs = new Map();
  for (const c of cases) {
    const key = `${c.package} ${c.target}`;
    let run = runs.get(key);
    if (!run) {
      run = { package: c.package, target: c.target, tests: new Map() };
      runs.set(key, run);
    }
    run.tests.set(c.test, c.id);
  }
  return [...runs.values()];
}

/**
 * Read the libtest output of one run. Each named test must report ok exactly once and the
 * totals must hold exactly the named tests, so a filter that matched nothing or more fails.
 * @param {string} out
 * @param {string[]} tests
 * @returns {{ passed: string[], problems: string[] }}
 */
export function readRun(out, tests) {
  const problems = [];
  const passed = [];
  for (const t of tests) {
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ok = out.match(new RegExp(`^test ${esc} \\.\\.\\. ok$`, "gm")) ?? [];
    if (ok.length === 1) passed.push(t);
    else problems.push(`${t} did not report ok exactly once`);
  }
  let total = 0;
  let failed = 0;
  for (const m of out.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed;/gm)) {
    total += Number(m[1]);
    failed += Number(m[2]);
  }
  if (failed) problems.push(`${failed} tests failed`);
  if (total !== tests.length) {
    problems.push(`the run passed ${total} tests where the corpus names ${tests.length}`);
  }
  return { passed, problems };
}

/** @param {string} path @returns {Corpus} */
function readCorpus(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Account the cargo runs that run.sh left in the report folder.
 * @param {Corpus} corpus
 * @param {(n: number) => { out: string | null, code: string | null }} report
 * @returns {{ passed: string[], problems: string[] }} the case ids that passed
 */
export function accountRuns(corpus, report) {
  const passed = [];
  const problems = [];
  cargoRuns(corpus.cases).forEach((run, i) => {
    const { out, code } = report(i + 1);
    const label = `run ${i + 1} (${run.package} ${run.target})`;
    if (out === null || code === null) {
      problems.push(`${label} left no output`);
      return;
    }
    const read = readRun(out, [...run.tests.keys()]);
    if (code.trim() !== "0") read.problems.push(`cargo exited with ${code.trim()}`);
    for (const t of read.passed) passed.push(`${run.tests.get(t)} ${t}`);
    for (const p of read.problems) problems.push(`${label}: ${p}`);
  });
  return { passed, problems };
}

/** @param {string | undefined} arg */
function rootOf(arg) {
  return resolve(arg ?? join(fileURLToPath(new URL(".", import.meta.url)), "../../.."));
}

/** @param {string} path */
function readOrNull(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** @param {string[]} argv */
function main(argv) {
  const [cmd, rootArg, reportDir] = argv;
  if (cmd !== "validate" && cmd !== "runs" && cmd !== "account") {
    console.error("usage: hostile-corpus.mjs validate|runs [repo-root] | account <repo-root> <report-dir>");
    return 2;
  }
  const root = rootOf(rootArg);
  const corpus = readCorpus(join(root, CORPUS_PATH));
  const problems = validateCorpus(corpus, root);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL hostile corpus: ${p}`);
    return 1;
  }
  if (cmd === "runs") {
    cargoRuns(corpus.cases).forEach((run, i) => {
      console.log(`${i + 1}\t${run.package}\t${run.target}\t${[...run.tests.keys()].join(" ")}`);
    });
    return 0;
  }
  const openCount = corpus.open.reduce((n, g) => n + g.findings.length, 0);
  const elsewhereCount = corpus.elsewhere.reduce((n, g) => n + g.findings.length, 0);
  console.log(
    `hostile corpus: ${corpus.cases.length} cases over ${corpus.findings.length} findings, ` +
      `${openCount} open and ${elsewhereCount} proven elsewhere`,
  );
  if (cmd === "validate") return 0;
  if (!reportDir) {
    console.error("account needs the report folder");
    return 2;
  }
  const result = accountRuns(corpus, (n) => ({
    out: readOrNull(join(reportDir, `hostile-${n}.out`)),
    code: readOrNull(join(reportDir, `hostile-${n}.code`)),
  }));
  for (const p of result.passed) console.log(`pass ${p}`);
  for (const p of result.problems) console.error(`FAIL hostile corpus: ${p}`);
  console.log(`hostile corpus: ${result.passed.length} of ${corpus.cases.length} cases passed`);
  return result.problems.length || result.passed.length !== corpus.cases.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
