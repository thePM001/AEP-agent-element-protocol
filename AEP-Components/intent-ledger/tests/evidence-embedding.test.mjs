import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildEvidenceLedgerRef,
  resolveEvidenceLedgerDir,
  summarizeEvidenceSession,
} from "../lib/evidence-link.mjs";
import { DEFAULT_EMBEDDING_DIM, deriveEmbedding } from "../lib/embedding.mjs";
import { openSandbox } from "./env-guard.mjs";

let box;
let ledgerDir;

beforeEach(() => {
  box = openSandbox();
  ledgerDir = join(box.dir, "ledgers");
  mkdirSync(ledgerDir, { recursive: true });
});

afterEach(() => {
  box.restore();
});

function writeSession(sessionId, entries) {
  writeFileSync(
    join(ledgerDir, `${sessionId}.jsonl`),
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
}

describe("resolveEvidenceLedgerDir", () => {
  it("prefers the explicit dir over env and data dir", () => {
    process.env.AEP_LEDGER_DIR = "/env/ledgers";
    expect(resolveEvidenceLedgerDir("/data", "/explicit")).toBe("/explicit");
  });

  it("uses AEP_LEDGER_DIR when no explicit dir is given", () => {
    process.env.AEP_LEDGER_DIR = "/env/ledgers";
    expect(resolveEvidenceLedgerDir("/data")).toBe("/env/ledgers");
  });

  it("falls back to dataDir/ledgers and then to ./ledgers", () => {
    expect(resolveEvidenceLedgerDir("/data")).toBe(join("/data", "ledgers"));
    expect(resolveEvidenceLedgerDir()).toBe("./ledgers");
    expect(resolveEvidenceLedgerDir("", "")).toBe("./ledgers");
  });
});

describe("summarizeEvidenceSession", () => {
  it("reports found false for a session without a ledger file", () => {
    expect(summarizeEvidenceSession(ledgerDir, "sess-1")).toEqual({
      session_id: "sess-1",
      ledger_path: join(ledgerDir, "sess-1.jsonl"),
      found: false,
    });
  });

  it("reports found false for an empty ledger file", () => {
    writeFileSync(join(ledgerDir, "sess-empty.jsonl"), "\n\n");
    expect(summarizeEvidenceSession(ledgerDir, "sess-empty").found).toBe(false);
  });

  it("summarizes the last entry and counts evaluate and deny events", () => {
    writeSession("sess-1", [
      { seq: 1, hash: "h1", type: "session:open", ts: "t1" },
      { seq: 2, hash: "h2", type: "action:evaluate", ts: "t2", data: { decision: "allow" } },
      { seq: 3, hash: "h3", type: "action:evaluate", ts: "t3", data: { decision: "deny" } },
      { seq: 4, hash: "h4", type: "action:evaluate", ts: "t4" },
      { seq: 5, hash: "h5", type: "action:apply", ts: "t5", data: { decision: "deny" } },
    ]);
    expect(summarizeEvidenceSession(ledgerDir, "sess-1")).toEqual({
      session_id: "sess-1",
      ledger_path: join(ledgerDir, "sess-1.jsonl"),
      found: true,
      entry_count: 5,
      last_seq: 5,
      last_hash: "h5",
      last_type: "action:apply",
      last_ts: "t5",
      action_evaluate_count: 3,
      action_deny_count: 1,
    });
  });

  it("fails closed on session ids that could leave the ledger dir", () => {
    for (const bad of ["../x", "a/b", "", "a b", "..\\x"]) {
      expect(() => summarizeEvidenceSession(ledgerDir, bad)).toThrow(/invalid sessionId/);
    }
    expect(() => summarizeEvidenceSession(ledgerDir, 42)).toThrow(/invalid sessionId/);
  });

  it("keeps a dot only id as a file name inside the ledger dir", () => {
    const out = summarizeEvidenceSession(ledgerDir, "..");
    expect(out.found).toBe(false);
    expect(out.ledger_path).toBe(join(ledgerDir, "...jsonl"));
  });

  it("surfaces corrupt ledger lines as an error", () => {
    writeFileSync(join(ledgerDir, "sess-bad.jsonl"), "{oops\n");
    expect(() => summarizeEvidenceSession(ledgerDir, "sess-bad")).toThrow();
  });
});

describe("buildEvidenceLedgerRef", () => {
  it("builds a solidify ref from a live session", () => {
    writeSession("sess-2", [
      { seq: 10, hash: "a1", type: "action:evaluate" },
      { seq: 11, hash: "a2", type: "action:evaluate" },
    ]);
    expect(buildEvidenceLedgerRef(ledgerDir, "sess-2")).toEqual({
      session_id: "sess-2",
      ledger_dir: ledgerDir,
      last_seq: 11,
      last_hash: "a2",
      entry_count: 2,
    });
  });

  it("throws when the session ledger is missing", () => {
    expect(() => buildEvidenceLedgerRef(ledgerDir, "nope")).toThrow(
      /evidence ledger not found for session 'nope'/,
    );
  });
});

describe("deriveEmbedding", () => {
  const entry = {
    element_id: "intent-1",
    domain: "event",
    proposal: { kind: "intent_knot", statement: "s" },
    result: "accepted",
  };

  function norm(v) {
    return Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
  }

  it("returns a unit vector of the default dimension", () => {
    const v = deriveEmbedding(entry);
    expect(DEFAULT_EMBEDDING_DIM).toBe(128);
    expect(v).toHaveLength(128);
    expect(norm(v)).toBeCloseTo(1, 10);
    for (const x of v) expect(Number.isFinite(x)).toBe(true);
  });

  it("is deterministic and ignores fields outside the hashed set", () => {
    const a = deriveEmbedding(entry);
    const b = deriveEmbedding({ ...entry, id: "other", timestamp: "now", embedding: [1] });
    expect(b).toEqual(a);
  });

  it("changes when a hashed field changes", () => {
    const a = deriveEmbedding(entry);
    expect(deriveEmbedding({ ...entry, element_id: "intent-2" })).not.toEqual(a);
    expect(deriveEmbedding({ ...entry, result: "rejected" })).not.toEqual(a);
    expect(deriveEmbedding({ ...entry, proposal: { kind: "intent_knot", statement: "t" } })).not.toEqual(a);
  });

  it("honours a custom dimension and repeats the seed past 32 bytes", () => {
    const v = deriveEmbedding(entry, 64);
    expect(v).toHaveLength(64);
    expect(norm(v)).toBeCloseTo(1, 10);
    expect(v.slice(32)).toEqual(v.slice(0, 32));
  });

  it("produces the same direction for every dimension prefix", () => {
    const short = deriveEmbedding(entry, 8);
    const long = deriveEmbedding(entry, 32);
    const ratio = short[0] / long[0];
    for (let i = 0; i < 8; i++) {
      expect(short[i] / long[i]).toBeCloseTo(ratio, 10);
    }
  });
});
