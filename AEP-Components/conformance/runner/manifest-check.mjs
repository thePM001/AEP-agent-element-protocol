#!/usr/bin/env node
/**
 * Manifest accounting for the AEP conformance runner.
 *
 *   node manifest-check.mjs validate   <manifest>
 *   node manifest-check.mjs cargo-tests <manifest>
 *   node manifest-check.mjs node-checks <manifest>
 *   node manifest-check.mjs account    <manifest> <report-dir>
 *
 * cargo-tests and node-checks print one line per command for run.sh: the check ids,
 * a tab and the arguments. account reads what the run left in the report folder and
 * exits 1 unless every listed check ran and passed. A check that is declared and
 * not run fails the run, so no check is ever declared and skipped.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RUNNERS = new Set(["rust", "vitest", "node"]);
const ID_RE = /^CC-\d{2}$/;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: ${e.message}`);
  }
}

/** Every problem with the manifest itself, empty when it is sound. */
export function validateManifest(manifest, repoRoot) {
  const problems = [];
  const checks = Array.isArray(manifest.checks) ? manifest.checks : [];
  const planned = Array.isArray(manifest.planned) ? manifest.planned : [];
  if (!checks.length) problems.push("manifest lists no checks");
  if (manifest.normative !== "rust") problems.push("manifest must declare the Rust kernel normative");
  const seen = new Set();
  for (const c of [...checks, ...planned]) {
    if (!ID_RE.test(c.id ?? "")) problems.push(`bad check id ${JSON.stringify(c.id)}`);
    if (seen.has(c.id)) problems.push(`${c.id} is listed twice`);
    seen.add(c.id);
    if (!String(c.name ?? "").trim()) problems.push(`${c.id} has no name`);
  }
  for (const c of checks) {
    if (!RUNNERS.has(c.runner)) {
      problems.push(`${c.id} has unknown runner ${JSON.stringify(c.runner)}`);
      continue;
    }
    if (c.runner === "rust" && !c.crate) problems.push(`${c.id} names no crate`);
    if (c.runner === "vitest" || c.runner === "node") {
      if (!c.file) problems.push(`${c.id} names no file`);
      else if (repoRoot && !existsSync(join(repoRoot, c.file))) {
        problems.push(`${c.id} file ${c.file} does not exist`);
      }
    }
    if (c.runner === "vitest" && c.file && !/\.test\.mjs$/.test(c.file)) {
      problems.push(`${c.id} vitest file must end in .test.mjs`);
    }
  }
  for (const p of planned) {
    if (p.claim !== "none") problems.push(`planned ${p.id} must carry claim none`);
    if (!String(p.reason ?? "").trim()) problems.push(`planned ${p.id} gives no reason`);
    if (p.runner || p.file || p.crate || p.cargo_test) {
      problems.push(`planned ${p.id} must not name a runner`);
    }
  }
  return problems;
}

/** Group checks that share one command so each command runs once. */
function grouped(checks, pick) {
  const byArgs = new Map();
  for (const c of checks) {
    const args = pick(c);
    if (!args) continue;
    if (!byArgs.has(args)) byArgs.set(args, []);
    byArgs.get(args).push(c.id);
  }
  return [...byArgs.entries()].map(([args, ids]) => `${ids.join(",")}\t${args}`);
}

export function cargoTestLines(manifest) {
  return grouped(manifest.checks, (c) => (c.runner === "rust" ? c.cargo_test : null));
}

export function nodeCheckLines(manifest) {
  return grouped(manifest.checks, (c) => (c.runner === "node" ? c.file : null));
}

/** The check id a vitest test name opens with, as in "CC-17 ...". */
function vitestCheckId(fullName) {
  const m = /^(CC-\d{2})\b/.exec(String(fullName ?? "").trim());
  return m ? m[1] : null;
}

