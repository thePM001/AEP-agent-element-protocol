import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  buildIntentKnotEntry,
  historyIntentKnots,
  INTENT_KNOT_DOMAIN,
  INTENT_KNOT_KIND,
  recordIntentKnot,
  recordIntentKnotDual,
  recordIntentKnotSqlite,
  resolveLatticeDbPath,
  resolveMemoryCliPath,
  searchIntentKnots,
} from "../lib/intent-knots.mjs";
import { deriveEmbedding } from "../lib/embedding.mjs";
import { jsonResponse, openSandbox, PUBLIC_AGENTSTREAM_URL, useDirectFetch } from "./env-guard.mjs";

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
  it("builds a lattice memory entry with the full proposal", () => {
    const knot = buildIntentKnotEntry("solidify", FIELDS);
    expect(knot.id).toMatch(/^ik-solidify-intent-1-\d+$/);
    expect(knot.element_id).toBe("intent-1");
    expect(knot.domain).toBe(INTENT_KNOT_DOMAIN);
    expect(knot.result).toBe("accepted");
    expect(knot.errors).toEqual([]);
    expect(knot.traversal_path).toEqual(["coding_governance:solidify"]);
    expect(knot.metadata).toEqual({
      kind: INTENT_KNOT_KIND,
      phase: "solidify",
      intent_id: "intent-1",
      backends: ["sqlite"],
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

  it("carries an embedding derived from the hashed fields", () => {
    const knot = buildIntentKnotEntry("propose", FIELDS);
    expect(knot.embedding).toHaveLength(128);
    expect(knot.embedding).toEqual(deriveEmbedding(knot));
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
  });

  it("reads top level blast radius components and defaults to an empty list", () => {
    const flat = buildIntentKnotEntry("propose", { intentId: "i", blastRadius: { components: ["x"] } });
    expect(flat.proposal.blast_radius).toEqual({ within_envelope: null, components: ["x"] });
    const bare = buildIntentKnotEntry("propose", { intentId: "i", blastRadius: {} });
    expect(bare.proposal.blast_radius).toEqual({ within_envelope: null, components: [] });
  });
});

describe("resolveMemoryCliPath", () => {
  it("prefers AEP_MEMORY_CLI", () => {
    process.env.AEP_MEMORY_CLI = "/opt/custom/aep-memory";
    expect(resolveMemoryCliPath()).toBe("/opt/custom/aep-memory");
  });

  it("uses the aep-memory next to the configured base node binary when it exists", () => {
    delete process.env.AEP_MEMORY_CLI;
    const binDir = join(box.dir, "bin");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, "aep-memory"), "");
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, JSON.stringify({ base_node: { binary_path: join(binDir, "aep-base-node") } }));
    expect(resolveMemoryCliPath(configPath)).toBe(join(binDir, "aep-memory"));
  });

  it("ignores a corrupt config and still returns an aep-memory path", () => {
    delete process.env.AEP_MEMORY_CLI;
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, "{broken");
    expect(resolveMemoryCliPath(configPath)).toMatch(/aep-memory$/);
  });
});

describe("resolveLatticeDbPath", () => {
  it("prefers AEP_LATTICE_DB and expands the home prefix", () => {
    process.env.AEP_LATTICE_DB = "~/lattice/x.db";
    expect(resolveLatticeDbPath()).toBe(join(homedir(), "lattice/x.db"));
  });

  it("reads base_node.lattice_db from the config file", () => {
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, JSON.stringify({ base_node: { lattice_db: "/srv/lattice.db" } }));
    expect(resolveLatticeDbPath(configPath)).toBe("/srv/lattice.db");
  });

  it("reads the config from dataDir when no config path is given", () => {
    writeFileSync(join(dataDir, "base-node.json"), JSON.stringify({ base_node: { lattice_db: "/srv/d.db" } }));
    expect(resolveLatticeDbPath(undefined, dataDir)).toBe("/srv/d.db");
  });

  it("falls back to the default lattice db under AEP_DATA", () => {
    const configPath = join(box.dir, "base-node.json");
    writeFileSync(configPath, "{broken");
    const expected = join(process.env.AEP_DATA, "action-lattice.db");
    expect(resolveLatticeDbPath(configPath)).toBe(expected);
    expect(resolveLatticeDbPath(join(box.dir, "absent.json"))).toBe(expected);
  });
});

