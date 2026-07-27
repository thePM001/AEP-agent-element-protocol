import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(__dirname, "run-policy-builder.ts");
const REPO_ROOT = join(__dirname, "..", "..");

export function invokePolicyBuilder(payload, timeoutMs = 45000) {
  const result = spawnSync("npx", ["--yes", "tsx", RUNNER], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.error) {
    return { ok: false, error: result.error.message, stderr };
  }
  if (!stdout) {
    return {
      ok: false,
      error: stderr || `policy builder exited ${result.status ?? "unknown"}`,
      stderr,
    };
  }
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error || "policy builder failed", stderr };
    }
    return { ok: true, result: parsed.result, stderr };
  } catch {
    return { ok: false, error: "invalid JSON from policy builder runner", stderr, stdout };
  }
}