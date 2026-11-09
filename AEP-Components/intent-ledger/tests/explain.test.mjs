import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { explainIntentRich } from "../lib/explain.mjs";
import { appendSolidifyRecord, saveIntentSnapshot } from "../lib/ledger.mjs";
import { openSandbox } from "./env-guard.mjs";

let box;
let dataDir;

beforeEach(() => {
  box = openSandbox();
  dataDir = join(box.dir, "data");
  mkdirSync(dataDir, { recursive: true });
});

afterEach(() => {
  box.restore();
});

describe("explainIntentRich", () => {
  it("explains an unknown intent with an empty valid chain", () => {
    const out = explainIntentRich(dataDir, "intent-0");
    expect(out.intent_id).toBe("intent-0");
    expect(out.declaration).toBeNull();
    expect(out.solidify_chain).toEqual([]);
    expect(out.topology).toBe("hyperlattice");
    expect(out.provenance).toEqual({ chain_valid: true, chain_length: 0, chain_broken_at: null });
    expect(out.evidence_sessions).toEqual([]);
    expect(out.git).toEqual({ at_propose: null, at_solidify: [] });
  });

  it("joins declaration, chain, git refs and evidence sessions", () => {
    const ledgerDir = join(box.dir, "ledgers");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(
      join(ledgerDir, "sess-1.jsonl"),
      [
        { seq: 1, hash: "h1", type: "action:evaluate", data: { decision: "deny" } },
        { seq: 2, hash: "h2", type: "action:evaluate", data: { decision: "allow" } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    saveIntentSnapshot(dataDir, "intent-1", { statement: "split module" }, {
      impact: { components: ["gap"] },
    });
    writeFileSync(
      join(dataDir, "intents", "intent-1", "git-refs-propose.json"),
      JSON.stringify({ head: "aaa" }),
    );
    appendSolidifyRecord(dataDir, {
      intent_id: "intent-1",
      git_refs: { head: "bbb" },
      evidence_ledger_ref: { session_id: "sess-1", ledger_dir: ledgerDir },
    });
    appendSolidifyRecord(dataDir, { intent_id: "intent-1" });
    appendSolidifyRecord(dataDir, { intent_id: "intent-2", git_refs: { head: "zzz" } });

    const out = explainIntentRich(dataDir, "intent-1");
    expect(out.declaration).toEqual({ statement: "split module" });
    expect(out.solidify_chain).toHaveLength(2);
    expect(out.git).toEqual({ at_propose: { head: "aaa" }, at_solidify: [{ head: "bbb" }] });
    expect(out.provenance).toEqual({ chain_valid: true, chain_length: 3, chain_broken_at: null });
    expect(out.evidence_sessions).toHaveLength(1);
    expect(out.evidence_sessions[0]).toMatchObject({
      session_id: "sess-1",
      found: true,
      entry_count: 2,
      action_evaluate_count: 2,
      action_deny_count: 1,
    });
  });

  it("uses the default ledger dir for a ref without its own dir", () => {
    const ledgerDir = join(box.dir, "explicit-ledgers");
    appendSolidifyRecord(dataDir, { intent_id: "intent-1", evidence_ledger_ref: { session_id: "s9" } });
    const out = explainIntentRich(dataDir, "intent-1", { ledgerDir });
    expect(out.evidence_sessions).toEqual([
      { session_id: "s9", ledger_path: join(ledgerDir, "s9.jsonl"), found: false },
    ]);
  });

  it("reports a broken chain position after tampering", () => {
    appendSolidifyRecord(dataDir, { intent_id: "intent-1", n: 1 });
    appendSolidifyRecord(dataDir, { intent_id: "intent-1", n: 2 });
    const file = join(dataDir, "intent-provenance.jsonl");
    const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    rows[1].n = 99;
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    expect(explainIntentRich(dataDir, "intent-1").provenance).toEqual({
      chain_valid: false,
      chain_length: 2,
      chain_broken_at: 1,
    });
  });

  it("reports intent knots as unavailable without the aep-memory binary", () => {
    const out = explainIntentRich(dataDir, "intent-1");
    expect(out.intent_knots.history).toMatchObject({ intent_id: "intent-1", entries: [] });
    expect(out.intent_knots.history.error).toMatch(/aep-memory not found/);
    expect(out.intent_knots.nearest).toMatchObject({ intent_id: "intent-1", matches: [] });
    expect(out.intent_knots.nearest.error).toMatch(/aep-memory not found/);
  });

  it("summarizes the policy lattice hierarchy and channel bindings", () => {
    const out = explainIntentRich(dataDir, "intent-1");
    const summary = out.policy_lattice_summary;
    expect(summary.hierarchy.length).toBeGreaterThan(0);
    expect(summary.hierarchy[0]).toEqual({ id: "system", label: "SYSTEM", level: 0 });
    expect(summary.hierarchy.map((h) => h.id)).toContain("writing.gap");
    for (const h of summary.hierarchy) {
      expect(Object.keys(h).sort()).toEqual(["id", "label", "level"]);
    }
    expect(Array.isArray(summary.active_lrp_ids)).toBe(true);
    expect(summary.channel_bindings).toBeGreaterThanOrEqual(1);
  });

  it("keeps only known LRP ids from the requested active list", () => {
    const out = explainIntentRich(dataDir, "intent-1", { activeLrps: ["no-such-lrp"] });
    expect(out.policy_lattice_summary.active_lrp_ids).not.toContain("no-such-lrp");
  });
});