/** Account one run. Returns { executed, problems }. */
export function account(manifest, reports) {
  const problems = [];
  const executed = new Set();
  const listed = new Map(manifest.checks.map((c) => [c.id, c]));
  const plannedIds = new Set((manifest.planned ?? []).map((p) => p.id));

  // Kernel checks: the aep-conformance JSON report.
  const kernelIds = new Set(
    manifest.checks.filter((c) => c.runner === "rust" && !c.cargo_test).map((c) => c.id),
  );
  const rust = reports.rust;
  if (!rust || !Array.isArray(rust.checks)) {
    problems.push("no aep-conformance report");
  } else {
    for (const r of rust.checks) {
      if (!kernelIds.has(r.id)) {
        problems.push(`aep-conformance ran ${r.id}, which the manifest does not list as a kernel check`);
        continue;
      }
      if (r.passed) executed.add(r.id);
      else problems.push(`${r.id} failed: ${r.error ?? "no error text"}`);
    }
  }

  // cargo test and node checks: run.sh records ids after the command exits 0.
  for (const id of reports.ran ?? []) {
    const c = listed.get(id);
    if (!c || !(c.cargo_test || c.runner === "node")) {
      problems.push(`run.sh recorded ${id}, which is not a cargo test or node check`);
      continue;
    }
    executed.add(id);
  }

  // vitest checks: the vitest JSON report. Every test of a check must pass.
  const vitestIds = new Set(manifest.checks.filter((c) => c.runner === "vitest").map((c) => c.id));
  const vitest = reports.vitest;
  if (vitestIds.size && (!vitest || !Array.isArray(vitest.testResults))) {
    problems.push("no vitest report");
  } else if (vitest) {
    const perCheck = new Map();
    for (const file of vitest.testResults) {
      for (const t of file.assertionResults ?? []) {
        const id = vitestCheckId(t.fullName ?? t.title);
        if (!id) continue;
        if (plannedIds.has(id)) {
          problems.push(`vitest ran a test for planned ${id}`);
          continue;
        }
        if (!vitestIds.has(id)) {
          problems.push(`vitest test "${t.fullName}" names ${id}, which is not a vitest check`);
          continue;
        }
        const tally = perCheck.get(id) ?? { passed: 0, other: [] };
        if (t.status === "passed") tally.passed += 1;
        else tally.other.push(`${t.fullName}: ${t.status}`);
        perCheck.set(id, tally);
      }
      if (file.status === "failed" && !(file.assertionResults ?? []).length) {
        problems.push(`vitest file ${file.name} failed to load: ${file.message ?? ""}`.trim());
      }
    }
    for (const id of vitestIds) {
      const tally = perCheck.get(id);
      if (!tally) continue;
      if (tally.other.length) {
        problems.push(...tally.other.map((o) => `${id} ${o}`));
        continue;
      }
      if (tally.passed > 0) executed.add(id);
    }
  }

  for (const id of listed.keys()) {
    if (!executed.has(id)) problems.push(`${id} is listed and did not run to a pass`);
  }
  return { executed: [...executed].sort(), problems: [...new Set(problems)] };
}

function readRan(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main(argv) {
  const [cmd, manifestPath, reportDir] = argv;
  if (!cmd || !manifestPath) {
    console.error("usage: manifest-check.mjs validate|cargo-tests|node-checks|account <manifest> [report-dir]");
    return 2;
  }
  const manifest = readJson(manifestPath);
  const repoRoot = join(manifestPath, "../../../..");
  const problems = validateManifest(manifest, repoRoot);
  if (problems.length) {
    for (const p of problems) console.error(`FAIL manifest: ${p}`);
    return 1;
  }
  if (cmd === "validate") return 0;
  if (cmd === "cargo-tests") {
    for (const line of cargoTestLines(manifest)) console.log(line);
    return 0;
  }
  if (cmd === "node-checks") {
    for (const line of nodeCheckLines(manifest)) console.log(line);
    return 0;
  }
  if (cmd === "account") {
    if (!reportDir) {
      console.error("account needs the report folder");
      return 2;
    }
    const rustPath = join(reportDir, "rust-report.json");
    const vitestPath = join(reportDir, "vitest-report.json");
    const reports = {
      rust: existsSync(rustPath) ? readJson(rustPath) : null,
      vitest: existsSync(vitestPath) ? readJson(vitestPath) : null,
      ran: readRan(join(reportDir, "ran.txt")),
    };
    const result = account(manifest, reports);
    for (const p of result.problems) console.error(`FAIL ${p}`);
    const total = manifest.checks.length;
    const planned = (manifest.planned ?? []).length;
    console.log(
      `Executed ${result.executed.length} of ${total} listed checks. ` +
        `${planned} planned checks carry no compliance claim.`,
    );
    return result.problems.length ? 1 : 0;
  }
  console.error(`unknown command ${cmd}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
