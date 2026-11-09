#!/usr/bin/env node
/**
 * Example third-party runner for the AEP conformance vectors.
 *
 * This file is what a third party writes to test its own implementation against the
 * language neutral vectors. It needs Node 18 or later and nothing else: no Rust
 * toolchain, no Base Node build, no package from any registry and no import from this
 * repository.
 *
 * It carries its own small implementation of four suites, written from the vector
 * README and not from the Rust source:
 *
 *   dock-socket   dock port id to the socket file name
 *   dock-request  how a dock answers each plain wire format
 *   dock-answer   how a caller reads one dock answer line
 *   mesh-mode     POTOMITAN network mode and reachability
 *
 * The writing suite needs the whole writing rule set, which this example does not
 * carry, so it reports that suite as not implemented. Pass --require to make a suite
 * mandatory, as CI does.
 *
 *   node run-vectors.mjs [--vectors DIR] [--require suite,suite] [--json]
 *
 * Exit 0 when every implemented suite passes and every required suite ran, 1 when a
 * vector fails and 2 when the vectors cannot be read.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FORMAT = "aep-conformance-vectors";
const FORMAT_VERSION = 1;
const DEFAULT_VECTORS = resolve(dirname(fileURLToPath(import.meta.url)), "../../v1");

const DOCK_SUFFIXES = new Map([
  ["inference_engine", "inference"],
  ["validation_engine", "validation"],
  ["future_features", "future"],
  ["regulation_module", "regulation"],
]);

class VectorError extends Error {}
class Unsupported extends Error {}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isString = (v) => typeof v === "string";
const isBool = (v) => typeof v === "boolean";
const isInt = (v) => typeof v === "number" && Number.isInteger(v);
const optional = (obj, key, check) =>
  !Object.hasOwn(obj, key) || obj[key] === null || check(obj[key]);

// dock-socket ---------------------------------------------------------------

export function dockSocket(input) {
  const suffix = DOCK_SUFFIXES.get(input.port);
  return suffix === undefined ? { error: "unknown_dock" } : { suffix };
}

// dock-request --------------------------------------------------------------

const PLAIN_PING = "plain ping rejected: LatticeChannelFrame required";
const PLAIN_EVENT =
  "plain event rejected: seal payload into LatticeChannelFrame via aep-lattice-log build-frame";

function isEvent(event) {
  if (!isObject(event)) return false;
  if (!["agent_id", "channel_id", "event_type"].every((k) => isString(event[k]))) return false;
  if (!Object.hasOwn(event, "payload")) return false;
  return (
    optional(event, "contract_id", isString) &&
    optional(event, "action_path", isString) &&
    optional(event, "session_id", isString) &&
    optional(event, "docking_port", (v) => DOCK_SUFFIXES.has(v))
  );
}

/** A fresh dock refuses every plain request. Only a sealed frame reaches Admit. */
export function dockRequest(input) {
  let req;
  try {
    req = JSON.parse(input.line);
  } catch (err) {
    return { verdict: "refused", error: `invalid JSON: ${err.message}` };
  }
  if (isObject(req)) {
    if (isString(req.collect)) {
      if (req.collect === "") return { verdict: "refused", error: "collect requires digest" };
      // A fresh dock holds no frame, so every digest is unknown to it.
      return { verdict: "refused", error: `collect unknown digest: ${req.collect}` };
    }
    if (isBool(req.ping)) return { verdict: "refused", error: PLAIN_PING };
    if (Object.hasOwn(req, "frame")) throw new Unsupported("sealed frames need live keys");
    if (isEvent(req.event)) return { verdict: "refused", error: PLAIN_EVENT };
    const lrp = req.register_lrp;
    if (isObject(lrp) && isString(lrp.lrp_id)) {
      return {
        verdict: "refused",
        error: `plain register_lrp rejected for ${lrp.lrp_id}: use LatticeChannelFrame on regulation_module dock`,
      };
    }
  }
  return { verdict: "refused", error: "invalid JSON: no request shape matched" };
}

// dock-answer ---------------------------------------------------------------

const ANSWER_FIELDS = [
  ["event_id", isInt],
  ["digest", isString],
  ["error", isString],
  ["pending", isBool],
  ["pong", isBool],
  ["http_queued", isBool],
  ["deny", isObject],
];

export function dockAnswer(input) {
  let ans;
  try {
    ans = JSON.parse(input.line);
  } catch {
    return { verdict: "malformed" };
  }
  if (!isObject(ans) || !isBool(ans.ok)) return { verdict: "malformed" };
  for (const [key, check] of ANSWER_FIELDS) {
    if (!optional(ans, key, check)) return { verdict: "malformed" };
  }
  if (ans.pending === true) return { verdict: ans.digest ? "pending" : "refused" };
  if (ans.ok && ans.event_id !== undefined && ans.event_id !== null) return { verdict: "admitted" };
  return { verdict: "refused" };
}

