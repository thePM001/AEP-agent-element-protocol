// CC-26: intent knots land in Lattice Memory through the program aep-lattice-memory,
// the one store of the knots. A knot is one record of the domain intent. Recording a
// knot makes no network call.

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  INTENT_KNOT_KIND,
  MEMORY_BACKEND,
  historyIntentKnots,
  recordIntentKnot,
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
    AEP_INTENT_KNOT_STRICT: process.env.AEP_INTENT_KNOT_STRICT,
    AEP_LATTICE_MEMORY_DIR: process.env.AEP_LATTICE_MEMORY_DIR,
  };
  delete process.env.AEP_INTENT_KNOT_STRICT;
  delete process.env.AEP_LATTICE_MEMORY_DIR;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function store() {
  return { dataDir, memoryCliPath: memoryBin(), memoryStore: join(dataDir, "lattice-memory") };
}

/** Knots of one intent in the store, read back through the history of the program. */
function knotCount(opts, intentId = INTENT) {
  const history = historyIntentKnots(intentId, opts);
  if (history.error) throw new Error(history.error);
  return history.entries.length;
}

describe("CC-26 lattice memory intent knots", () => {
  it("CC-26 propose and solidify knots are recorded in the store", () => {
    const opts = store();
    const propose = recordIntentKnot(
      "propose",
      { intentId: INTENT, statement: "conformance knot", agentId: "AG-CONF-26" },
      opts,
    );
    expect(propose.memory).toMatchObject({
      recorded: true,
      backend: MEMORY_BACKEND,
      key: 1,
      store_path: opts.memoryStore,
    });
    expect(propose.knot.metadata).toMatchObject({
      kind: INTENT_KNOT_KIND,
      phase: "propose",
      backends: [MEMORY_BACKEND],
    });
    const solidify = recordIntentKnot(
      "solidify",
      { intentId: INTENT, statement: "conformance knot", solidifyEntry: { record_hash: "rh-conf" } },
      opts,
    );
    expect(solidify.memory).toMatchObject({ recorded: true, key: 2 });
    expect(knotCount(opts)).toBe(2);
    // The store is one folder with one log per domain.
    expect(readdirSync(opts.memoryStore)).toContain("intent.lmlog");
  });

  it("CC-26 history and search find the knots of one intent", () => {
    const opts = store();
    saveIntentSnapshot(dataDir, INTENT, { statement: "conformance knot" }, null);
    recordIntentKnot("propose", { intentId: INTENT, statement: "conformance knot" }, opts);
    recordIntentKnot("solidify", { intentId: INTENT, statement: "conformance knot" }, opts);
    recordIntentKnot("propose", { intentId: "INT-OTHER", statement: "an unrelated piece of work" }, opts);

    const history = historyIntentKnots(INTENT, opts);
    expect(history.error).toBeUndefined();
    expect(history.entries.map((e) => e.metadata.phase)).toEqual(["propose", "solidify"]);
    expect(history.entries.every((e) => e.element_id === INTENT)).toBe(true);
    expect(history.entries.every((e) => e.metadata.kind === INTENT_KNOT_KIND)).toBe(true);
    // The store keeps digests and labels and never the statement of an intent.
    expect(JSON.stringify(history.entries)).not.toContain("conformance knot");

    // The search uses the shape the knots were recorded with, so the knots of the
    // intent are the exact match: both phases met in one attractor.
    const search = searchIntentKnots(INTENT, { ...opts, limit: 10 });
    expect(search.error).toBeUndefined();
    expect(search.matches).toHaveLength(2);
    expect(search.matches[0].similarity).toBe(1);
    expect(search.matches[0].attractor.support).toBe(2);
    expect(search.matches[0].entry.element_id).toBe(INTENT);
    expect(search.matches[0].entry.metadata.phase).toBe("solidify");
    expect(search.matches[1].entry.element_id).toBe("INT-OTHER");
    expect(search.matches[1].similarity).toBeLessThan(0.9);
    // With the threshold of an attractor only the knots of the intent remain.
    const near = searchIntentKnots(INTENT, { ...opts, minScore: 230 });
    expect(near.matches.map((m) => m.entry.element_id)).toEqual([INTENT]);
  });

  it("CC-26 recording a knot makes no network call and the record stands", () => {
    const opts = store();
    const savedFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("no network call expected");
    };
    try {
      const out = recordIntentKnot("propose", { intentId: INTENT, statement: "s" }, opts);
      expect(out.memory.recorded).toBe(true);
      expect(out.knot.metadata.backends).toEqual([MEMORY_BACKEND]);
    } finally {
      globalThis.fetch = savedFetch;
    }
    expect(calls).toHaveLength(0);
    expect(knotCount(opts)).toBe(1);
  });

  it("CC-26 strict mode fails closed when the program is missing", () => {
    process.env.AEP_INTENT_KNOT_STRICT = "1";
    expect(() =>
      recordIntentKnot("propose", { intentId: INTENT }, {
        ...store(),
        memoryCliPath: join(dataDir, "absent-aep-lattice-memory"),
      }),
    ).toThrow(/aep-lattice-memory binary not found/);
  });
});
