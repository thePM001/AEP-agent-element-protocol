#!/usr/bin/env node

import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { latticeDockRequest } from "../../lattice-channels/lib/lattice-transport.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

/**
 * Resolve aep-caw server binary path.
 */
export function resolveCawBinary(env = process.env) {
  if (env.AEP_CAW_BIN && existsSync(env.AEP_CAW_BIN)) return env.AEP_CAW_BIN;
  const candidates = [
    join(REPO_ROOT, "AEP-Components/caw-framework/bin/aep-caw"),
    "/usr/local/bin/aep-caw",
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/**
 * Default CAW server config path under AEP_DATA.
 * @param {string} dataDir
 */
export function cawConfigPath(dataDir) {
  return join(dataDir, "caw-framework", "server-config.yaml");
}

/**
 * Record a CAW audit event on the validation dock lattice channel.
 * @param {string} socketBase
 * @param {object} event
 */
export function recordCawLatticeEvent(socketBase, event, opts = {}) {
  return latticeDockRequest(
    socketBase,
    "validation_engine",
    {
      agent_id: "caw-framework",
      channel_id: "ch-caw-audit",
      contract_id: "dynaep-action-lattice",
      event_type: "CAW_AUDIT_EVENT",
      session_id: event.session_id ?? "caw-session",
      docking_port: "validation_engine",
      trust_score: 750,
      payload: event,
    },
    opts,
  );
}

/**
 * Build Base Node caw_framework config block.
 * @param {object} opts
 */
export function buildCawFrameworkConfig(opts = {}) {
  return {
    enabled: opts.enabled ?? true,
    binary: opts.binary ?? resolveCawBinary(opts.env),
    config_path: opts.config_path,
    policy_name: opts.policy_name ?? "default",
    mount_profile: opts.mount_profile ?? null,
    gap_address: opts.gap_address ?? null,
    compiled_runtime: opts.compiled_runtime ?? false,
    llm_proxy: opts.llm_proxy ?? true,
    server_port: opts.server_port ?? 18080,
    shell_shim: opts.shell_shim ?? true,
    lattice_audit: opts.lattice_audit ?? true,
    mode: opts.mode ?? "enforce",
  };
}