// mesh-mode -----------------------------------------------------------------

export function meshMode(input) {
  if (input.internet_up) return { mode: "internet", reachable: true };
  if (input.mesh_peers > 0) return { mode: "potomitan", reachable: true };
  return { mode: "offline", reachable: false };
}

const IMPLEMENTED = new Map([
  ["dock-socket", dockSocket],
  ["dock-request", dockRequest],
  ["dock-answer", dockAnswer],
  ["mesh-mode", meshMode],
]);

// runner --------------------------------------------------------------------

export function load(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (err) {
    throw new VectorError(err.message);
  }
  if (!names.length) throw new VectorError(`no vector files in ${dir}`);
  const suites = new Map();
  for (const name of names) {
    const path = join(dir, name);
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      throw new VectorError(`${path}: ${err.message}`);
    }
    if (doc.format !== FORMAT || doc.format_version !== FORMAT_VERSION) {
      throw new VectorError(`${path}: not ${FORMAT} version ${FORMAT_VERSION}`);
    }
    if (!isString(doc.suite) || !Array.isArray(doc.cases) || !doc.cases.length) {
      throw new VectorError(`${path}: no suite or no cases`);
    }
    if (suites.has(doc.suite)) throw new VectorError(`${path}: suite ${doc.suite} declared twice`);
    const ids = new Set();
    for (const c of doc.cases) {
      if (!isObject(c) || !["id", "input", "expect"].every((k) => Object.hasOwn(c, k))) {
        throw new VectorError(`${path}: a case lacks id, input or expect`);
      }
      if (ids.has(c.id)) throw new VectorError(`${path}: duplicate case ${c.id}`);
      ids.add(c.id);
    }
    suites.set(doc.suite, doc.cases);
  }
  return suites;
}

export function mismatch(expect, got) {
  for (const [key, value] of Object.entries(expect)) {
    if (key === "error_prefix") {
      if (!String(got.error ?? "").startsWith(value)) {
        return `error ${JSON.stringify(got.error)} does not start with ${JSON.stringify(value)}`;
      }
      continue;
    }
    if (JSON.stringify(got[key]) !== JSON.stringify(value)) {
      return `${key}: want ${JSON.stringify(value)} got ${JSON.stringify(got[key])}`;
    }
  }
  return null;
}

export function run(dir, required = []) {
  const report = {
    format: FORMAT,
    format_version: FORMAT_VERSION,
    implementation: "example-third-party-node",
    vectors_dir: dir,
    suites: {},
    failures: [],
  };
  for (const [suite, cases] of [...load(dir)].sort(([a], [b]) => a.localeCompare(b))) {
    const impl = IMPLEMENTED.get(suite);
    if (!impl) {
      report.suites[suite] = { cases: cases.length, implemented: false };
      continue;
    }
    let failed = 0;
    for (const c of cases) {
      let problem;
      try {
        problem = mismatch(c.expect, impl(c.input));
      } catch (err) {
        problem = err instanceof Unsupported ? `unsupported input: ${err.message}` : `bad input: ${err.message}`;
      }
      if (problem) {
        failed += 1;
        report.failures.push({ suite, id: c.id, error: problem });
      }
    }
    report.suites[suite] = { cases: cases.length, implemented: true, failed };
  }
  report.missing_required = required.filter((s) => !report.suites[s]?.implemented);
  report.vectors_run = Object.values(report.suites)
    .filter((s) => s.implemented)
    .reduce((n, s) => n + s.cases, 0);
  report.failed = report.failures.length;
  return report;
}

function parseArgs(argv) {
  const out = { vectors: DEFAULT_VECTORS, required: [], json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--vectors") out.vectors = resolve(argv[++i] ?? "");
    else if (a === "--require") out.required = String(argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--json") out.json = true;
    else throw new VectorError(`unknown argument ${a}`);
  }
  return out;
}

function main(argv) {
  let args;
  let report;
  try {
    args = parseArgs(argv);
    report = run(args.vectors, args.required);
  } catch (err) {
    if (err instanceof VectorError) {
      console.error(`vectors could not be read: ${err.message}`);
      return 2;
    }
    throw err;
  }
  for (const f of report.failures) console.error(`FAIL ${f.suite}/${f.id}: ${f.error}`);
  for (const [suite, s] of Object.entries(report.suites)) {
    if (s.implemented) console.error(`${s.failed ? "FAIL" : "PASS"} ${suite} ${s.cases} cases`);
    else console.error(`not implemented ${suite} ${s.cases} cases`);
  }
  for (const suite of report.missing_required) console.error(`FAIL required suite ${suite} did not run`);
  console.log(
    args.json
      ? JSON.stringify(report, null, 1)
      : JSON.stringify({ vectors_run: report.vectors_run, failed: report.failed }),
  );
  return report.failed || report.missing_required.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
