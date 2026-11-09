// CC-24: the intent ledger hash chain cross-references a gateway evidence-ledger
// session at solidify and verifies end to end, and tampering breaks the chain.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSolidifyRecord,
  explainIntent,
  hashRecord,
  readChain,
  verifyChain,
} from "../../intent-ledger/lib/ledger.mjs";
import {
  buildEvidenceLedgerRef,
  resolveEvidenceLedgerDir,
  summarizeEvidenceSession,
} from "../../intent-ledger/lib/evidence-link.mjs";

const SESSION = "gw-session-conf-24";
const EVIDENCE = [
  { seq: 1, hash: "h1", type: "session:start", ts: "2026-11-09T10:00:00Z", data: {} },
  { seq: 2, hash: "h2", type: "action:evaluate", ts: "2026-11-09T10:00:01Z", data: { decision: "allow" } },
  { seq: 3, hash: "h3", type: "action:evaluate", ts: "2026-11-09T10:00:02Z", data: { decision: "deny" } },
];

let dataDir;
let ledgerDir;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "aep-cc24-"));
  ledgerDir = resolveEvidenceLedgerDir(dataDir);
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(
    join(ledgerDir, `${SESSION}.jsonl`),
    EVIDENCE.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function solidify(intentId, extra = {}) {
  return appendSolidifyRecord(dataDir, {
    intent_id: intentId,
    statement: `conformance intent ${intentId}`,
    evidence_ledger_ref: buildEvidenceLedgerRef(ledgerDir, SESSION),
    ...extra,
  });
}

function rewriteChain(mutate) {
  const path = join(dataDir, "intent-provenance.jsonl");
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  writeFileSync(path, mutate(lines).map((l) => JSON.stringify(l)).join("\n") + "\n");
}

describe("CC-24 intent ledger solidify evidence-ledger cross-ref and chain verify", () => {
  it("CC-24 the evidence-ledger ref names the last entry of the gateway session", () => {
    const summary = summarizeEvidenceSession(ledgerDir, SESSION);
    expect(summary).toMatchObject({
      found: true,
      entry_count: 3,
      last_seq: 3,
      last_hash: "h3",
      action_evaluate_count: 2,
      action_deny_count: 1,
    });
    expect(buildEvidenceLedgerRef(ledgerDir, SESSION)).toEqual({
      session_id: SESSION,
      ledger_dir: ledgerDir,
      last_seq: 3,
      last_hash: "h3",
      entry_count: 3,
    });
  });

  it("CC-24 solidify records chain by prev_hash and verify the whole chain", () => {
    const first = solidify("INT-CONF-1");
    const second = solidify("INT-CONF-2");
    expect(first.prev_hash).toBe("");
    expect(second.prev_hash).toBe(first.record_hash);
    expect(first.record_hash).toBe(hashRecord(first, ""));
    expect(second.evidence_ledger_ref.last_hash).toBe("h3");
    expect(verifyChain(dataDir)).toEqual({ valid: true, length: 2 });
    const explained = explainIntent(dataDir, "INT-CONF-2");
    expect(explained.solidify_chain).toHaveLength(1);
    expect(explained.solidify_chain[0].evidence_ledger_ref.session_id).toBe(SESSION);
  });

  it("CC-24 an edited evidence-ledger ref breaks the chain at that record", () => {
    solidify("INT-CONF-1");
    solidify("INT-CONF-2");
    rewriteChain((lines) => {
      lines[1].evidence_ledger_ref.last_hash = "forged";
      return lines;
    });
    expect(verifyChain(dataDir)).toMatchObject({ valid: false, broken_at: 1 });
  });

  it("CC-24 a dropped record breaks the chain at the next one", () => {
    solidify("INT-CONF-1");
    solidify("INT-CONF-2");
    solidify("INT-CONF-3");
    rewriteChain((lines) => [lines[0], lines[2]]);
    const result = verifyChain(dataDir);
    expect(result.valid).toBe(false);
    expect(result.broken_at).toBe(1);
    expect(readChain(dataDir)).toHaveLength(2);
  });

  it("CC-24 a missing or unsafe session fails closed", () => {
    expect(() => buildEvidenceLedgerRef(ledgerDir, "gw-session-absent")).toThrow(/not found/);
    expect(() => buildEvidenceLedgerRef(ledgerDir, "../escape")).toThrow(/fail closed/);
    solidify("INT-CONF-1");
    expect(() => appendSolidifyRecord(dataDir, { intent_id: "../escape" })).toThrow(/invalid intent_id/);
    expect(readChain(dataDir)).toHaveLength(1);
    expect(verifyChain(dataDir)).toEqual({ valid: true, length: 1 });
  });
});
