import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { signalManifestRegistryReload } from "../../../coding-governance/lib/manifest-reload.mjs";

export { signalManifestRegistryReload };

const PIDFILE = process.env.AEP_DAEMON_PIDFILE || "/run/aep/daemon.pid";

/**
 * Write manifest reload stamp and optionally restart the supervised daemon.
 */
export function flushManifestRegistry(dataDir, options = {}, env = process.env) {
  const stamp = signalManifestRegistryReload(dataDir, env);
  if (options.restartDaemon === false) {
    return { ...stamp, daemon: { reloaded: false, reason: "skipped" } };
  }
  const daemon = requestDaemonReload(env);
  return { ...stamp, daemon };
}

/**
 * Signal the supervised Base Node daemon to restart (entrypoint supervises reload).
 */
export function requestDaemonReload(env = process.env) {
  if (env.AEP_IN_DOCKER !== "1") {
    return { reloaded: false, reason: "not-in-docker" };
  }
  if (!existsSync(PIDFILE)) {
    return { reloaded: false, reason: "pidfile-missing" };
  }
  const pid = readFileSync(PIDFILE, "utf8").trim();
  if (!pid) {
    return { reloaded: false, reason: "pidfile-empty" };
  }
  const result = spawnSync("kill", ["-TERM", pid], { encoding: "utf8" });
  return {
    reloaded: result.status === 0,
    reason: result.status === 0 ? "daemon-signaled" : "kill-failed",
    pid,
  };
}