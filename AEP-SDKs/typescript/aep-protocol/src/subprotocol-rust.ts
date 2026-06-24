// Thin bridge: TypeScript gateway invokes Rust subprotocol CLI (canonical impl in AEP-Subprotocols/*/src).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RustValidationResult {
  valid: boolean;
  errors: string[];
  gate_required?: boolean;
  detail?: Record<string, unknown>;
}

function resolveBinary(): string {
  const candidates = [
    process.env.AEP_SUBPROTOCOL_BIN,
    join(process.cwd(), "rust/target/release/aep-subprotocol"),
    join(process.cwd(), "target/release/aep-subprotocol"),
    join(process.cwd(), "rust/target/debug/aep-subprotocol"),
    join(process.cwd(), "target/debug/aep-subprotocol"),
    "aep-subprotocol",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return "aep-subprotocol";
}

export interface RustSubprotocolResult extends RustValidationResult {
  detail?: Record<string, unknown>;
}

export function invokeSubprotocolRust(
  domain: string,
  action: string,
  payload: unknown,
  extraArgs: string[] = [],
): RustSubprotocolResult {
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
    return JSON.parse(out.trim()) as RustSubprotocolResult;
  } catch (err) {
    const execErr = err as { stdout?: string };
    const stdout = execErr.stdout?.trim() ?? "";
    if (stdout) {
      try {
        return JSON.parse(stdout) as RustSubprotocolResult;
      } catch {
        /* fall through */
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      errors: [`Rust ${domain} subprotocol failed: ${message}`],
    };
  }
}

export function validateCommerceRust(
  action: string,
  payload: unknown,
  policy?: Record<string, unknown>,
  spendDir = ".aep/commerce",
): RustValidationResult {
  const extra = ["--spend-dir", spendDir];
  if (policy) {
    extra.push("--policy", JSON.stringify(policy));
  }
  return invokeSubprotocolRust("commerce", action, payload, extra);
}

export function invokeCodingGovernanceRust(
  action: string,
  payload: unknown,
): RustSubprotocolResult {
  return invokeSubprotocolRust("coding-governance", action, payload);
}