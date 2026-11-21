#!/usr/bin/env node

/**
 * Intent knots in Lattice Memory.
 *
 * A knot is one record of the domain `intent`, written through the program
 * `aep-lattice-memory`. The program computes the shape digest and the fingerprint of
 * a knot from its shape, so recording and searching use one and the same shape.
 *
 * The file ledger (intent-provenance.jsonl) remains the source of truth. Knots make
 * past intents searchable. Lattice Memory keeps the digest, the fingerprint and the
 * labels of a knot and never its statement.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { explainIntent } from "./ledger.mjs";
import { expandHome, defaultPaths } from "../../platform-core/lib/paths.mjs";

/** Intent knots are provenance, not judged proposals, so they have a domain of their own. */
export const INTENT_KNOT_DOMAIN = "intent";
export const INTENT_KNOT_KIND = "intent_knot";
export const MEMORY_PROGRAM = "aep-lattice-memory";
export const MEMORY_BACKEND = "lattice-memory";
/** Folder of the memory under the data folder of the node. */
export const MEMORY_STORE_DIR = "lattice-memory";

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

export function resolveMemoryCliPath(configPath) {
  if (process.env.AEP_LATTICE_MEMORY_CLI) return process.env.AEP_LATTICE_MEMORY_CLI;
  const root = repoRoot();
  const candidates = [
    join(root, "rust/target/release", MEMORY_PROGRAM),
    join(root, "rust/target/debug", MEMORY_PROGRAM),
    defaultPaths().memoryBin,
  ];
  if (configPath && existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      const bin = cfg.base_node?.binary_path;
      if (bin) candidates.unshift(join(dirname(bin), MEMORY_PROGRAM));
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * The folder of the memory: AEP_LATTICE_MEMORY_DIR, else the folder `lattice-memory`
 * beside the ledger file the node is configured with, else under the data folder.
 * The Base Node writes its records to the same folder.
 */
export function resolveMemoryStorePath(configPath, dataDir) {
  if (process.env.AEP_LATTICE_MEMORY_DIR) return expandHome(process.env.AEP_LATTICE_MEMORY_DIR);
  const base = expandHome(dataDir ?? defaultPaths().dataDir);
  const path = configPath ?? join(base, "base-node.json");
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      if (cfg.base_node?.lattice_db) {
        return join(dirname(expandHome(cfg.base_node.lattice_db)), MEMORY_STORE_DIR);
      }
    } catch {
      /* ignore */
    }
  }
  return join(base, MEMORY_STORE_DIR);
}

function runMemoryCli(cli, storePath, command, input) {
  const args = ["--store", storePath, command];
  const result = spawnSync(cli, args, {
    input: input ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        result.error?.message ||
        `${MEMORY_PROGRAM} ${command} failed`,
    );
  }
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) return null;
  return JSON.parse(stdout);
}

/**
 * One store of Lattice Memory as a function: a command name and its request go in,
 * the answer of the program comes out. A command that fails throws. Other components
 * hand this function on, such as the checkpoint store of the Graph Engine, so this
 * module is the one place in the JavaScript tree that runs the memory program.
 */
export function memoryProgram(cli, storePath) {
  return (command, input) => runMemoryCli(cli, storePath, command, input);
}

function isStrict() {
  return process.env.AEP_INTENT_KNOT_STRICT === "1";
}

/**
 * The shape of the knots of one intent: what the intent is about. Every phase of an
 * intent has this shape, and a search for an intent uses it too, so the knots of one
 * intent meet in one attractor and a search finds what was recorded.
 */
export function intentKnotShape({ intentId, statement, components }) {
  return {
    kind: INTENT_KNOT_KIND,
    intent_id: intentId,
    statement: statement ?? null,
    components: [...(components ?? [])].sort(),
  };
}

/**
 * Build the knot of an intent governance phase.
 * @param {"propose"|"solidify"|"announce"} phase
 */
export function buildIntentKnotEntry(phase, {
  intentId,
  agentId,
  statement,
  blastRadius,
  proposeToken,
  solidifyEntry,
  taskManifestId,
  threadId,
  sessionId,
}) {
  const components = blastRadius?.impact?.components ?? blastRadius?.components ?? [];
  const proposal = {
    kind: INTENT_KNOT_KIND,
    phase,
    intent_id: intentId,
    statement: statement ?? null,
    agent_id: agentId ?? null,
    thread_id: threadId ?? null,
    session_id: sessionId ?? null,
    task_manifest_id: taskManifestId ?? null,
    blast_radius: blastRadius
      ? {
          within_envelope: blastRadius.within_envelope ?? null,
          components,
        }
      : null,
    propose_token_hash: proposeToken?.blast_radius_hash ?? null,
    solidify_record_hash: solidifyEntry?.record_hash ?? null,
    evidence_ledger_ref: solidifyEntry?.evidence_ledger_ref ?? null,
  };

  return {
    id: `ik-${phase}-${intentId}-${Date.now()}-${randomBytes(4).toString("hex")}`,
    timestamp: new Date().toISOString(),
    element_id: intentId,
    domain: INTENT_KNOT_DOMAIN,
    proposal,
    result: "accepted",
    errors: [],
    traversal_path: [`coding_governance:${phase}`],
    shape: intentKnotShape({ intentId, statement, components }),
    metadata: {
      kind: INTENT_KNOT_KIND,
      phase,
      intent_id: intentId,
      backends: [MEMORY_BACKEND],
    },
  };
}

