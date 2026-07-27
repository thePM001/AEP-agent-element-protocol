import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const JOURNAL_FILE = "ucb-diff-journal.jsonl";

let journalChain = Promise.resolve();

function journalPath(dataDir) {
  return join(dataDir, JOURNAL_FILE);
}

function readEntries(dataDir) {
  const path = journalPath(dataDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function withJournalLock(fn) {
  const run = journalChain.then(() => fn());
  journalChain = run.catch(() => {});
  return run;
}

export function appendDiffRecord(dataDir, record) {
  const path = journalPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  const entry = {
    diff_id: `ucb-diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recorded_at: new Date().toISOString(),
    ...record,
  };
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  return entry;
}

export function listDiffRecords(dataDir, { limit = 50 } = {}) {
  const entries = readEntries(dataDir);
  return entries.slice(-limit);
}

export function peekDiffRecords(dataDir, steps = 1) {
  const entries = readEntries(dataDir);
  const n = Math.max(0, Math.min(steps, entries.length));
  return {
    count: n,
    records: entries.slice(entries.length - n),
    remaining: entries.slice(0, entries.length - n),
  };
}

export function popDiffRecords(dataDir, steps = 1) {
  const entries = readEntries(dataDir);
  const n = Math.max(0, Math.min(steps, entries.length));
  if (n === 0) {
    return { rolled_back: 0, records: [], remaining: entries };
  }
  const remaining = entries.slice(0, entries.length - n);
  const popped = entries.slice(entries.length - n);
  const path = journalPath(dataDir);
  writeFileSync(
    path,
    remaining.length ? `${remaining.map((e) => JSON.stringify(e)).join("\n")}\n` : "",
    { encoding: "utf8", mode: 0o600 },
  );
  return { rolled_back: n, records: popped, remaining };
}