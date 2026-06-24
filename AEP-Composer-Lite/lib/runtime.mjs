import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { defaultPaths } from "../../AEP-Components/wizard/lib/paths.mjs";
import { pingAllDocks } from "../../AEP-Components/wizard/lib/docking.mjs";

export function resolveRuntime() {
  const paths = defaultPaths();
  const configPath = join(paths.dataDir, "base-node.json");
  const activationPath = join(paths.dataDir, "activation.json");
  let config = null;
  let activation = null;

  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      config = null;
    }
  }

  if (existsSync(activationPath)) {
    try {
      activation = JSON.parse(readFileSync(activationPath, "utf8"));
    } catch {
      activation = null;
    }
  }

  const socketBase =
    config?.base_node?.socket_base ?? paths.socketBase;
  const latticeDb =
    config?.base_node?.lattice_db ?? paths.latticeDb;

  return {
    ...paths,
    configPath,
    activationPath,
    config,
    activation,
    socketBase,
    latticeDb,
    wasmSandboxSocket:
      process.env.WASM_SANDBOX_SOCKET || join(socketBase, "wasm_sandbox"),
  };
}

export function fetchHealth(runtime, { selfTest = false } = {}) {
  const binary = runtime.baseNodeBin;
  const args = [];
  if (selfTest) args.push("--self-test");
  if (existsSync(runtime.configPath)) {
    args.push("--config", runtime.configPath);
  }
  args.push("--socket-base", runtime.socketBase);
  args.push("--lattice-db", runtime.latticeDb);
  if (configInternetUp(runtime)) {
    args.push("--internet-up");
  }

  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return {
      status: "error",
      error: (result.stderr || result.stdout || "health check failed").trim(),
    };
  }
  const stdout = result.stdout.trim();
  const jsonStart = stdout.indexOf("{");
  if (jsonStart < 0) {
    return { status: "error", error: "no health JSON from base node" };
  }
  return JSON.parse(stdout.slice(jsonStart));
}

export function fetchDocking(runtime) {
  return pingAllDocks(runtime.socketBase, { configPath: runtime.configPath });
}

export function fetchLatticeEvents(runtime, limit = 50) {
  const args = ["--db", runtime.latticeDb, "export", "--limit", String(limit)];
  if (existsSync(runtime.configPath)) {
    args.unshift("--config", runtime.configPath);
  }
  const result = spawnSync(runtime.latticeLogBin, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return [];
  }
  try {
    const events = JSON.parse(result.stdout.trim());
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

function configInternetUp(runtime) {
  if (runtime.config?.base_node?.internet_up === false) return false;
  return true;
}