/** What the program stores of a knot: its ids, its shape and its labels. */
function memoryRecord(knot) {
  return {
    id: knot.id,
    timestamp: knot.timestamp,
    element_id: knot.element_id,
    domain: knot.domain,
    result: knot.result,
    shape: knot.shape,
    labels: {
      kind: INTENT_KNOT_KIND,
      phase: String(knot.metadata.phase),
      intent_id: String(knot.metadata.intent_id),
    },
  };
}

/** A stored record as the callers of this module read a knot. */
function knotEntry(record) {
  return { ...record, metadata: record.labels ?? {} };
}

function recordMemoryKnot(knot, opts = {}) {
  const configPath = opts.configPath ?? join(expandHome(opts.dataDir ?? defaultPaths().dataDir), "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const storePath = opts.memoryStore ?? resolveMemoryStorePath(configPath, opts.dataDir);
  if (!existsSync(cli)) {
    const err = new Error(`${MEMORY_PROGRAM} binary not found: ${cli}`);
    if (isStrict()) throw err;
    return { recorded: false, backend: MEMORY_BACKEND, error: err.message };
  }
  try {
    const res = runMemoryCli(cli, storePath, "record", memoryRecord(knot));
    return { recorded: true, backend: MEMORY_BACKEND, key: res?.key ?? null, store_path: storePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isStrict()) throw err;
    return { recorded: false, backend: MEMORY_BACKEND, error: message };
  }
}

/** Record the knot of one phase in Lattice Memory. Makes no network call. */
export function recordIntentKnot(phase, fields, opts = {}) {
  const knot = buildIntentKnotEntry(phase, fields);
  const memory = recordMemoryKnot(knot, opts);
  return { knot, memory };
}

/**
 * Search Lattice Memory for the knots nearest to an intent. The search uses the shape
 * the knots of the intent were recorded with.
 */
export function searchIntentKnots(intentId, opts = {}) {
  const dataDir = expandHome(opts.dataDir ?? defaultPaths().dataDir);
  const intent = explainIntent(dataDir, intentId);
  const shape = intentKnotShape({
    intentId,
    statement: intent.declaration?.statement ?? null,
    components: intent.blast_radius?.impact?.components ?? intent.blast_radius?.components ?? [],
  });

  const configPath = opts.configPath ?? join(dataDir, "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const storePath = opts.memoryStore ?? resolveMemoryStorePath(configPath, dataDir);
  if (!existsSync(cli)) {
    return { intent_id: intentId, matches: [], error: `${MEMORY_PROGRAM} not found: ${cli}` };
  }

  const request = { domain: INTENT_KNOT_DOMAIN, shape, limit: opts.limit ?? 5 };
  if (opts.minScore !== undefined) request.min_score = opts.minScore;
  try {
    const matches = runMemoryCli(cli, storePath, "search", request);
    return {
      intent_id: intentId,
      store_path: storePath,
      matches: (matches ?? []).map((m) => ({
        ...m,
        entry: m.entry ? knotEntry(m.entry) : null,
      })),
      backends: { [MEMORY_BACKEND]: true },
    };
  } catch (err) {
    return {
      intent_id: intentId,
      matches: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The knots of one intent in the order they were recorded.
 */
export function historyIntentKnots(intentId, opts = {}) {
  const dataDir = expandHome(opts.dataDir ?? defaultPaths().dataDir);
  const configPath = opts.configPath ?? join(dataDir, "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const storePath = opts.memoryStore ?? resolveMemoryStorePath(configPath, dataDir);
  if (!existsSync(cli)) {
    return { intent_id: intentId, entries: [], error: `${MEMORY_PROGRAM} not found: ${cli}` };
  }
  try {
    const request = { domain: INTENT_KNOT_DOMAIN, element_id: intentId };
    if (opts.result) request.result = opts.result;
    const entries = runMemoryCli(cli, storePath, "history", request);
    return {
      intent_id: intentId,
      store_path: storePath,
      entries: (entries ?? []).map(knotEntry),
    };
  } catch (err) {
    return {
      intent_id: intentId,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
