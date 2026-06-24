#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (
      existsSync(join(dir, "Cargo.toml"))
      && existsSync(join(dir, "AEP-Base-Node"))
      && existsSync(join(dir, "AEP-Subprotocols"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

function resolveBinary() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(join(here, "../../.."));
  const candidates = [
    process.env.AEP_SUBPROTOCOL_BIN,
    "/usr/local/bin/aep-subprotocol",
    "/opt/aep/bin/aep-subprotocol",
    join(repoRoot, "rust/target/release/aep-subprotocol"),
    join(repoRoot, "target/release/aep-subprotocol"),
    join(repoRoot, "rust/target/debug/aep-subprotocol"),
    join(repoRoot, "target/debug/aep-subprotocol"),
    join(process.cwd(), "rust/target/release/aep-subprotocol"),
    join(process.cwd(), "target/release/aep-subprotocol"),
    "aep-subprotocol",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  try {
    const found = execFileSync("command", ["-v", "aep-subprotocol"], {
      encoding: "utf8",
    }).trim();
    if (found) return found.split("\n")[0].trim();
  } catch {
    /* not on PATH */
  }

  return "aep-subprotocol";
}

export function invokeSubprotocolRust(domain, action, payload, extraArgs = []) {
  const bin = resolveBinary();
  const args = [
    domain,
    "--action",
    action,
    "--payload",
    JSON.stringify(payload ?? {}),
    ...extraArgs,
  ];
  try {
    const out = execFileSync(bin, args, { encoding: "utf-8" });
    return JSON.parse(out.trim());
  } catch (err) {
    const stdout = err && typeof err === "object" && "stdout" in err ? String(err.stdout).trim() : "";
    if (stdout) {
      try {
        return JSON.parse(stdout);
      } catch {
        /* fall through */
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Rust ${domain} subprotocol failed (${bin}): ${message}`],
    };
  }
}

export function invokeCodingGovernanceRust(action, payload) {
  return invokeSubprotocolRust("coding-governance", action, payload);
}