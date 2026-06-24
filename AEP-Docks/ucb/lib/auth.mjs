import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";

const KEY_FILE = "ucb-api-key.json";

function hashKey(key) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function loadOrCreateUcbApiKey(dataDir, env = process.env) {
  const fromEnv = String(env.UCB_API_KEY || "").trim();
  if (fromEnv) {
    return { key: fromEnv, source: "env", persisted: false };
  }

  const path = join(dataDir, KEY_FILE);
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed?.key_hash && parsed?.key_preview) {
        return {
          key: null,
          key_hash: parsed.key_hash,
          key_preview: parsed.key_preview,
          source: "file",
          path,
          persisted: true,
        };
      }
    } catch {
      /* regenerate below */
    }
  }

  const key = `ucb_${randomBytes(24).toString("hex")}`;
  const recoveryPath = join(dataDir, "ucb-api-key.recovery.txt");
  if (!existsSync(recoveryPath)) {
    writeFileSync(recoveryPath, `${key}\n`, { mode: 0o600 });
    try {
      chmodSync(recoveryPath, 0o600);
    } catch {
      /* windows */
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        version: "2.8.0",
        created_at: new Date().toISOString(),
        key_hash: hashKey(key),
        key_preview: `${key.slice(0, 8)}…${key.slice(-4)}`,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
  return { key, source: "generated", path, persisted: true };
}

export function createUcbAuthGuard(dataDir, env = process.env) {
  const material = loadOrCreateUcbApiKey(dataDir, env);
  const keyHash = material.key ? hashKey(material.key) : material.key_hash;

  return {
    material,
    requireAuth(req) {
      const header = String(req.headers.authorization || "").trim();
      const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const apiKey = String(req.headers["x-ucb-api-key"] || bearer || "").trim();
      if (!apiKey) {
        return { ok: false, status: 401, error: "UCB API key required (Authorization: Bearer or X-UCB-API-Key)" };
      }
      if (hashKey(apiKey) !== keyHash) {
        return { ok: false, status: 403, error: "invalid UCB API key" };
      }
      return { ok: true };
    },
  };
}