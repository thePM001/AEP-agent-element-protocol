import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatasetManager } from "../../src/datasets/manager.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-datasets"
);

describe("DatasetManager", () => {
  let manager: DatasetManager;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    manager = new DatasetManager(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a dataset", () => {
    const dataset = manager.create("test-ds", "A test dataset");
    expect(dataset.name).toBe("test-ds");
    expect(dataset.version).toBe("1.0.0");
    expect(dataset.description).toBe("A test dataset");
    expect(dataset.entries).toHaveLength(0);
    expect(dataset.created).toBeDefined();
    expect(dataset.updated).toBeDefined();
  });

  it("add entries", () => {
    manager.create("add-test");
    manager.addEntry("add-test", {
      input: "file:read src/a.ts",
      expectedOutcome: "pass",
      category: "file",
      tags: ["read"],
    });

    const dataset = manager.get("add-test");
    expect(dataset.entries).toHaveLength(1);
    expect(dataset.entries[0].input).toBe("file:read src/a.ts");
    expect(dataset.entries[0].expectedOutcome).toBe("pass");
    expect(dataset.entries[0].category).toBe("file");
    expect(dataset.entries[0].tags).toEqual(["read"]);
    expect(dataset.entries[0].id).toBeDefined();
  });

  it("imports from ledger (allowed becomes pass, denied becomes fail)", () => {
    manager.create("ledger-test");

    // Create a mock ledger file
    const ledgerDir = join(TEST_DIR, "ledgers");
    if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    const ledgerPath = join(ledgerDir, "test-session.jsonl");

    const entries = [
      {
        seq: 1,
        ts: "2026-01-01T00:00:00.000Z",
        hash: "sha256:abc",
        prev: "sha256:000",
        type: "session:start",
        data: { sessionId: "test" },
      },
      {
        seq: 2,
        ts: "2026-01-01T00:00:01.000Z",
        hash: "sha256:def",
        prev: "sha256:abc",
        type: "action:evaluate",
        data: {
          actionId: "act-1",
          tool: "file:read",
          decision: "allow",
          reasons: ["Allowed"],
          input: { path: "src/a.ts" },
        },
      },
      {
        seq: 3,
        ts: "2026-01-01T00:00:02.000Z",
        hash: "sha256:ghi",
        prev: "sha256:def",
        type: "action:evaluate",
        data: {
          actionId: "act-2",
          tool: "file:read",
          decision: "deny",
          reasons: ["Forbidden"],
          input: { path: ".env" },
        },
      },
      {
        seq: 4,
        ts: "2026-01-01T00:00:03.000Z",
        hash: "sha256:jkl",
        prev: "sha256:ghi",
        type: "action:result",
        data: { actionId: "act-1", success: true },
      },
    ];

    writeFileSync(ledgerPath, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    const added = manager.addFromLedger("ledger-test", ledgerPath);
    expect(added).toBe(2);

    const dataset = manager.get("ledger-test");
    expect(dataset.entries).toHaveLength(2);

    const passEntry = dataset.entries.find(e => e.expectedOutcome === "pass");
    const failEntry = dataset.entries.find(e => e.expectedOutcome === "fail");
    expect(passEntry).toBeDefined();
    expect(failEntry).toBeDefined();
    expect(passEntry!.id).toBe("act-1");
    expect(failEntry!.id).toBe("act-2");
  });

  it("exports json format", () => {
    manager.create("export-test", "Export dataset");
    manager.addEntry("export-test", {
      input: "test input",
      expectedOutcome: "pass",
    });

    const json = manager.export("export-test", "json");
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("export-test");
    expect(parsed.entries).toHaveLength(1);
  });

  it("exports csv format", () => {
    manager.create("csv-test");
    manager.addEntry("csv-test", {
      input: "file:read src/a.ts",
      expectedOutcome: "pass",
      category: "file",
      tags: ["read", "source"],
    });

    const csv = manager.export("csv-test", "csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe("id,input,expectedOutcome,category,tags");
    expect(lines[1]).toContain("pass");
    expect(lines[1]).toContain("file");
    expect(lines[1]).toContain("read;source");
  });

  it("version bumps on modification", () => {
    manager.create("version-test");
    expect(manager.get("version-test").version).toBe("1.0.0");

    manager.addEntry("version-test", {
      input: "first",
      expectedOutcome: "pass",
    });
    expect(manager.get("version-test").version).toBe("1.0.1");

    manager.addEntry("version-test", {
      input: "second",
      expectedOutcome: "fail",
    });
    expect(manager.get("version-test").version).toBe("1.0.2");
  });

  it("list shows all datasets", () => {
    manager.create("ds-a", "Dataset A");
    manager.create("ds-b", "Dataset B");

    const list = manager.list();
    expect(list.length).toBeGreaterThanOrEqual(2);

    const names = list.map(d => d.name);
    expect(names).toContain("ds-a");
    expect(names).toContain("ds-b");

    const dsA = list.find(d => d.name === "ds-a")!;
    expect(dsA.description).toBe("Dataset A");
    expect(dsA.entryCount).toBe(0);
  });

  it("remove entry", () => {
    manager.create("remove-test");
    manager.addEntry("remove-test", {
      id: "entry-to-remove",
      input: "test",
      expectedOutcome: "pass",
    });
    manager.addEntry("remove-test", {
      id: "entry-to-keep",
      input: "keep",
      expectedOutcome: "fail",
    });

    expect(manager.get("remove-test").entries).toHaveLength(2);

    manager.remove("remove-test", "entry-to-remove");
    const dataset = manager.get("remove-test");
    expect(dataset.entries).toHaveLength(1);
    expect(dataset.entries[0].id).toBe("entry-to-keep");
  });

  it("import from file works", () => {
    const importPath = join(TEST_DIR, "import-source.json");
    const importData = {
      name: "imported",
      version: "2.0.0",
      description: "Imported dataset",
      entries: [
        { id: "i1", input: "test", expectedOutcome: "pass" },
        { id: "i2", input: "bad", expectedOutcome: "fail" },
      ],
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
    };
    writeFileSync(importPath, JSON.stringify(importData), "utf-8");

    const dataset = manager.importFile(importPath);
    expect(dataset.name).toBe("imported");
    expect(dataset.entries).toHaveLength(2);

    // Verify it was saved
    const loaded = manager.get("imported");
    expect(loaded.name).toBe("imported");
    expect(loaded.entries).toHaveLength(2);
  });

  it("import from ledger with filter", () => {
    manager.create("filter-test");

    const ledgerDir = join(TEST_DIR, "filter-ledgers");
    if (!existsSync(ledgerDir)) mkdirSync(ledgerDir, { recursive: true });
    const ledgerPath = join(ledgerDir, "filter.jsonl");

    const entries = [
      {
        seq: 1, ts: "2026-01-01T00:00:00Z", hash: "sha256:a", prev: "sha256:0",
        type: "action:evaluate",
        data: { actionId: "a1", tool: "file:read", decision: "allow", input: {} },
      },
      {
        seq: 2, ts: "2026-01-01T00:00:01Z", hash: "sha256:b", prev: "sha256:a",
        type: "action:evaluate",
        data: { actionId: "a2", tool: "file:write", decision: "deny", input: {} },
      },
      {
        seq: 3, ts: "2026-01-01T00:00:02Z", hash: "sha256:c", prev: "sha256:b",
        type: "action:evaluate",
        data: { actionId: "a3", tool: "aep:create_element", decision: "allow", input: {} },
      },
    ];

    writeFileSync(ledgerPath, entries.map(e => JSON.stringify(e)).join("\n") + "\n", "utf-8");

    // Filter only denied entries
    const added = manager.addFromLedger("filter-test", ledgerPath, { outcome: "fail" });
    expect(added).toBe(1);

    const dataset = manager.get("filter-test");
    expect(dataset.entries).toHaveLength(1);
    expect(dataset.entries[0].expectedOutcome).toBe("fail");
  });
});
