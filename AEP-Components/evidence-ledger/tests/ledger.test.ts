import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EvidenceLedger } from "../lib/ledger/ledger.js";
import type { LedgerEntry } from "../lib/ledger/types.js";

const ZERO_HASH = "sha256:" + "0".repeat(64);

function fixedClock(startMs: number, stepMs = 1000): () => Date {
  let t = startMs;
  return () => {
    const d = new Date(t);
    t += stepMs;
    return d;
  };
}

function readLines(path: string): LedgerEntry[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as LedgerEntry);
}

function writeLines(path: string, entries: LedgerEntry[]): void {
  writeFileSync(path, entries.map((e) => JSON.stringify(e) + "\n").join(""), "utf-8");
}

describe("EvidenceLedger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unsafe session ids", () => {
    expect(() => new EvidenceLedger({ dir, sessionId: "../escape" })).toThrow(/invalid sessionId/);
    expect(() => new EvidenceLedger({ dir, sessionId: "a/b" })).toThrow(/invalid sessionId/);
    expect(() => new EvidenceLedger({ dir, sessionId: "" })).toThrow(/invalid sessionId/);
  });

  it("creates the ledger directory when missing", () => {
    const nested = join(dir, "a", "b");
    const ledger = new EvidenceLedger({ dir: nested, sessionId: "s1" });
    ledger.append("session:start", {});
    expect(existsSync(join(nested, "s1.jsonl"))).toBe(true);
  });

  it("appends entries with increasing seq and a linked hash chain", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "s1", clock: fixedClock(Date.UTC(2026, 0, 1)) });
    const a = ledger.append("session:start", { agent: "x" });
    const b = ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    const c = ledger.append("session:terminate", { reason: "done" });

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(a.prev).toBe(ZERO_HASH);
    expect(b.prev).toBe(a.hash);
    expect(c.prev).toBe(b.hash);
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(b.ts).toBe("2026-01-01T00:00:01.000Z");

    // Hash is sha256(prev + type + canonical JSON of data)
    const expected = "sha256:" + createHash("sha256").update(ZERO_HASH + "session:start" + '{"agent":"x"}').digest("hex");
    expect(a.hash).toBe(expected);

    expect(ledger.entries()).toHaveLength(3);
    expect(ledger.verify()).toEqual({ valid: true });
  });

  it("hashes data canonically regardless of key order", () => {
    const l1 = new EvidenceLedger({ dir, sessionId: "k1" });
    const l2 = new EvidenceLedger({ dir, sessionId: "k2" });
    const e1 = l1.append("action:result", { b: 1, a: { y: 2, x: [{ q: 1, p: 2 }] } });
    const e2 = l2.append("action:result", { a: { x: [{ p: 2, q: 1 }], y: 2 }, b: 1 });
    expect(e1.hash).toBe(e2.hash);
  });

  it("includes stateRef, tokens and cost only when provided", () => {
    const state = { counter: 1 };
    const ledger = new EvidenceLedger({ dir, sessionId: "s2", stateProvider: () => state });
    const tokens = { input: 10, output: 5, total: 15 };
    const cost = { input_cost: 0.1, output_cost: 0.2, total_cost: 0.3, currency: "USD" };
    const e = ledger.append("model:call", { model: "m" }, { tokens, cost });
    expect(e.stateRef).toBe("sha256:" + createHash("sha256").update(JSON.stringify(state)).digest("hex"));
    expect(e.tokens).toEqual(tokens);
    expect(e.cost).toEqual(cost);

    const plain = new EvidenceLedger({ dir, sessionId: "s3" }).append("model:call", {});
    expect("stateRef" in plain).toBe(false);
    expect("tokens" in plain).toBe(false);
    expect("cost" in plain).toBe(false);
  });

  it("resumes the chain from an existing file", () => {
    const first = new EvidenceLedger({ dir, sessionId: "resume" });
    first.append("session:start", {});
    const last = first.append("action:evaluate", { n: 1 });

    const second = new EvidenceLedger({ dir, sessionId: "resume" });
    const next = second.append("action:evaluate", { n: 2 });
    expect(next.seq).toBe(3);
    expect(next.prev).toBe(last.hash);
    expect(second.verify()).toEqual({ valid: true });
  });

  it("detects tampered data at the modified entry", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "tamper" });
    ledger.append("session:start", {});
    ledger.append("action:evaluate", { decision: "deny" });
    ledger.append("action:evaluate", { decision: "allow" });

    const path = join(dir, "tamper.jsonl");
    const entries = readLines(path);
    const second = entries[1];
    expect(second).toBeDefined();
    if (second) second.data = { decision: "allow" };
    writeLines(path, entries);

    expect(ledger.verify()).toEqual({ valid: false, brokenAt: 2 });
    expect(ledger.report().chainValid).toBe(false);
  });

  it("detects a removed entry as a broken prev link", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "gap" });
    ledger.append("session:start", {});
    ledger.append("action:evaluate", { n: 1 });
    ledger.append("action:evaluate", { n: 2 });

    const path = join(dir, "gap.jsonl");
    const entries = readLines(path);
    writeLines(path, [entries[0], entries[2]].filter((e): e is LedgerEntry => e !== undefined));
    expect(ledger.verify()).toEqual({ valid: false, brokenAt: 3 });
  });

  it("detects a forged hash even when data is unchanged", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "forged" });
    ledger.append("session:start", {});
    const path = join(dir, "forged.jsonl");
    const entries = readLines(path);
    const only = entries[0];
    if (only) only.hash = "sha256:" + "f".repeat(64);
    writeLines(path, entries);
    expect(ledger.verify()).toEqual({ valid: false, brokenAt: 1 });
  });

  it("skips malformed lines when reading entries", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "bad" });
    ledger.append("session:start", {});
    appendFileSync(join(dir, "bad.jsonl"), "{not json\n", "utf-8");
    expect(ledger.entries()).toHaveLength(1);
  });

  it("treats a missing or empty file as a valid empty ledger", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "empty" });
    expect(ledger.entries()).toEqual([]);
    expect(ledger.verify()).toEqual({ valid: true });
    writeFileSync(join(dir, "empty.jsonl"), "\n\n", "utf-8");
    expect(ledger.entries()).toEqual([]);
    expect(ledger.report()).toEqual({
      sessionId: "empty",
      entryCount: 0,
      timeRange: null,
      actionCounts: {},
      chainValid: true,
    });
  });

  it("reports counts per type and the time range", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "rep", clock: fixedClock(Date.UTC(2026, 5, 1), 60_000) });
    ledger.append("session:start", {});
    ledger.append("action:evaluate", {});
    ledger.append("action:evaluate", {});
    ledger.append("session:terminate", {});
    const report = ledger.report();
    expect(report.entryCount).toBe(4);
    expect(report.actionCounts).toEqual({ "session:start": 1, "action:evaluate": 2, "session:terminate": 1 });
    expect(report.timeRange).toEqual({ first: "2026-06-01T00:00:00.000Z", last: "2026-06-01T00:03:00.000Z" });
    expect(report.chainValid).toBe(true);
  });
});
