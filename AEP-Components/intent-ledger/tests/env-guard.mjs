// Shared test helpers: an isolated temp dir and an env snapshot that is put back after each test.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TOUCHED_KEYS = [
  "AEP_DATA",
  "AEP_LATTICE_DB",
  "AEP_LEDGER_DIR",
  "AEP_MEMORY_CLI",
  "AEP_AEP_MEMORY_BIN",
  "AEP_INTENT_KNOT_STRICT",
  "AEP_SOCKET_BASE",
  "AEP_LATTICE_STRICT",
  "AEP_LATTICE_STRICT_DEV",
  "AEP_LATTICE_ALLOW_LOOPBACK",
  "AEP_LATTICE_ALLOW_PRIVATE",
  "AGENTSTREAM_URL",
  "AGENTSTREAM_INTENT_KNOTS_CAPSULE",
  "AGENTSTREAM_INTENT_KNOTS_TIMEOUT_MS",
];

/**
 * Start an isolated test context. The returned object holds the temp dir and a
 * restore() that removes the dir, puts every touched env key and fetch back.
 */
export function openSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "aep-"));
  const savedEnv = {};
  for (const key of TOUCHED_KEYS) savedEnv[key] = process.env[key];
  const savedFetch = globalThis.fetch;
  for (const key of TOUCHED_KEYS) delete process.env[key];
  process.env.AEP_DATA = join(dir, "aep-data");
  // A path that never exists keeps every aep-memory call on the no-binary branch.
  process.env.AEP_MEMORY_CLI = join(dir, "missing-bin", "aep-memory");
  return {
    dir,
    restore() {
      for (const key of TOUCHED_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      globalThis.fetch = savedFetch;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Allow latticeGatedFetch to call global fetch directly (dev mode, no dock socket). */
export function useDirectFetch(handler) {
  process.env.AEP_LATTICE_STRICT = "0";
  process.env.AEP_LATTICE_STRICT_DEV = "1";
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return calls;
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A literal public IPv4 host, so the SSRF guard needs no DNS lookup. */
export const PUBLIC_AGENTSTREAM_URL = "http://93.184.216.34";
