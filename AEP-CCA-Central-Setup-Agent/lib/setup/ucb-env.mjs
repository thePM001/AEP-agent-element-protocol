#!/usr/bin/env node
/**
 * UCB 2.8.5 setup notes and env. UCB is an optional attach gateway.
 * It is not a second evaluator. No remote GAP engine URL.
 */

import { writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const UCB_PROTOCOL_VERSION = "2.8.5";
export const UCB_PREDICATE_PROFILE = "perimeter-v1";
export const UCB_OPERATOR_KEY_ENV = "UCB_API_KEY";

export function operatorKeyPresent(env = process.env) {
  return Boolean(String(env.UCB_API_KEY ?? "").trim());
}

export function buildUcbSetupNotes(env = process.env) {
  return {
    version: UCB_PROTOCOL_VERSION,
    predicate_profile: UCB_PREDICATE_PROFILE,
    operator_key_env: UCB_OPERATOR_KEY_ENV,
    operator_key_present: operatorKeyPresent(env),
    attach_gateway: true,
    second_evaluator: false,
    local_gap_compiler: true,
  };
}

export function writeUcbEnv(envPath, env = process.env) {
  const notes = buildUcbSetupNotes(env);
  const lines = [
    `UCB_PREDICATE_PROFILE=${notes.predicate_profile}`,
    `UCB_VERSION=${notes.version}`,
    `UCB_API_KEY_ENV=${notes.operator_key_env}`,
    `UCB_OPERATOR_KEY_PRESENT=${notes.operator_key_present ? "1" : "0"}`,
    "# UCB is an optional attach gateway. It is not a second evaluator.",
    "# Public UCB compiles GAP locally. Do not set a remote GAP engine URL.",
  ];
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(envPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    /* windows */
  }
  return notes;
}
