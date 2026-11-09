import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatasetManager } from "../lib/manager.js";

describe("DatasetManager", () => {
  let dir: string;
  let mgr: DatasetManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
    mgr = new DatasetManager(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a dataset file at version 1.0.0", () => {
    const ds = mgr.create("smoke", "smoke checks");
    expect(ds).toMatchObject({ name: "smoke", version: "1.0.0", description: "smoke checks", entries: [] });
    expect(existsSync(join(dir, ".aep", "datasets", "smoke.json"))).toBe(true);
    expect(mgr.get("smoke")).toEqual(ds);
  });

  it("refuses duplicates and unknown datasets", () => {
    mgr.create("dup");
    expect(() => mgr.create("dup")).toThrow(/already exists/);
    expect(() => mgr.get("nope")).toThrow(/not found/);
  });

  it("refuses names with path separators", () => {
    expect(() => mgr.create("../escape")).toThrow(/Invalid dataset name/);
    expect(() => mgr.create("a\\b")).toThrow(/Invalid dataset name/);
    expect(() => mgr.create("")).toThrow(/Invalid dataset name/);
    expect(existsSync(join(dir, ".aep", "escape.json"))).toBe(false);
  });

  it("adds entries, bumps the patch version and omits unset optional fields", () => {
    mgr.create("d");
    mgr.addEntry("d", { input: "file:read /a", expectedOutcome: "pass" });
    mgr.addEntry("d", { id: "fixed", input: "file:delete /", expectedOutcome: "fail", category: "file", tags: ["x", "y"] });
    const ds = mgr.get("d");
    expect(ds.version).toBe("1.0.2");
    expect(ds.entries).toHaveLength(2);
    expect(ds.entries[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(ds.entries[0] ?? {}).sort()).toEqual(["expectedOutcome", "id", "input"]);
    expect(ds.entries[1]).toEqual({
      id: "fixed",
      input: "file:delete /",
      expectedOutcome: "fail",
      category: "file",
      tags: ["x", "y"],
    });
  });

  it("removes entries and errors on unknown ids", () => {
    mgr.create("d");
    mgr.addEntry("d", { id: "e1", input: "i", expectedOutcome: "pass" });
    mgr.remove("d", "e1");
    expect(mgr.get("d").entries).toEqual([]);
    expect(() => mgr.remove("d", "e1")).toThrow(/not found/);
  });

  it("imports action:evaluate entries from a ledger with filters", () => {
    mgr.create("prod");
    const ledgerPath = join(dir, "ledger.jsonl");
    const lines = [
      { type: "session:start", data: {} },
      { type: "action:evaluate", data: { tool: "file:read", decision: "allow", actionId: "a1", input: { path: "/x" } } },
      { type: "action:evaluate", data: { tool: "file:delete", decision: "deny", actionId: "a2" } },
      { type: "action:evaluate", data: { tool: "net:fetch", decision: "gate" } },
      { type: "action:evaluate", data: { tool: "file:write" } },
    ];
    writeFileSync(ledgerPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n{broken\n", "utf-8");

    expect(mgr.addFromLedger("prod", ledgerPath, { outcome: "fail", category: "file" })).toBe(1);
    expect(mgr.get("prod").entries).toEqual([
      { id: "a2", input: "file:delete", expectedOutcome: "fail", category: "file" },
    ]);

    expect(mgr.addFromLedger("prod", ledgerPath)).toBe(3);
    const entries = mgr.get("prod").entries;
    expect(entries[1]).toEqual({ id: "a1", input: 'file:read {"path":"/x"}', expectedOutcome: "pass", category: "file" });
    expect(entries[3]?.expectedOutcome).toBe("fail");
    expect(entries[3]?.category).toBe("net");
    expect(mgr.get("prod").version).toBe("1.0.2");
  });

  it("returns zero for an empty ledger and throws for a missing one", () => {
    mgr.create("d");
    const empty = join(dir, "empty.jsonl");
    writeFileSync(empty, "\n", "utf-8");
    expect(mgr.addFromLedger("d", empty)).toBe(0);
    expect(mgr.get("d").version).toBe("1.0.0");
    expect(() => mgr.addFromLedger("d", join(dir, "missing.jsonl"))).toThrow(/Ledger file not found/);
  });

  it("exports JSON and CSV with quoted inputs", () => {
    mgr.create("d");
    mgr.addEntry("d", { id: "e1", input: 'say "hi", ok', expectedOutcome: "pass", category: "chat", tags: ["a", "b"] });
    mgr.addEntry("d", { id: "e2", input: "plain", expectedOutcome: "fail" });
    expect(mgr.export("d", "csv")).toBe(
      ["id,input,expectedOutcome,category,tags", 'e1,"say ""hi"", ok",pass,chat,a;b', 'e2,"plain",fail,,'].join("\n"),
    );
    const parsed = JSON.parse(mgr.export("d", "json")) as { name: string; entries: unknown[] };
    expect(parsed.name).toBe("d");
    expect(parsed.entries).toHaveLength(2);
  });

  it("imports a valid dataset file and validates each entry", () => {
    const good = join(dir, "good.json");
    writeFileSync(
      good,
      JSON.stringify({ name: "imported", entries: [{ id: "1", input: "x", expectedOutcome: "pass" }] }),
      "utf-8",
    );
    const ds = mgr.importFile(good);
    expect(ds.version).toBe("1.0.0");
    expect(ds.description).toBe("");
    expect(mgr.get("imported").entries).toHaveLength(1);

    const cases: Array<[unknown, RegExp]> = [
      [{ entries: [] }, /missing name or entries/],
      [{ name: "n", entries: [null] }, /entries\[0\] must be object/],
      [{ name: "n", entries: [{ input: "x", expectedOutcome: "pass" }] }, /entries\[0\]\.id required/],
      [{ name: "n", entries: [{ id: "1", expectedOutcome: "pass" }] }, /entries\[0\]\.input required/],
      [{ name: "n", entries: [{ id: "1", input: "x", expectedOutcome: "maybe" }] }, /expectedOutcome must be pass\|fail/],
      [{ name: "../evil", entries: [] }, /Invalid dataset name/],
    ];
    for (const [content, err] of cases) {
      const p = join(dir, "case.json");
      writeFileSync(p, JSON.stringify(content), "utf-8");
      expect(() => mgr.importFile(p)).toThrow(err);
    }

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{", "utf-8");
    expect(() => mgr.importFile(broken)).toThrow("Invalid dataset JSON");
    expect(() => mgr.importFile(join(dir, "none.json"))).toThrow(/File not found/);
  });

  it("lists dataset summaries", () => {
    expect(mgr.list()).toEqual([]);
    mgr.create("a", "first");
    mgr.create("b");
    mgr.addEntry("b", { input: "x", expectedOutcome: "pass" });
    const list = mgr.list().sort((x, y) => x.name.localeCompare(y.name));
    expect(list.map((s) => [s.name, s.version, s.entryCount, s.description])).toEqual([
      ["a", "1.0.0", 0, "first"],
      ["b", "1.0.1", 1, ""],
    ]);
  });
});
