#!/usr/bin/env node

import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expandHome } from "./paths.mjs";
import { assertHyperlatticeBoot } from "../../hyperlattice/lib/hyperlattice.mjs";

function defaultRepoRoot() {
  if (process.env.AEP_REPO_ROOT) return process.env.AEP_REPO_ROOT;
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function writeConfig(path, config, opts = {}) {
  if (opts.validateHyperlattice !== false && config?.policy_sections) {
    const dataDir = opts.dataDir ?? dirname(path);
    assertHyperlatticeBoot(config, opts.repoRoot ?? defaultRepoRoot(), { dataDir });
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}

export function writeLatticeEnv(envPath, secret) {
  writeFileSync(
    envPath,
    `LATTICE_CHANNEL_SECRET=${secret}\nAGENTSTREAM_CAPSULE_SECRET=${secret}\n`,
    { mode: 0o600 },
  );
  try {
    chmodSync(envPath, 0o600);
  } catch {
    /* windows */
  }
}

export function buildBaseNodeConfig({
  socketBase,
  latticeDb,
  binaryPath,
  catalog,
  lrps,
  latticeSecret,
  internetUp,
  meshPeers = 0,
  inferenceEngine = null,
  signaturesPath = null,
}) {
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
      mesh_peers: meshPeers,
    },
    epscom_signatures: {
      enabled: true,
      path: signaturesPath ?? "AEP-Base-Node/signatures",
      trust_bundle: "trust-bundle/manifest.json",
      sync_interval_hours: 24,
    },
  };
  if (inferenceEngine) {
    config.inference_engine = inferenceEngine;
  }
  return config;
}

export function runHealthCheck(binary, config, configPath) {
  const bn = config.base_node;
  const args = [
    "--config",
    configPath,
    "--socket-base",
    bn.socket_base,
    "--lattice-db",
    expandHome(bn.lattice_db),
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
    throw new Error(result.stderr || result.stdout || "Base Node health check failed");
  }
  const stdout = result.stdout.trim();
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("Base Node did not emit health JSON");
  }
  return JSON.parse(stdout.slice(jsonStart));
}