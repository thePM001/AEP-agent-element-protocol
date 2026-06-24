#!/usr/bin/env node

/**
 * Lattice Memory intent knots: dual-backend storage.
 * - Canonical: Lattice Memory via aep-memory CLI (SQLite 3.46.0 bundled + sqlite-vec 0.1.9 vec0 + USearch 2.25.3)
 * - Optional: Agentstream mirror (NLA paid connector)
 *
 * File ledger (intent-provenance.jsonl) remains source of truth; knots are searchable attractors.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { deriveEmbedding } from "./embedding.mjs";
import { explainIntent } from "./ledger.mjs";
import { expandHome, defaultPaths } from "../../wizard/lib/paths.mjs";
import {
  mirrorIntentKnotToAgentstream,
  resolveAgentstreamKnotConfig,
} from "./agentstream-knots.mjs";

export const INTENT_KNOT_DOMAIN = "event";
export const INTENT_KNOT_KIND = "intent_knot";

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../..");
}

export function resolveMemoryCliPath(configPath) {
  if (process.env.AEP_MEMORY_CLI) return process.env.AEP_MEMORY_CLI;
  const root = repoRoot();
  const candidates = [
    join(root, "rust/target/release/aep-memory"),
    join(root, "rust/target/debug/aep-memory"),
    defaultPaths().memoryBin,
  ];
  if (configPath && existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      const bin = cfg.base_node?.binary_path;
      if (bin) candidates.unshift(join(dirname(bin), "aep-memory"));
    } catch {
      /* ignore */
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function resolveLatticeDbPath(configPath, dataDir) {
  if (process.env.AEP_LATTICE_DB) return expandHome(process.env.AEP_LATTICE_DB);
  const path = configPath ?? join(expandHome(dataDir ?? defaultPaths().dataDir), "base-node.json");
  if (existsSync(path)) {
    try {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      if (cfg.base_node?.lattice_db) return expandHome(cfg.base_node.lattice_db);
    } catch {
      /* ignore */
    }
  }
  return expandHome(defaultPaths().latticeDb);
}

function runMemoryCli(cli, dbPath, command, input) {
  const args = ["--db", dbPath, command];
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
        `aep-memory ${command} failed`,
    );
  }
  const stdout = (result.stdout ?? "").trim();
  if (!stdout) return null;
  return JSON.parse(stdout);
}

function isStrict() {
  return process.env.AEP_INTENT_KNOT_STRICT === "1";
}

/**
 * Build a lattice memory entry for an intent governance phase.
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
          components: blastRadius?.impact?.components ?? blastRadius?.components ?? [],
        }
      : null,
    propose_token_hash: proposeToken?.blast_radius_hash ?? null,
    solidify_record_hash: solidifyEntry?.record_hash ?? null,
    evidence_ledger_ref: solidifyEntry?.evidence_ledger_ref ?? null,
  };

  const memoryEntry = {
    id: `ik-${phase}-${intentId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    element_id: intentId,
    domain: INTENT_KNOT_DOMAIN,
    proposal,
    result: "accepted",
    errors: [],
    traversal_path: [`coding_governance:${phase}`],
    metadata: {
      kind: INTENT_KNOT_KIND,
      phase,
      intent_id: intentId,
      backends: ["sqlite"],
    },
  };
  memoryEntry.embedding = deriveEmbedding(memoryEntry);
  return memoryEntry;
}

function recordSqliteKnot(memoryEntry, opts = {}) {
  const configPath = opts.configPath ?? join(expandHome(opts.dataDir ?? defaultPaths().dataDir), "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const dbPath = opts.latticeDb ?? resolveLatticeDbPath(configPath, opts.dataDir);
  if (!existsSync(cli)) {
    const err = new Error(`aep-memory binary not found: ${cli}`);
    if (isStrict()) throw err;
    return { recorded: false, backend: "sqlite", error: err.message };
  }
  try {
    const res = runMemoryCli(cli, dbPath, "record", memoryEntry);
    return { recorded: true, backend: "sqlite", key: res?.key ?? null, db_path: dbPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isStrict()) throw err;
    return { recorded: false, backend: "sqlite", error: message };
  }
}

/** Record knot to SQLite only (sync, canonical open-source path). */
export function recordIntentKnotSqlite(phase, fields, opts = {}) {
  const knot = buildIntentKnotEntry(phase, fields);
  const sqlite = recordSqliteKnot(knot, opts);
  return { knot, sqlite };
}

function scheduleAgentstreamMirror(knot, fields, phase, sqlite, opts = {}) {
  if (opts.mirrorAgentstream === false) return;
  const mirrorPayload = {
    ...knot,
    intent_id: fields.intentId,
    phase,
    sqlite_key: sqlite.key ?? null,
  };
  void mirrorIntentKnotToAgentstream(mirrorPayload, {
    config: opts.agentstreamConfig ?? resolveAgentstreamKnotConfig(),
    socketBase: opts.socketBase,
    strict: opts.strictAgentstream ?? false,
    probe: opts.probeAgentstream !== false,
  }).catch(() => {
    /* optional mirror; sqlite is canonical */
  });
}

