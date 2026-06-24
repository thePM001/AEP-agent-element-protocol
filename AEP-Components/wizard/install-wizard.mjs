#!/usr/bin/env node
/**
 * AEP 2.8 Installation Wizard (Phase 1)
 * Configures Base Node paths, LRPs, EPSCOM priority, lattice channel secret.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  loadLrpCatalog,
  selectLrpsDefault,
  selectLrpsInteractive as selectLrpsFromLib,
} from "./lib/lrp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

function parseArgs(argv) {
  return {
    nonInteractive: argv.includes("--non-interactive"),
    skipHealth: argv.includes("--skip-health"),
    configOut: argv.find((a) => a.startsWith("--config="))?.split("=")[1],
  };
}

function expandHome(p) {
  if (p === "~") return homedir();
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function defaultBinaryPath() {
  const release = join(REPO_ROOT, "rust/target/release/aep-base-node");
  const debug = join(REPO_ROOT, "rust/target/debug/aep-base-node");
  if (existsSync(release)) return release;
  if (existsSync(debug)) return debug;
  return release;
}

function buildBaseNodeBinary() {
  console.log("\nBuilding aep-base-node (release)...");
  execFileSync("cargo", ["build", "--release", "-p", "aep-base-node"], {
    cwd: join(REPO_ROOT, "rust"),
    stdio: "inherit",
  });
  const bin = defaultBinaryPath();
  if (!existsSync(bin)) {
    throw new Error(`Base Node binary not found after build: ${bin}`);
  }
  return bin;
}

async function prompt(rl, question, defaultValue) {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || String(defaultValue ?? "");
}

async function promptYesNo(rl, question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = (await rl.question(`${question} (${hint}): `)).trim().toLowerCase();
  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function writeConfig(path, config) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}

function runHealthCheck(binary, config, configPath) {
  const bn = config.base_node;
  const args = [
    "--config",
    configPath,
    "--socket-base",
    bn.socket_base,
    "--lattice-db",
    bn.lattice_db,
    "--self-test",
  ];
  if (bn.internet_up) args.push("--internet-up");
  if (bn.mesh_peers > 0) {
    args.push("--mesh-peers", String(bn.mesh_peers));
  }
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error("Base Node health check failed");
  }
  const stdout = result.stdout.trim();
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("Base Node did not emit health JSON");
  }
  return JSON.parse(stdout.slice(jsonStart));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const catalog = loadLrpCatalog();

  console.log("AEP 2.8 Installation Wizard");
  console.log("=============================");
  console.log("Biosecurity: Base Node is MANDATORY for all AEP 2.8 installations.\n");

  const rl = opts.nonInteractive ? null : createInterface({ input, output });

  const configDir = expandHome(
    opts.nonInteractive
      ? join(homedir(), ".aep")
      : await prompt(rl, "Config directory", join(homedir(), ".aep")),
  );
  const configPath =
    opts.configOut || join(configDir, "base-node.json");

  const socketBase = opts.nonInteractive
    ? "/tmp/aep-base-node.sock"
    : await prompt(rl, "Base Node socket base", "/tmp/aep-base-node.sock");

  const latticeDb = expandHome(
    opts.nonInteractive
      ? join(homedir(), ".aep/action-lattice.db")
      : await prompt(rl, "Action Lattice SQLite path", join(homedir(), ".aep/action-lattice.db")),
  );

  let binaryPath = defaultBinaryPath();
  if (!existsSync(binaryPath)) {
    if (opts.nonInteractive) {
      binaryPath = buildBaseNodeBinary();
    } else {
      const build = await promptYesNo(rl, "Build aep-base-node now?", true);
      if (build) binaryPath = buildBaseNodeBinary();
      else
        binaryPath = await prompt(
          rl,
          "Path to aep-base-node binary",
          binaryPath,
        );
    }
  }

  const lrps = opts.nonInteractive
    ? selectLrpsDefault(catalog)
    : await selectLrpsFromLib(catalog, rl, promptYesNo);

  const latticeSecret = randomBytes(32).toString("hex");
  const internetUp = opts.nonInteractive
    ? true
    : await promptYesNo(rl, "Normal internet available?", true);

  const config = {
    version: "2.8.0",
    base_node: {
      socket_base: socketBase,
      lattice_db: latticeDb,
      binary_path: binaryPath,
      epscom_priority: catalog.epscom.priority,
      lrps,
      lattice_channel_secret: latticeSecret,
      internet_up: internetUp,
      mesh_peers: 0,
    },
  };

  writeConfig(configPath, config);
  console.log(`\nWrote ${configPath}`);

  const latticeDbParent = dirname(expandHome(latticeDb));
  mkdirSync(latticeDbParent, { recursive: true });

  if (!opts.skipHealth) {
    console.log("\nRunning Base Node health check...");
    const health = runHealthCheck(binaryPath, config, configPath);
    if (health.status !== "ok") {
      throw new Error(`Unexpected health status: ${health.status}`);
    }
    console.log("Health: OK");
    console.log(`Docking ports: ${health.docking_ports.length}`);
    console.log(`Action lattice events: ${health.action_lattice_events}`);
  }

  const envPath = join(configDir, "lattice-channel.env");
  writeFileSync(
    envPath,
    `LATTICE_CHANNEL_SECRET=${latticeSecret}\nAGENTSTREAM_CAPSULE_SECRET=${latticeSecret}\n`,
    { mode: 0o600 },
  );
  try {
    chmodSync(envPath, 0o600);
  } catch {
    /* windows */
  }
  console.log(`Wrote ${envPath} (source before starting agents)`);

  if (rl) rl.close();
  console.log("\nAEP 2.8 wizard complete.");
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});