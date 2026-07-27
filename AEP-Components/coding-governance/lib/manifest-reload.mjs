import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function manifestDir(dataDir, env = process.env) {
  if (env.AEP_TASK_MANIFEST_DIR) return env.AEP_TASK_MANIFEST_DIR;
  return join(String(dataDir).replace(/\/$/, ""), "ucb", "manifests");
}

/** Bump manifest reload stamp so Base Node invalidates its manifest cache immediately. */
export function signalManifestRegistryReload(dataDir, env = process.env) {
  const dir = manifestDir(dataDir, env);
  mkdirSync(dir, { recursive: true });
  const stamp = join(dir, ".reload-stamp");
  writeFileSync(stamp, `${Date.now()}\n`, "utf8");
  return { stamp, dir };
}