describe("recording without the aep-memory binary", () => {
  it("returns the knot and a not recorded sqlite result", () => {
    const { knot, sqlite } = recordIntentKnotSqlite("propose", FIELDS, { dataDir });
    expect(knot.element_id).toBe("intent-1");
    expect(sqlite).toEqual({
      recorded: false,
      backend: "sqlite",
      error: `aep-memory binary not found: ${process.env.AEP_MEMORY_CLI}`,
    });
  });

  it("honours an explicit memoryCliPath", () => {
    const cli = join(box.dir, "elsewhere", "aep-memory");
    const { sqlite } = recordIntentKnotSqlite("propose", FIELDS, { dataDir, memoryCliPath: cli });
    expect(sqlite.error).toBe(`aep-memory binary not found: ${cli}`);
  });

  it("throws in strict mode", () => {
    process.env.AEP_INTENT_KNOT_STRICT = "1";
    expect(() => recordIntentKnotSqlite("propose", FIELDS, { dataDir })).toThrow(
      /aep-memory binary not found/,
    );
  });

  it("recordIntentKnot schedules nothing when Agentstream is off or unconfigured", () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    const off = recordIntentKnot("propose", FIELDS, { dataDir, mirrorAgentstream: false });
    expect(off.agentstream).toEqual({ scheduled: false });
    expect(off.sqlite.recorded).toBe(false);
    const unconfigured = recordIntentKnot("propose", FIELDS, { dataDir });
    expect(unconfigured.agentstream).toEqual({ scheduled: false });
    expect(calls).toHaveLength(0);
  });

  it("recordIntentKnot schedules the Agentstream mirror when configured", async () => {
    process.env.AGENTSTREAM_URL = PUBLIC_AGENTSTREAM_URL;
    const calls = useDirectFetch(() => jsonResponse(200, { status: "ok" }));
    const out = recordIntentKnot("solidify", FIELDS, { dataDir });
    expect(out.agentstream).toEqual({ scheduled: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].url).toBe(`${PUBLIC_AGENTSTREAM_URL}/api/health`);
    const body = JSON.parse(calls[1].init.body);
    expect(body.type).toBe("intent_knot");
    expect(body.payload).toMatchObject({ intent_id: "intent-1", phase: "solidify", sqlite_key: null });
  });

  it("recordIntentKnotDual reports disabled when the mirror is off", async () => {
    const out = await recordIntentKnotDual("propose", FIELDS, { dataDir, mirrorAgentstream: false });
    expect(out.agentstream).toEqual({ mirrored: false, skipped: true, reason: "disabled" });
    expect(out.knot.metadata.backends).toEqual(["sqlite"]);
  });

  it("recordIntentKnotDual adds the agentstream backend after a mirror", async () => {
    const calls = useDirectFetch(() => jsonResponse(200, {}));
    const out = await recordIntentKnotDual("propose", FIELDS, {
      dataDir,
      agentstreamConfig: { url: PUBLIC_AGENTSTREAM_URL, capsule: "c1", timeoutMs: 2000 },
      probeAgentstream: false,
    });
    expect(out.agentstream).toEqual({ mirrored: true, capsule: "c1", url: PUBLIC_AGENTSTREAM_URL });
    expect(out.knot.metadata.backends).toEqual(["sqlite", "agentstream"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PUBLIC_AGENTSTREAM_URL}/api/evidence/c1`);
  });

  it("recordIntentKnotDual keeps sqlite only when the mirror fails", async () => {
    useDirectFetch(() => jsonResponse(500, {}));
    const out = await recordIntentKnotDual("propose", FIELDS, {
      dataDir,
      agentstreamConfig: { url: PUBLIC_AGENTSTREAM_URL, capsule: "c1", timeoutMs: 2000 },
    });
    expect(out.agentstream).toEqual({ mirrored: false, skipped: true, reason: "http_500" });
    expect(out.knot.metadata.backends).toEqual(["sqlite"]);
  });

  it("recordIntentKnotDual rejects in strict Agentstream mode on a failed append", async () => {
    useDirectFetch(() => jsonResponse(500, {}));
    await expect(
      recordIntentKnotDual("propose", FIELDS, {
        dataDir,
        agentstreamConfig: { url: PUBLIC_AGENTSTREAM_URL, capsule: "c1", timeoutMs: 2000 },
        probeAgentstream: false,
        strictAgentstream: true,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("search and history without the aep-memory binary", () => {
  it("searchIntentKnots returns no matches and names the missing binary", () => {
    expect(searchIntentKnots("intent-1", { dataDir })).toEqual({
      intent_id: "intent-1",
      matches: [],
      error: `aep-memory not found: ${process.env.AEP_MEMORY_CLI}`,
    });
  });

  it("searchIntentKnots refuses an unsafe intent id", () => {
    expect(() => searchIntentKnots("../x", { dataDir })).toThrow(/invalid intent_id/);
  });

  it("historyIntentKnots returns no entries and names the missing binary", () => {
    const cli = join(box.dir, "other", "aep-memory");
    expect(historyIntentKnots("intent-1", { dataDir, memoryCliPath: cli })).toEqual({
      intent_id: "intent-1",
      entries: [],
      error: `aep-memory not found: ${cli}`,
    });
  });
});
