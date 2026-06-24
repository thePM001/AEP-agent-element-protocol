import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KEY_FILE = "ucb-api-key.json";
const RECOVERY_FILE = "ucb-api-key.recovery.txt";

export function buildUcbPublicStatus(dataDir, env = process.env) {
  const fromEnv = String(env.UCB_API_KEY ?? "").trim();
  if (fromEnv) {
    return {
      api_key_source: "env",
      api_key_configured: true,
      key_preview: `${fromEnv.slice(0, 8)}…${fromEnv.slice(-4)}`,
      recovery_available: false,
      recovery_path: null,
      recovery_hint: "UCB_API_KEY is set in environment.",
    };
  }

  const keyPath = join(dataDir, KEY_FILE);
  const recoveryPath = join(dataDir, RECOVERY_FILE);
  let keyPreview = null;
  if (existsSync(keyPath)) {
    try {
      const parsed = JSON.parse(readFileSync(keyPath, "utf8"));
      keyPreview = parsed?.key_preview ?? null;
    } catch {
      keyPreview = null;
    }
  }

  const recoveryAvailable = existsSync(recoveryPath);
  return {
    api_key_source: recoveryAvailable || keyPreview ? "generated" : "pending",
    api_key_configured: Boolean(keyPreview || recoveryAvailable),
    key_preview: keyPreview,
    recovery_available: recoveryAvailable,
    recovery_path: recoveryAvailable ? recoveryPath : null,
    recovery_hint: recoveryAvailable
      ? "docker compose exec aep cat /data/aep/ucb-api-key.recovery.txt"
      : keyPreview
        ? "Recovery file consumed or removed. Set UCB_API_KEY to rotate."
        : "UCB starts after activation. Key is generated on first UCB boot.",
  };
}

export function readUcbRecoveryKey(dataDir) {
  const recoveryPath = join(dataDir, RECOVERY_FILE);
  if (!existsSync(recoveryPath)) return null;
  const raw = readFileSync(recoveryPath, "utf8").trim();
  return raw || null;
}