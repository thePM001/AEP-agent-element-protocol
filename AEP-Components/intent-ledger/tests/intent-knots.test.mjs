import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildIntentKnotEntry,
  historyIntentKnots,
  intentKnotShape,
  INTENT_KNOT_DOMAIN,
  INTENT_KNOT_KIND,
  MEMORY_BACKEND,
  recordIntentKnot,
  resolveMemoryCliPath,
  resolveMemoryStorePath,
  searchIntentKnots,
} from "../lib/intent-knots.mjs";
import { jsonResponse, openSandbox, useDirectFetch } from "./env-guard.mjs";

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

const FIELDS = {
  intentId: "intent-1",
  agentId: "agent-a",
  statement: "rename the parser module",
  blastRadius: { within_envelope: true, impact: { components: ["gap", "admit"] } },
  proposeToken: { blast_radius_hash: "bh-1" },
  solidifyEntry: { record_hash: "rh-1", evidence_ledger_ref: { session_id: "s1" } },
  taskManifestId: "tm-1",
  threadId: "th-1",
  sessionId: "se-1",
};

describe("buildIntentKnotEntry", () => {
  it("builds a knot of the intent domain with the full proposal", () => {
    const knot = buildIntentKnotEntry("solidify", FIELDS);
    expect(knot.id).toMatch(/^ik-solidify-intent-1-\d+-[0-9a-f]{8}$/);
    expect(knot.element_id).toBe("intent-1");
    expect(knot.domain).toBe(INTENT_KNOT_DOMAIN);
    expect(INTENT_KNOT_DOMAIN).toBe("intent");
    expect(knot.result).toBe("accepted");
    expect(knot.errors).toEqual([]);
    expect(knot.traversal_path).toEqual(["coding_governance:solidify"]);
    expect(knot.metadata).toEqual({
      kind: INTENT_KNOT_KIND,
      phase: "solidify",
      intent_id: "intent-1",
      backends: [MEMORY_BACKEND],
    });
    expect(knot.proposal).toEqual({
      kind: "intent_knot",
      phase: "solidify",
      intent_id: "intent-1",
      statement: "rename the parser module",
      agent_id: "agent-a",
      thread_id: "th-1",
      session_id: "se-1",
      task_manifest_id: "tm-1",
      blast_radius: { within_envelope: true, components: ["gap", "admit"] },
      propose_token_hash: "bh-1",
      solidify_record_hash: "rh-1",
      evidence_ledger_ref: { session_id: "s1" },
    });
    expect(Number.isNaN(Date.parse(knot.timestamp))).toBe(false);
  });

  it("gives two knots of one phase different ids", () => {
    const a = buildIntentKnotEntry("propose", FIELDS);
    const b = buildIntentKnotEntry("propose", FIELDS);
    expect(a.id).not.toBe(b.id);
  });

  it("carries the shape of the intent and no embedding", () => {
    const knot = buildIntentKnotEntry("propose", FIELDS);
    expect(knot.shape).toEqual({
      kind: "intent_knot",
      intent_id: "intent-1",
      statement: "rename the parser module",
      components: ["admit", "gap"],
    });
    expect(knot.embedding).toBeUndefined();
  });

  it("gives every phase of one intent the same shape", () => {
    const propose = buildIntentKnotEntry("propose", FIELDS);
    const solidify = buildIntentKnotEntry("solidify", FIELDS);
    const announce = buildIntentKnotEntry("announce", FIELDS);
    expect(solidify.shape).toEqual(propose.shape);
    expect(announce.shape).toEqual(propose.shape);
  });

  it("fills nulls for missing optional fields", () => {
    const knot = buildIntentKnotEntry("announce", { intentId: "intent-2" });
    expect(knot.proposal).toMatchObject({
      statement: null,
      agent_id: null,
      thread_id: null,
      session_id: null,
      task_manifest_id: null,
      blast_radius: null,
      propose_token_hash: null,
      solidify_record_hash: null,
      evidence_ledger_ref: null,
    });
    expect(knot.shape).toEqual({
      kind: "intent_knot",
      intent_id: "intent-2",
      statement: null,
      components: [],
    });
  });

  it("reads top level blast radius components and defaults to an empty list", () => {
    const flat = buildIntentKnotEntry("propose", { intentId: "i", blastRadius: { components: ["x"] } });
    expect(flat.proposal.blast_radius).toEqual({ within_envelope: null, components: ["x"] });
    expect(flat.shape.components).toEqual(["x"]);
    const bare = buildIntentKnotEntry("propose", { intentId: "i", blastRadius: {} });
    expect(bare.proposal.blast_radius).toEqual({ within_envelope: null, components: [] });
  });
});

describe("intentKnotShape", () => {
  it("does not depend on the order of the components", () => {
    const a = intentKnotShape({ intentId: "i", statement: "s", components: ["b", "a"] });
    const b = intentKnotShape({ intentId: "i", statement: "s", components: ["a", "b"] });
    expect(a).toEqual(b);
  });

  it("leaves the list it was given as it is", () => {
    const components = ["b", "a"];
    intentKnotShape({ intentId: "i", components });
    expect(components).toEqual(["b", "a"]);
  });
});

