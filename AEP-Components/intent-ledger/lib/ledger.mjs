#!/usr/bin/env node

import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

function ledgerPath(dataDir) {
  return join(dataDir, "intent-provenance.jsonl");
}

function intentsDir(dataDir, intentId) {
  return join(dataDir, "intents", intentId);
}

export function hashRecord(record, prevHash = "") {
  const { record_hash: _drop, ...rest } = record;
  const body = JSON.stringify({ ...rest, prev_hash: prevHash });
  return createHash("sha256").update(body).digest("hex");
}

export function verifyChain(dataDir) {
  const chain = readChain(dataDir);
  let prevHash = "";
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i];
    const expected = hashRecord(entry, entry.prev_hash ?? prevHash);
    if (entry.record_hash !== expected) {
      return { valid: false, broken_at: i, length: chain.length };
    }
    if (entry.prev_hash !== prevHash) {
      return { valid: false, broken_at: i, reason: "prev_hash mismatch", length: chain.length };
    }
    prevHash = entry.record_hash;
  }
  return { valid: true, length: chain.length };
}

export function readChain(dataDir) {
  const path = ledgerPath(dataDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function appendSolidifyRecord(dataDir, record) {
  mkdirSync(dataDir, { recursive: true });
  const chain = readChain(dataDir);
  const prevHash = chain.length ? chain[chain.length - 1].record_hash : "";
  const entry = {
    solidify_version: "1",
    ...record,
    prev_hash: prevHash,
    recorded_at: new Date().toISOString(),
  };
  entry.record_hash = hashRecord(entry, prevHash);
  appendFileSync(ledgerPath(dataDir), `${JSON.stringify(entry)}\n`, "utf8");

  if (record.intent_id) {
    const dir = intentsDir(dataDir, record.intent_id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "solidify-latest.json"), JSON.stringify(entry, null, 2));
  }

  return entry;
}

export function explainIntent(dataDir, intentId) {
  const chain = readChain(dataDir).filter((e) => e.intent_id === intentId);
  const snapshotDir = intentsDir(dataDir, intentId);
  let declaration = null;
  let blastRadius = null;
  try {
    declaration = JSON.parse(
      readFileSync(join(snapshotDir, "intent-declaration.json"), "utf8"),
    );
  } catch {
    /* optional */
  }
  try {
    blastRadius = JSON.parse(
      readFileSync(join(snapshotDir, "blast-radius.json"), "utf8"),
    );
  } catch {
    /* optional */
  }
  let git_refs_propose = null;
  try {
    git_refs_propose = JSON.parse(
      readFileSync(join(snapshotDir, "git-refs-propose.json"), "utf8"),
    );
  } catch {
    /* optional */
  }
  return {
    intent_id: intentId,
    declaration,
    blast_radius: blastRadius,
    git_refs_propose,
    solidify_chain: chain,
  };
}

export function listIntentSnapshots(dataDir, limit = 20) {
  const root = join(dataDir, "intents");
  if (!existsSync(root)) return [];
  const rows = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const intentId = d.name;
      const dir = join(root, intentId);
      let statement = null;
      let components = [];
      try {
        const decl = JSON.parse(
          readFileSync(join(dir, "intent-declaration.json"), "utf8"),
        );
        statement = decl.statement ?? null;
      } catch {
        /* optional */
      }
      try {
        const blast = JSON.parse(readFileSync(join(dir, "blast-radius.json"), "utf8"));
        components = blast?.impact?.components ?? [];
      } catch {
        /* optional */
      }
      const mtime = statSync(dir).mtimeMs;
      return { intent_id: intentId, statement, components, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);
  return rows.map(({ mtime, ...rest }) => rest);
}

export function saveIntentSnapshot(dataDir, intentId, declaration, blastRadius) {
  const dir = intentsDir(dataDir, intentId);
  mkdirSync(dir, { recursive: true });
  if (declaration) {
    writeFileSync(join(dir, "intent-declaration.json"), JSON.stringify(declaration, null, 2));
  }
  if (blastRadius) {
    writeFileSync(join(dir, "blast-radius.json"), JSON.stringify(blastRadius, null, 2));
  }
}