/**
 * Record intent knot to SQLite (sync) and schedule optional Agentstream mirror.
 */
export function recordIntentKnot(phase, fields, opts = {}) {
  const { knot, sqlite } = recordIntentKnotSqlite(phase, fields, opts);
  scheduleAgentstreamMirror(knot, fields, phase, sqlite, opts);
  return {
    knot,
    sqlite,
    agentstream: {
      scheduled: opts.mirrorAgentstream !== false && Boolean(resolveAgentstreamKnotConfig()?.url),
    },
  };
}

/**
 * Record intent knot to SQLite and await Agentstream mirror (CLI / tests).
 * @returns {Promise<{ knot: object, sqlite: object, agentstream: object }>}
 */
export async function recordIntentKnotDual(phase, fields, opts = {}) {
  const { knot, sqlite } = recordIntentKnotSqlite(phase, fields, opts);

  let agentstream = { mirrored: false, skipped: true, reason: "disabled" };
  if (opts.mirrorAgentstream !== false) {
    const mirrorPayload = {
      ...knot,
      intent_id: fields.intentId,
      phase,
      sqlite_key: sqlite.key ?? null,
    };
    agentstream = await mirrorIntentKnotToAgentstream(mirrorPayload, {
      config: opts.agentstreamConfig ?? resolveAgentstreamKnotConfig(),
      socketBase: opts.socketBase,
      strict: opts.strictAgentstream ?? false,
      probe: opts.probeAgentstream !== false,
    });
  }

  if (agentstream.mirrored) {
    knot.metadata.backends = ["sqlite", "agentstream"];
  }

  return { knot, sqlite, agentstream };
}

/**
 * Search lattice memory for knots related to an intent (by embedding similarity).
 */
export function searchIntentKnots(intentId, opts = {}) {
  const dataDir = expandHome(opts.dataDir ?? defaultPaths().dataDir);
  const intent = explainIntent(dataDir, intentId);
  const statement = intent.declaration?.statement ?? intentId;
  const embedding = deriveEmbedding({
    element_id: intentId,
    domain: INTENT_KNOT_DOMAIN,
    proposal: {
      kind: INTENT_KNOT_KIND,
      intent_id: intentId,
      statement,
      blast_radius: intent.blast_radius
        ? { components: intent.blast_radius?.impact?.components ?? [] }
        : null,
    },
    result: "accepted",
  });

  const configPath = opts.configPath ?? join(dataDir, "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const dbPath = opts.latticeDb ?? resolveLatticeDbPath(configPath, dataDir);
  if (!existsSync(cli)) {
    return { intent_id: intentId, matches: [], error: `aep-memory not found: ${cli}` };
  }

  const limit = opts.limit ?? 5;
  const threshold = opts.threshold ?? 0.0;
  try {
    const matches = runMemoryCli(cli, dbPath, "search", {
      embedding,
      limit,
      threshold,
      accepted_only: false,
    });
    const filtered = (matches ?? []).filter((m) => {
      const p = m.entry?.proposal ?? m.entry?.metadata;
      const kind = m.entry?.proposal?.kind ?? m.entry?.metadata?.kind;
      const el = m.entry?.element_id;
      return kind === INTENT_KNOT_KIND || el === intentId;
    });
    return {
      intent_id: intentId,
      db_path: dbPath,
      matches: filtered,
      backends: { sqlite: true, agentstream: Boolean(resolveAgentstreamKnotConfig()) },
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
 * History of intent knots for an element_id (= intent_id).
 */
export function historyIntentKnots(intentId, opts = {}) {
  const dataDir = expandHome(opts.dataDir ?? defaultPaths().dataDir);
  const configPath = opts.configPath ?? join(dataDir, "base-node.json");
  const cli = opts.memoryCliPath ?? resolveMemoryCliPath(configPath);
  const dbPath = opts.latticeDb ?? resolveLatticeDbPath(configPath, dataDir);
  if (!existsSync(cli)) {
    return { intent_id: intentId, entries: [], error: `aep-memory not found: ${cli}` };
  }
  try {
    const entries = runMemoryCli(cli, dbPath, "history", {
      element_id: intentId,
      result: opts.result ?? null,
    });
    const filtered = (entries ?? []).filter((e) => {
      const kind = e.proposal?.kind ?? e.metadata?.kind;
      return kind === INTENT_KNOT_KIND || e.element_id === intentId;
    });
    return { intent_id: intentId, db_path: dbPath, entries: filtered };
  } catch (err) {
    return {
      intent_id: intentId,
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

