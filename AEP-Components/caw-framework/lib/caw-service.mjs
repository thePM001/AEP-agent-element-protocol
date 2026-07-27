#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
  resolveCawBinary,
  cawConfigPath,
  buildCawFrameworkConfig,
} from "./lattice-bridge.mjs";
import { materializeCawRuntimeFromGap } from "../../gap/lib/gap-compile.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

/**
 * Materialize CAW config under AEP_DATA from GAP reference policies + bundled defaults.
 * @param {string} dataDir
 * @param {string} [repoRoot]
 */
export function ensureCawConfig(dataDir, repoRoot = REPO_ROOT) {
  const { configPath } = materializeCawRuntimeFromGap(dataDir, repoRoot);
  return configPath;
}

/**
 * Probe host enforcement primitives via aep-caw detect.
 * @param {object} [env]
 */
export function probeCawHost(env = process.env) {
  const bin = resolveCawBinary(env);
  if (!existsSync(bin)) {
    return { ok: false, error: `aep-caw binary not found: ${bin}` };
  }
  const result = spawnSync(bin, ["detect"], {
    encoding: "utf8",
    env: { ...env, AEP_CAW_NO_AUTO: "1" },
    timeout: 15000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: result.stderr?.trim() || result.error?.message || "aep-caw detect failed",
      stdout: result.stdout,
    };
  }
  const lines = (result.stdout ?? "").trim().split("\n");
  const scoreLine = lines.find((l) => l.includes("Protection Score"));
  return {
    ok: true,
    detect: {
      platform: lines.find((l) => l.startsWith("Platform:"))?.split(":").slice(1).join(":").trim(),
      security_mode: lines.find((l) => l.startsWith("Security Mode:"))?.split(":").slice(1).join(":").trim(),
      protection_score: scoreLine?.split(":").slice(1).join(":").trim(),
      raw: result.stdout,
    },
  };
}

/**
 * Start CAW server (non-blocking check: returns spawn result).
 * @param {string} dataDir
 * @param {object} [env]
 */
export function startCawServer(dataDir, env = process.env) {
  const bin = resolveCawBinary(env);
  const config = ensureCawConfig(dataDir);
  if (!existsSync(bin)) {
    return { started: false, error: `missing binary: ${bin}` };
  }
  const child = spawn(bin, ["server", "--config", config], {
    detached: true,
    stdio: "ignore",
    env: { ...env, AEP_CAW_CONFIG: config, AEP_CAW_NO_AUTO: "0" },
  });
  child.unref();
  return {
    started: true,
    pid: child.pid,
    config,
    binary: bin,
  };
}

/**
 * Build plan-time CAW component config.
 */
export function cawPlanDefaults(dataDir, env = process.env) {
  const config_path = cawConfigPath(dataDir);
  return buildCawFrameworkConfig({
    env,
    config_path,
    enabled: true,
  });
}