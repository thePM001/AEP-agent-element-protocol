import { existsSync } from "node:fs";
import { defaultPaths } from "../../wizard/lib/paths.mjs";
import {
  dockPaths,
  latticeHealthPing,
  resolveLatticeLogBin,
} from "../../lattice-channels/lib/lattice-transport.mjs";

export function resolveUcbRuntime(env = process.env) {
  const paths = defaultPaths();
  return {
    dataDir: paths.dataDir,
    configPath: paths.configPath,
    latticeDb: paths.latticeDb,
    socketBase: env.AEP_SOCKET_BASE || paths.socketBase,
    latticeLogBin: resolveLatticeLogBin(env),
    docks: dockPaths(env.AEP_SOCKET_BASE || paths.socketBase),
  };
}

export async function fetchUcbHealth(runtime) {
  const docks = runtime.docks.map((d) => ({
    port: d.port,
    path: d.path,
    listening: existsSync(d.path),
  }));
  const listening = docks.filter((d) => d.listening).length;
  let lattice = { ok: false, error: "validation dock offline" };
  try {
    if (docks.find((d) => d.port === "validation_engine")?.listening) {
      const ping = latticeHealthPing(runtime.socketBase, "validation_engine", {
        agentId: "ucb-bridge",
        sessionId: "ucb-health",
        configPath: runtime.configPath,
      });
      lattice = { ok: true, digest: ping.digest, event_id: ping.event_id };
    }
  } catch (err) {
    lattice = { ok: false, error: err.message };
  }
  return {
    service: "ucb-universal-connect-bridge",
    version: "2.8.0",
    status: listening >= 4 && lattice.ok ? "ok" : "degraded",
    port_policy: "NLA-84xx",
    lattice,
    docking_ports: docks,
    docking_ports_listening: listening >= 4,
  };
}