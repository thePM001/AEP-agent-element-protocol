#!/usr/bin/env node
/**
 * AEP 2.8 Base Node preflight - checks local daemon, docks and registry.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { validateHyperlatticeOnBoot } from "../AEP-Components/hyperlattice/lib/hyperlattice.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..");

function expandHome(p) {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function resolveDataDir() {
  return process.env.AEP_DATA || expandHome("~/.aep");
}

function resolveConfigPath(dataDir) {
  return process.env.AEP_CONFIG || join(dataDir, "base-node.json");
}

function findBaseNodeBin() {
  const candidates = [
    process.env.AEP_BASE_NODE_BIN,
    join(REPO, "rust/target/release/aep-base-node"),
    join(REPO, "rust/target/debug/aep-base-node"),
    "/usr/local/bin/aep-base-node",
  ].filter(Boolean);
  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  return null;
}

function main() {
  const dataDir = resolveDataDir();
  const configPath = resolveConfigPath(dataDir);
  const bin = findBaseNodeBin();
  const failures = [];

  console.log("AEP 2.8 Base Node preflight");
  console.log("===========================");

  if (!bin) {
    failures.push("aep-base-node binary not found (build rust or use Docker)");
  } else {
    const health = spawnSync(
      bin,
      ["--config", configPath, "--self-test"],
      { encoding: "utf8" },
    );
    if (health.status !== 0) {
      failures.push(`AEP-Base-Node self-test failed: ${health.stderr || health.stdout}`);
    } else {
      const jsonStart = (health.stdout || "").indexOf("{");
      if (jsonStart >= 0) {
        const body = JSON.parse(health.stdout.slice(jsonStart));
        if (body.status !== "ok") failures.push(`health status: ${body.status}`);
        else {
          console.log(`Health: ok (${body.action_lattice_events ?? 0} lattice events)`);
          if (body.docking_ports_listening === false) {
            failures.push("docking ports not listening (run aep-base-node --daemon)");
          } else {
            console.log(`Docks: ${(body.docking_ports ?? []).length} ports`);
          }
        }
      }
    }
  }

  const catalogPath = join(REPO, "AEP-Base-Node/registry/catalog.json");
  if (!existsSync(catalogPath)) {
    failures.push("AEP-Base-Node/registry/catalog.json missing");
  } else {
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    console.log(`Registry: ${catalog.components?.length ?? 0} components (offline)`);
  }

  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    const lrps = cfg.base_node?.lrps ?? [];
    console.log(`Config: ${configPath} (${lrps.length} LRPs)`);
    if (cfg.policy_sections) {
      try {
        const boot = validateHyperlatticeOnBoot(cfg, REPO, { dataDir });
        if (!boot.valid) {
          failures.push(...boot.errors.map((e) => `hyperlattice boot: ${e}`));
        } else {
          console.log(
            `Hyperlattice: ok (${boot.node_counts?.event ?? 0} event nodes, ${boot.node_counts?.gap_policy ?? 0} GAP nodes)`,
          );
        }
      } catch (err) {
        failures.push(`hyperlattice boot validation error: ${err.message}`);
      }
    }
  } else {
    console.log(`Config: not found at ${configPath} (run wizard or setup-agent)`);
  }

  const activationPath = join(dataDir, "activation.json");
  if (existsSync(activationPath)) {
    const act = JSON.parse(readFileSync(activationPath, "utf8"));
    console.log(`Activation: ${act.status} @ ${act.activated_at ?? "unknown"}`);
  }

  if (failures.length) {
    console.error("\nFAIL:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nBase Node preflight passed.");
}

main();