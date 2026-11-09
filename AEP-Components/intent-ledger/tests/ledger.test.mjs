import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  appendSolidifyRecord,
  explainIntent,
  hashRecord,
  listIntentSnapshots,
  readChain,
  saveIntentSnapshot,
  verifyChain,
} from "../lib/ledger.mjs";
import { openSandbox } from "./env-guard.mjs";

let box;
let dataDir;

beforeEach(() => {
  box = openSandbox();
  dataDir = join(box.dir, "data");
});

afterEach(() => {
  box.restore();
});

function ledgerFile() {
  return join(dataDir, "intent-provenance.jsonl");
}

function rewriteLedger(mutate) {
  const rows = readFileSync(ledgerFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  mutate(rows);
  writeFileSync(ledgerFile(), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

describe("hashRecord", () => {
  it("is deterministic and ignores an existing record_hash field", () => {
    const rec = { intent_id: "i1", agent_id: "a" };
    const h1 = hashRecord(rec, "");
    const h2 = hashRecord({ ...rec, record_hash: "whatever" }, "");
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toBe(h1);
  });

  it("changes when the previous hash or any field changes", () => {
    const rec = { intent_id: "i1", agent_id: "a" };
    const base = hashRecord(rec, "");
    expect(hashRecord(rec, "abc")).not.toBe(base);
    expect(hashRecord({ ...rec, agent_id: "b" }, "")).not.toBe(base);
  });

  it("binds the prev_hash argument over a prev_hash field in the record", () => {
    const rec = { intent_id: "i1", prev_hash: "field-value" };
    expect(hashRecord(rec, "arg-value")).toBe(hashRecord({ intent_id: "i1" }, "arg-value"));
  });
});

describe("readChain and appendSolidifyRecord", () => {
  it("returns an empty chain when no ledger file exists", () => {
    expect(readChain(dataDir)).toEqual([]);
    expect(verifyChain(dataDir)).toEqual({ valid: true, length: 0 });
  });

  it("appends a genesis record with an empty prev_hash and a valid record_hash", () => {
    const entry = appendSolidifyRecord(dataDir, { intent_id: "intent-1", agent_id: "agent-a" });
    expect(entry.solidify_version).toBe("1");
    expect(entry.prev_hash).toBe("");
    expect(entry.intent_id).toBe("intent-1");
    expect(Number.isNaN(Date.parse(entry.recorded_at))).toBe(false);
    expect(entry.record_hash).toBe(hashRecord(entry, ""));
    expect(readChain(dataDir)).toEqual([entry]);
  });

  it("links each record to the hash of the one before it", () => {
    const a = appendSolidifyRecord(dataDir, { intent_id: "intent-1", step: 1 });
    const b = appendSolidifyRecord(dataDir, { intent_id: "intent-2", step: 2 });
    const c = appendSolidifyRecord(dataDir, { step: 3 });
    expect(b.prev_hash).toBe(a.record_hash);
    expect(c.prev_hash).toBe(b.record_hash);
    expect(readChain(dataDir).map((e) => e.step)).toEqual([1, 2, 3]);
    expect(verifyChain(dataDir)).toEqual({ valid: true, length: 3 });
  });

  it("lets a record override solidify_version but never prev_hash", () => {
    const a = appendSolidifyRecord(dataDir, { step: 1 });
    const b = appendSolidifyRecord(dataDir, { step: 2, solidify_version: "2", prev_hash: "forged" });
    expect(b.solidify_version).toBe("2");
    expect(b.prev_hash).toBe(a.record_hash);
    expect(verifyChain(dataDir).valid).toBe(true);
  });

  it("writes the latest solidify record under the intent snapshot dir", () => {
    const entry = appendSolidifyRecord(dataDir, { intent_id: "intent-1" });
    const latest = JSON.parse(readFileSync(join(dataDir, "intents", "intent-1", "solidify-latest.json"), "utf8"));
    expect(latest).toEqual(entry);
  });

  it("writes no snapshot dir for a record without an intent id", () => {
    appendSolidifyRecord(dataDir, { step: 1 });
    expect(existsSync(join(dataDir, "intents"))).toBe(false);
  });

  it("refuses an unsafe intent id and leaves the chain untouched", () => {
    appendSolidifyRecord(dataDir, { intent_id: "ok-1" });
    expect(() => appendSolidifyRecord(dataDir, { intent_id: "../escape" })).toThrow(/invalid intent_id/);
    expect(() => appendSolidifyRecord(dataDir, { intent_id: "a/b" })).toThrow(/invalid intent_id/);
    expect(readChain(dataDir)).toHaveLength(1);
    expect(verifyChain(dataDir)).toEqual({ valid: true, length: 1 });
  });
});

describe("verifyChain tamper detection", () => {
  beforeEach(() => {
    appendSolidifyRecord(dataDir, { intent_id: "intent-1", decision: "allow" });
    appendSolidifyRecord(dataDir, { intent_id: "intent-1", decision: "allow" });
    appendSolidifyRecord(dataDir, { intent_id: "intent-2", decision: "deny" });
  });

  it("detects an edited field in the middle of the chain", () => {
    rewriteLedger((rows) => {
      rows[1].decision = "deny";
    });
    expect(verifyChain(dataDir)).toEqual({ valid: false, broken_at: 1, length: 3 });
  });

  it("detects an edited genesis record", () => {
    rewriteLedger((rows) => {
      rows[0].intent_id = "intent-x";
    });
    expect(verifyChain(dataDir)).toMatchObject({ valid: false, broken_at: 0 });
  });

  it("detects a replaced record_hash", () => {
    rewriteLedger((rows) => {
      rows[2].record_hash = "0".repeat(64);
    });
    expect(verifyChain(dataDir)).toMatchObject({ valid: false, broken_at: 2 });
  });

  it("detects a removed record even when every remaining hash is self consistent", () => {
    rewriteLedger((rows) => {
      rows.splice(1, 1);
    });
    expect(verifyChain(dataDir)).toEqual({
      valid: false,
      broken_at: 1,
      reason: "prev_hash mismatch",
      length: 2,
    });
  });

  it("detects a resealed record whose prev_hash points elsewhere", () => {
    rewriteLedger((rows) => {
      rows[2].prev_hash = "f".repeat(64);
      rows[2].record_hash = hashRecord(rows[2], rows[2].prev_hash);
    });
    expect(verifyChain(dataDir)).toMatchObject({
      valid: false,
      broken_at: 2,
      reason: "prev_hash mismatch",
    });
  });

  it("detects reordered records", () => {
    rewriteLedger((rows) => {
      const [first, second] = rows;
      rows[0] = second;
      rows[1] = first;
    });
    expect(verifyChain(dataDir)).toMatchObject({ valid: false, broken_at: 0 });
  });
});

describe("snapshots and explainIntent", () => {
  it("saves declaration and blast radius and explains them with the matching chain", () => {
    saveIntentSnapshot(dataDir, "intent-1", { statement: "refactor parser" }, {
      within_envelope: true,
      impact: { components: ["gap", "admit"] },
    });
    const mine = appendSolidifyRecord(dataDir, { intent_id: "intent-1", n: 1 });
    appendSolidifyRecord(dataDir, { intent_id: "intent-2", n: 2 });
    writeFileSync(
      join(dataDir, "intents", "intent-1", "git-refs-propose.json"),
      JSON.stringify({ head: "abc123" }),
    );

    const out = explainIntent(dataDir, "intent-1");
    expect(out.intent_id).toBe("intent-1");
    expect(out.declaration).toEqual({ statement: "refactor parser" });
    expect(out.blast_radius.impact.components).toEqual(["gap", "admit"]);
    expect(out.git_refs_propose).toEqual({ head: "abc123" });
    expect(out.solidify_chain).toEqual([mine]);
  });

  it("returns nulls for an intent without snapshot files", () => {
    const out = explainIntent(dataDir, "unknown-intent");
    expect(out).toEqual({
      intent_id: "unknown-intent",
      declaration: null,
      blast_radius: null,
      git_refs_propose: null,
      solidify_chain: [],
    });
  });

  it("treats a corrupt snapshot file as absent", () => {
    mkdirSync(join(dataDir, "intents", "intent-1"), { recursive: true });
    writeFileSync(join(dataDir, "intents", "intent-1", "intent-declaration.json"), "{not json");
    expect(explainIntent(dataDir, "intent-1").declaration).toBeNull();
  });

  it("refuses an unsafe intent id", () => {
    expect(() => explainIntent(dataDir, "../../etc")).toThrow(/invalid intent_id/);
    expect(() => saveIntentSnapshot(dataDir, "a b", { statement: "x" }, null)).toThrow(/invalid intent_id/);
  });

  it("writes only the parts that are given", () => {
    saveIntentSnapshot(dataDir, "intent-1", null, { impact: { components: ["x"] } });
    const dir = join(dataDir, "intents", "intent-1");
    expect(existsSync(join(dir, "intent-declaration.json"))).toBe(false);
    expect(existsSync(join(dir, "blast-radius.json"))).toBe(true);
  });
});

describe("listIntentSnapshots", () => {
  it("returns an empty list when no intents dir exists", () => {
    expect(listIntentSnapshots(dataDir)).toEqual([]);
  });

  it("lists snapshots newest first with statement and components, honouring the limit", () => {
    saveIntentSnapshot(dataDir, "old", { statement: "old one" }, { impact: { components: ["a"] } });
    saveIntentSnapshot(dataDir, "mid", { statement: "mid one" }, null);
    saveIntentSnapshot(dataDir, "new", null, { impact: { components: ["b", "c"] } });
    const t = Date.now() / 1000;
    utimesSync(join(dataDir, "intents", "old"), t - 300, t - 300);
    utimesSync(join(dataDir, "intents", "mid"), t - 200, t - 200);
    utimesSync(join(dataDir, "intents", "new"), t - 100, t - 100);

    expect(listIntentSnapshots(dataDir)).toEqual([
      { intent_id: "new", statement: null, components: ["b", "c"] },
      { intent_id: "mid", statement: "mid one", components: [] },
      { intent_id: "old", statement: "old one", components: ["a"] },
    ]);
    expect(listIntentSnapshots(dataDir, 1).map((r) => r.intent_id)).toEqual(["new"]);
  });

  it("ignores plain files inside the intents dir", () => {
    saveIntentSnapshot(dataDir, "one", { statement: "s" }, null);
    writeFileSync(join(dataDir, "intents", "stray.txt"), "x");
    expect(listIntentSnapshots(dataDir).map((r) => r.intent_id)).toEqual(["one"]);
  });
});
