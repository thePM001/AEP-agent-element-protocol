/**
 * Shared paths for the conformance vitest checks. The kernel binaries come from the
 * release build that run.sh makes first. A missing binary fails the check that needs
 * it, so a check never passes by running nothing.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const COMPONENTS = join(REPO_ROOT, "AEP-Components");
export const VECTORS_DIR = join(COMPONENTS, "conformance/vectors/v1");

function releaseDir() {
  return join(process.env.CARGO_TARGET_DIR || join(REPO_ROOT, "rust/target"), "release");
}

/** A kernel binary: the env override when set, else the release build of this tree. */
export function kernelBinary(name, envKey) {
  const path = process.env[envKey] || join(releaseDir(), name);
  if (!existsSync(path)) {
    throw new Error(
      `${name} not found at ${path}: run AEP-Components/conformance/runner/run.sh or set ${envKey}`,
    );
  }
  return path;
}

export const latticeLogBin = () => kernelBinary("aep-lattice-log", "AEP_LATTICE_LOG_BIN");
export const memoryBin = () => kernelBinary("aep-memory", "AEP_MEMORY_CLI");

/**
 * The kernel fixture folder run.sh prepares with the Base Node operator provision
 * step. A check that needs it fails when it is missing.
 */
export function kernelFixtures() {
  const dir = process.env.AEP_CONFORMANCE_FIXTURES;
  // The provision step writes the agent key store the frame builder reads.
  if (!dir || !existsSync(join(dir, "agent-sign-keys.json"))) {
    throw new Error(
      "kernel fixtures missing: run AEP-Components/conformance/runner/run.sh, which provisions them and sets AEP_CONFORMANCE_FIXTURES",
    );
  }
  return dir;
}

/** The public key the provision step printed for one agent. */
export function provisionedPublicHex(dir, agentId) {
  const text = readFileSync(join(dir, `provision-${agentId}.txt`), "utf8");
  const m = /public_hex=([0-9a-f]+)/.exec(text);
  if (!m) throw new Error(`no provisioned key for ${agentId} in ${dir}`);
  return m[1];
}

/** Every vector suite of format version 1, keyed by suite name. */
export function loadVectorSuites(dir = VECTORS_DIR) {
  const suites = {};
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (doc.format !== "aep-conformance-vectors" || doc.format_version !== 1) {
      throw new Error(`${name}: not aep-conformance-vectors version 1`);
    }
    if (doc.normative !== "rust") throw new Error(`${name}: normative is not rust`);
    if (suites[doc.suite]) throw new Error(`${name}: suite ${doc.suite} declared twice`);
    if (!Array.isArray(doc.cases) || !doc.cases.length) throw new Error(`${name}: no cases`);
    suites[doc.suite] = doc;
  }
  return suites;
}
