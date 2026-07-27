#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * Resolve evidence-ledger directory (gateway session ledgers).
 * @param {string} [dataDir]
 * @param {string} [explicit]
 */
export function resolveEvidenceLedgerDir(dataDir, explicit) {
  if (explicit) return explicit;
  if (process.env.AEP_LEDGER_DIR) return process.env.AEP_LEDGER_DIR;
  if (dataDir) return join(dataDir, "ledgers");
  return "./ledgers";
}

function assertSafeSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error("invalid sessionId for evidence ledger (fail closed)");
  }
}

function readEvidenceEntries(ledgerDir, sessionId) {
  assertSafeSessionId(sessionId);
  const path = join(ledgerDir, `${sessionId}.jsonl`);
  // Contain under ledgerDir (reject absolute/escape after join).
  const resolvedLedger = resolve(ledgerDir);
  const resolvedPath = resolve(path);
  if (
    resolvedPath !== resolvedLedger &&
    !resolvedPath.startsWith(resolvedLedger + sep)
  ) {
    throw new Error("evidence path escapes ledgerDir (fail closed)");
  }
  if (!existsSync(path)) return { path, entries: [] };
  const entries = readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { path, entries };
}

/**
 * Summarize a gateway evidence-ledger session for intent provenance cross-ref.
 */
export function summarizeEvidenceSession(ledgerDir, sessionId) {
  const { path, entries } = readEvidenceEntries(ledgerDir, sessionId);
  if (!entries.length) {
    return { session_id: sessionId, ledger_path: path, found: false };
  }
  const last = entries[entries.length - 1];
  const evaluateCount = entries.filter((e) => e.type === "action:evaluate").length;
  const denyCount = entries.filter(
    (e) => e.type === "action:evaluate" && e.data?.decision === "deny",
  ).length;

  return {
    session_id: sessionId,
    ledger_path: path,
    found: true,
    entry_count: entries.length,
    last_seq: last.seq,
    last_hash: last.hash,
    last_type: last.type,
    last_ts: last.ts,
    action_evaluate_count: evaluateCount,
    action_deny_count: denyCount,
  };
}

/**
 * Build SolidifyRecord.evidence_ledger_ref from a live session file.
 */
export function buildEvidenceLedgerRef(ledgerDir, sessionId) {
  const summary = summarizeEvidenceSession(ledgerDir, sessionId);
  if (!summary.found) {
    throw new Error(`evidence ledger not found for session '${sessionId}' at ${summary.ledger_path}`);
  }
  return {
    session_id: sessionId,
    ledger_dir: ledgerDir,
    last_seq: summary.last_seq,
    last_hash: summary.last_hash,
    entry_count: summary.entry_count,
  };
}