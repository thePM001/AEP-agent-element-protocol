#!/usr/bin/env node
// @ts-check
/**
 * AEP 2.9 Base Node preflight - checks the local daemon, its docks, the
 * registry and the config before an agent session.
 *
 * The self-test proves the kernel can record a lattice frame. The health
 * probe then reports the rollup status and whether the docking ports listen.
 * Every check that cannot run is a failure, so the preflight never passes on
 * a check it did not make.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { validateHyperlatticeOnBoot } from "../AEP-Components/hyperlattice/lib/hyperlattice.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @typedef {object} RunResult
 * @property {number | null} status
 * @property {string} stdout
 * @property {string} stderr
 */

/** @typedef {(bin: string, args: string[]) => RunResult} Runner */

/**
 * @typedef {object} PreflightOptions
 * @property {string} dataDir
 * @property {string} configPath
 * @property {string | null} bin
 * @property {string} repo
 * @property {Runner} run
 */

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} e */
function message(e) {
  return e instanceof Error ? e.message : String(e);
}

/** @param {string} p */
export function expandHome(p) {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function resolveDataDir() {
  return process.env.AEP_DATA || expandHome("~/.aep");
}

/** @param {string} dataDir */
export function resolveConfigPath(dataDir) {
  return process.env.AEP_CONFIG || join(dataDir, "base-node.json");
}

/** @param {string} [repo] */
export function findBaseNodeBin(repo = REPO) {
  const candidates = [
    process.env.AEP_BASE_NODE_BIN,
    join(repo, "rust/target/release/aep-base-node"),
    join(repo, "rust/target/debug/aep-base-node"),
    "/usr/local/bin/aep-base-node",
  ].filter(/** @returns {c is string} */ (c) => typeof c === "string" && c.length > 0);
  return candidates.find((bin) => existsSync(bin)) ?? null;
}

/**
 * The JSON object a program printed last: the first opening brace from which
 * the text up to the last closing brace parses as one object. A log line with
 * a brace before the report does not hide the report.
 * @param {string} stdout
 * @returns {Record<string, unknown> | null}
 */
export function jsonBody(stdout) {
  const end = stdout.lastIndexOf("}");
  for (let start = stdout.indexOf("{"); start >= 0 && start < end; start = stdout.indexOf("{", start + 1)) {
    try {
      /** @type {unknown} */
      const body = JSON.parse(stdout.slice(start, end + 1));
      if (isObject(body)) return body;
    } catch {
      // Not the start of the report: try the next brace.
    }
  }
  return null;
}

/** @type {Runner} */
export function spawnRunner(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? (r.error ? r.error.message : "") };
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Run every check. Returns the failures and the lines to print.
 * @param {PreflightOptions} opts
 * @returns {{ failures: string[], lines: string[] }}
 */
export function preflight(opts) {
  const { dataDir, configPath, bin, repo, run } = opts;
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const lines = ["AEP 2.9 Base Node preflight", "==========================="];

  if (!bin) {
    failures.push("aep-base-node binary not found (build rust or use Docker)");
  } else {
    const selfTest = run(bin, ["--config", configPath, "--self-test"]);
    if (selfTest.status !== 0) {
      failures.push(`AEP-Base-Node self-test failed: ${selfTest.stderr || selfTest.stdout}`);
    } else {
      lines.push("Self-test: ok");
    }

    // --health exits 0 for ok, 1 for degraded and 2 for error, and prints the report.
    const probe = run(bin, ["--config", configPath, "--health"]);
    const body = jsonBody(probe.stdout);
    if (!body) {
      failures.push(`health probe printed no report (exit ${String(probe.status)}): ${probe.stderr}`);
    } else {
      const status = body.status;
      if (status !== "ok" || probe.status !== 0) {
        failures.push(`health status: ${String(status)} (exit ${String(probe.status)})`);
      } else {
        const events = typeof body.action_lattice_events === "number" ? body.action_lattice_events : 0;
        lines.push(`Health: ok (${events} lattice events)`);
      }
      const ports = Array.isArray(body.docking_ports) ? body.docking_ports.length : 0;
      if (body.docking_ports_listening !== true) {
        failures.push("docking ports not listening (run aep-base-node --daemon)");
      } else {
        lines.push(`Docks: ${ports} ports`);
      }
    }
  }

  const catalogPath = join(repo, "AEP-Base-Node/AEP-Registry/catalog.json");
  if (!existsSync(catalogPath)) {
    failures.push("AEP-Base-Node/AEP-Registry/catalog.json missing");
  } else {
    try {
      const catalog = readJson(catalogPath);
      const components = isObject(catalog) && Array.isArray(catalog.components) ? catalog.components : null;
      if (!components) failures.push("registry catalog holds no components list");
      else lines.push(`Registry: ${components.length} components (offline)`);
    } catch (err) {
      failures.push(`registry catalog does not parse: ${message(err)}`);
    }
  }

  if (!existsSync(configPath)) {
    failures.push(`config not found at ${configPath} (run the wizard)`);
  } else {
    try {
      const cfg = readJson(configPath);
      if (!isObject(cfg)) throw new Error("the config is not a JSON object");
      const baseNode = isObject(cfg.base_node) ? cfg.base_node : {};
      const lrps = Array.isArray(baseNode.lrps) ? baseNode.lrps : [];
      lines.push(`Config: ${configPath} (${lrps.length} LRPs)`);
      if (cfg.policy_sections) {
        /** @type {{ valid: boolean, errors: string[], node_counts?: Record<string, number> }} */
        const boot = validateHyperlatticeOnBoot(cfg, repo, { dataDir });
        if (!boot.valid) {
          failures.push(...boot.errors.map((e) => `hyperlattice boot: ${e}`));
        } else {
          lines.push(
            `Hyperlattice: ok (${boot.node_counts?.event ?? 0} event nodes, ${boot.node_counts?.gap_policy ?? 0} GAP nodes)`,
          );
        }
      }
    } catch (err) {
      failures.push(`config check failed: ${message(err)}`);
    }
  }

  const activationPath = join(dataDir, "activation.json");
  if (existsSync(activationPath)) {
    try {
      const act = readJson(activationPath);
      const a = isObject(act) ? act : {};
      lines.push(`Activation: ${String(a.status)} @ ${typeof a.activated_at === "string" ? a.activated_at : "unknown"}`);
    } catch (err) {
      failures.push(`activation record does not parse: ${message(err)}`);
    }
  }

  return { failures, lines };
}

/** @returns {number} */
export function main() {
  const dataDir = resolveDataDir();
  const { failures, lines } = preflight({
    dataDir,
    configPath: resolveConfigPath(dataDir),
    bin: findBaseNodeBin(),
    repo: REPO,
    run: spawnRunner,
  });
  for (const line of lines) console.log(line);
  if (failures.length) {
    console.error("\nFAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log("\nBase Node preflight passed.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
