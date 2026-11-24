#!/usr/bin/env node
// @ts-check
/**
 * AEP 2.9 harness entry - runs the validator of harness/harness/aep-validate.js
 * with the arguments it was given and exits with its code.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const VALIDATOR = join(dirname(fileURLToPath(import.meta.url)), "harness", "harness", "aep-validate.js");

/**
 * @param {string[]} args
 * @returns {number}
 */
export function run(args) {
  const result = spawnSync(process.execPath, [VALIDATOR, ...args], { stdio: "inherit" });
  // A validator that could not start or died on a signal fails the run.
  return result.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
