// CC-26: intent knots land in Lattice Memory (aep-memory: SQLite with sqlite-vec and
// the USearch fast path) as the canonical store, and the Agentstream mirror is
// optional: an absent or offline mirror never blocks the canonical record.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INTENT_KNOT_KIND,
  historyIntentKnots,
  recordIntentKnotDual,
  recordIntentKnotSqlite,
  searchIntentKnots,
} from "../../intent-ledger/lib/intent-knots.mjs";
import { saveIntentSnapshot } from "../../intent-ledger/lib/ledger.mjs";
import { memoryBin } from "./support/paths.mjs";

const INTENT = "INT-CONF-26";
let dataDir;
let saved;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "aep-cc26-"));
  saved = {
    AGENTSTREAM_URL: process.env.AGENTSTREAM_URL,
    AEP_INTENT_KNOT_STRICT: process.env.AEP_INTENT_KNOT_STRICT,
    AEP_LATTICE_DB: process.env.AEP_LATTICE_DB,
  };
  delete process.env.AGENTSTREAM_URL;
  delete process.env.AEP_INTENT_KNOT_STRICT;
  delete process.env.AEP_LATTICE_DB;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function store() {
  return { dataDir, memoryCliPath: memoryBin(), latticeDb: join(dataDir, "action-lattice.db") };
}

/** Knots of one intent in the canonical store, read back through aep-memory history. */
function knotCount(opts, intentId = INTENT) {
  const history = historyIntentKnots(intentId, opts);
  if (history.error) throw new Error(history.error);
  return history.entries.length;
}

describe("CC-26 lattice memory intent knots, sqlite-vec plus USearch canonical, optional Agentstream mirror", () => {
  it("CC-26 propose and solidify knots are recorded in the canonical store", () => {
    const opts = store();
    const propose = recordIntentKnotSqlite(
      "propose",
      { intentId: INTENT, statement: "conformance knot", agentId: "AG-CONF-26" },
      opts,
    );
    expect(propose.sqlite).toMatchObject({ recorded: true, backend: "sqlite", db_path: opts.latticeDb });
    expect(propose.knot.metadata).toMatchObject({ kind: INTENT_KNOT_KIND, phase: "propose", backends: ["sqlite"] });
    expect(propose.knot.embedding.length).toBeGreaterThan(0);
    const solidify = recordIntentKnotSqlite(
      "solidify",
      { intentId: INTENT, solidifyEntry: { record_hash: "rh-conf" } },
      opts,
    );
    expect(solidify.sqlite.recorded).toBe(true);
    expect(knotCount(opts)).toBe(2);
  });

  it("CC-26 history and similarity search find the knots of one intent", () => {
    const opts = store();
    saveIntentSnapshot(dataDir, INTENT, { statement: "conformance knot" }, null);
    recordIntentKnotSqlite("propose", { intentId: INTENT, statement: "conformance knot" }, opts);
    recordIntentKnotSqlite("solidify", { intentId: INTENT }, opts);
    recordIntentKnotSqlite("propose", { intentId: "INT-OTHER", statement: "unrelated" }, opts);

    const history = historyIntentKnots(INTENT, opts);
    expect(history.error).toBeUndefined();
    expect(history.entries.map((e) => e.metadata?.phase ?? e.proposal?.phase).sort()).toEqual([
      "propose",
      "solidify",
    ]);
    expect(history.entries.every((e) => e.element_id === INTENT)).toBe(true);

    const search = searchIntentKnots(INTENT, { ...opts, limit: 10 });
    expect(search.error).toBeUndefined();
    expect(search.matches.length).toBeGreaterThan(0);
    expect(search.matches.some((m) => m.entry?.element_id === INTENT)).toBe(true);
  });

  it("CC-26 no Agentstream configured: the mirror is skipped and the canonical record stands", async () => {
    const opts = store();
    const out = await recordIntentKnotDual("propose", { intentId: INTENT, statement: "s" }, opts);
    expect(out.sqlite.recorded).toBe(true);
    expect(out.agentstream).toMatchObject({ mirrored: false, skipped: true, reason: "agentstream_unconfigured" });
    expect(out.knot.metadata.backends).toEqual(["sqlite"]);
  });

  it("CC-26 an offline Agentstream never blocks the canonical record", async () => {
    const opts = store();
    const out = await recordIntentKnotDual(
      "propose",
      { intentId: INTENT, statement: "s" },
      {
        ...opts,
        socketBase: join(dataDir, "no-sockets"),
        agentstreamConfig: { url: "http://127.0.0.1:9", capsule: "aep-intent-knots", timeoutMs: 500 },
      },
    );
    expect(out.sqlite.recorded).toBe(true);
    expect(out.agentstream.mirrored).toBe(false);
    expect(out.knot.metadata.backends).toEqual(["sqlite"]);
    expect(knotCount(opts)).toBe(1);
  });

  it("CC-26 strict mode fails closed when the canonical store is missing", () => {
    process.env.AEP_INTENT_KNOT_STRICT = "1";
    expect(() =>
      recordIntentKnotSqlite("propose", { intentId: INTENT }, {
        ...store(),
        memoryCliPath: join(dataDir, "absent-aep-memory"),
      }),
    ).toThrow(/aep-memory binary not found/);
  });
});
