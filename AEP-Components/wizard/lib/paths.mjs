#!/usr/bin/env node
/**
 * Container and host path resolution for AEP 2.8.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export function expandHome(p) {
  if (p === "~") return homedir();
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export function resolveAepData() {
  return process.env.AEP_DATA || join(homedir(), ".aep");
}

export function resolveSocketBase(dataDir) {
  return process.env.AEP_SOCKET_BASE || join(dataDir, "sockets");
}

export function resolveBinary(name = "aep-base-node") {
  const key = `AEP_${name.toUpperCase().replace(/-/g, "_")}_BIN`;
  if (process.env[key]) return process.env[key];
  if (name === "aep-base-node" && process.env.AEP_BASE_NODE_BIN) {
    return process.env.AEP_BASE_NODE_BIN;
  }
  if (name === "aep-lattice-log" && process.env.AEP_LATTICE_LOG_BIN) {
    return process.env.AEP_LATTICE_LOG_BIN;
  }
  if (name === "aep-lattice-log" && process.env.AEP_LATTICE_LOG_CLI) {
    return process.env.AEP_LATTICE_LOG_CLI;
  }
  return `/usr/local/bin/${name}`;
}

export function defaultPaths() {
  const dataDir = resolveAepData();
  return {
    dataDir,
    configPath: join(dataDir, "base-node.json"),
    envPath: join(dataDir, "lattice-channel.env"),
    activationPath: join(dataDir, "activation.json"),
    latticeDb: join(dataDir, "action-lattice.db"),
    socketBase: resolveSocketBase(dataDir),
    baseNodeBin: resolveBinary("aep-base-node"),
    latticeLogBin: resolveBinary("aep-lattice-log"),
    memoryBin: resolveBinary("aep-memory"),
  };
}