describe("resolveMemoryCliPath", () => {
  it("prefers AEP_LATTICE_MEMORY_CLI", () => {
    process.env.AEP_LATTICE_MEMORY_CLI = "/opt/custom/aep-lattice-memory";
    expect(resolveMemoryCliPath()).toBe("/opt/custom/aep-lattice-memory");
  });

  it("uses the program next to the configured base node binary when it exists", () => {
    delete process.env.AEP_LATTICE_MEMORY_CLI;
    const binDir = join(box.dir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "aep-lattice-memory"), "");
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, JSON.stringify({ base_node: { binary_path: join(binDir, "aep-base-node") } }));
    expect(resolveMemoryCliPath(configPath)).toBe(join(binDir, "aep-lattice-memory"));
  });

  it("ignores a corrupt config and still returns a path of the program", () => {
    delete process.env.AEP_LATTICE_MEMORY_CLI;
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, "{broken");
    expect(resolveMemoryCliPath(configPath)).toMatch(/aep-lattice-memory$/);
  });
});

describe("resolveMemoryStorePath", () => {
  it("prefers AEP_LATTICE_MEMORY_DIR and expands the home prefix", () => {
    process.env.AEP_LATTICE_MEMORY_DIR = "~/lattice/memory";
    expect(resolveMemoryStorePath()).toBe(join(homedir(), "lattice/memory"));
  });

  it("is the folder beside the ledger file of the config", () => {
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, JSON.stringify({ base_node: { lattice_db: "/srv/aep/lattice.db" } }));
    expect(resolveMemoryStorePath(configPath)).toBe("/srv/aep/lattice-memory");
  });

  it("reads the config from dataDir when no config path is given", () => {
    writeFileSync(join(dataDir, "base-node.json"), JSON.stringify({ base_node: { lattice_db: "/srv/d/d.db" } }));
    expect(resolveMemoryStorePath(undefined, dataDir)).toBe("/srv/d/lattice-memory");
  });

  it("falls back to the folder under the data folder", () => {
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, "{broken");
    const expected = join(process.env.AEP_DATA, "lattice-memory");
    expect(resolveMemoryStorePath(configPath)).toBe(expected);
    expect(resolveMemoryStorePath(join(box.dir, "absent.json"))).toBe(expected);
    expect(resolveMemoryStorePath(undefined, dataDir)).toBe(join(dataDir, "lattice-memory"));
  });
});

describe("recording without the memory program", () => {
  it("returns the knot and a not recorded result", () => {
    const { knot, memory } = recordIntentKnot("propose", FIELDS, { dataDir });
    expect(knot.element_id).toBe("intent-1");
    expect(memory).toEqual({
      recorded: false,
      backend: MEMORY_BACKEND,
      error: `aep-lattice-memory binary not found: ${process.env.AEP_LATTICE_MEMORY_CLI}`,
    });
  });

  it("honours an explicit memoryCliPath", () => {
    const cli = join(box.dir, "elsewhere", "aep-lattice-memory");
    const { memory } = recordIntentKnot("propose", FIELDS, { dataDir, memoryCliPath: cli });
    expect(memory.error).toBe(`aep-lattice-memory binary not found: ${cli}`);
  });

  it("throws in strict mode", () => {
    process.env.AEP_INTENT_KNOT_STRICT = "1";
    expect(() => recordIntentKnot("propose", FIELDS, { dataDir })).toThrow(
      /aep-lattice-memory binary not found/,
    );
  });

  it("recordIntentKnot makes no network call", () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    const out = recordIntentKnot("propose", FIELDS, { dataDir });
    expect(Object.keys(out).sort()).toEqual(["knot", "memory"]);
    expect(out.memory.recorded).toBe(false);
    expect(out.knot.metadata.backends).toEqual([MEMORY_BACKEND]);
    expect(calls).toHaveLength(0);
  });
});

describe("search and history without the memory program", () => {
  it("searchIntentKnots returns no matches and names the missing program", () => {
    expect(searchIntentKnots("intent-1", { dataDir })).toEqual({
      intent_id: "intent-1",
      matches: [],
      error: `aep-lattice-memory not found: ${process.env.AEP_LATTICE_MEMORY_CLI}`,
    });
  });

  it("searchIntentKnots refuses an unsafe intent id", () => {
    expect(() => searchIntentKnots("../x", { dataDir })).toThrow(/invalid intent_id/);
  });

  it("historyIntentKnots returns no entries and names the missing program", () => {
    const cli = join(box.dir, "other", "aep-lattice-memory");
    expect(historyIntentKnots("intent-1", { dataDir, memoryCliPath: cli })).toEqual({
      intent_id: "intent-1",
      entries: [],
      error: `aep-lattice-memory not found: ${cli}`,
    });
  });
});
