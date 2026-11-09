import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RollbackManager } from "../lib/rollback/manager.js";
import { EvidenceLedger } from "../lib/ledger/ledger.js";
import type { CompensationPlan } from "../lib/rollback/types.js";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

describe("RollbackManager.buildAEPCompensation", () => {
  it("create_element compensates with delete_element", () => {
    const input = { id: "EL-1", label: "x" };
    const plan = RollbackManager.buildAEPCompensation("a1", "aep:create_element", input);
    expect(plan.compensationAction).toEqual({ tool: "aep:delete_element", input: { id: "EL-1" } });
    expect(plan.backup.path).toBe("aep:element:EL-1");
    expect(plan.backup.content).toBe(JSON.stringify(input));
    expect(plan.backup.snapshotHash).toBe(sha(JSON.stringify(input)));
    expect(plan.originalInput).toBe(input);
  });

  it("delete_element restores previous state, or the input when none is given", () => {
    const prev = { id: "EL-2", label: "old" };
    const withPrev = RollbackManager.buildAEPCompensation("a2", "aep:delete_element", { id: "EL-2" }, prev);
    expect(withPrev.compensationAction).toEqual({ tool: "aep:create_element", input: prev });
    expect(withPrev.backup.content).toBe(JSON.stringify(prev));

    const noPrev = RollbackManager.buildAEPCompensation("a3", "aep:delete_element", { id: "EL-2" });
    expect(noPrev.compensationAction).toEqual({ tool: "aep:create_element", input: { id: "EL-2" } });
  });

  it("update tools compensate only when previous state is known", () => {
    for (const [tool, path] of [
      ["aep:update_element", "aep:element:E"],
      ["aep:update_skin", "aep:skin"],
      ["aep:update_registry", "aep:registry"],
    ] as const) {
      const prev = { id: "E", v: 1 };
      const withPrev = RollbackManager.buildAEPCompensation("x", tool, { id: "E", v: 2 }, prev);
      expect(withPrev.compensationAction).toEqual({ tool, input: prev });
      expect(withPrev.backup.path).toBe(path);

      const noPrev = RollbackManager.buildAEPCompensation("y", tool, { id: "E", v: 2 });
      expect(noPrev.compensationAction).toBeNull();
      expect(noPrev.backup.content).toBe(JSON.stringify({ id: "E", v: 2 }));
    }
  });

  it("unknown tools get a generic backup and no compensation", () => {
    const plan = RollbackManager.buildAEPCompensation("g", "file:write", { path: "/a" });
    expect(plan.compensationAction).toBeNull();
    expect(plan.backup.path).toBe("aep:generic:file:write");
  });
});

describe("RollbackManager rollback", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails when no plan exists", () => {
    const mgr = new RollbackManager();
    const r = mgr.rollback("missing");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No compensation plan/);
  });

  it("fails when the plan has no compensation action and keeps the plan", () => {
    const mgr = new RollbackManager();
    const plan = RollbackManager.buildAEPCompensation("u1", "aep:update_element", { id: "E" });
    mgr.recordCompensation("s", plan);
    const r = mgr.rollback("u1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No compensation action defined/);
    expect(mgr.getPlan("u1")).toBe(plan);
  });

  it("default executor records aep:compensate then action:rollback and drops the plan", () => {
    const ledger = new EvidenceLedger({ dir, sessionId: "rb" });
    const mgr = new RollbackManager();
    mgr.setLedger(ledger);
    const plan = RollbackManager.buildAEPCompensation("c1", "aep:create_element", { id: "EL-9" });
    mgr.recordCompensation("rb", plan);

    const r = mgr.rollback("c1");
    expect(r).toEqual({ actionId: "c1", success: true, compensationApplied: plan.compensationAction });
    expect(mgr.getPlan("c1")).toBeNull();

    const entries = ledger.entries();
    expect(entries.map((e) => e.type)).toEqual(["aep:compensate", "action:rollback"]);
    expect(entries[0]?.data).toMatchObject({ backupPath: "aep:element:EL-9", snapshotHash: plan.backup.snapshotHash });
    expect(entries[1]?.data).toMatchObject({ actionId: "c1", tool: "aep:create_element", compensationExecuted: true });
    expect(ledger.verify().valid).toBe(true);
  });

  it("default executor refuses compensation for an unknown tool", () => {
    const mgr = new RollbackManager();
    const plan: CompensationPlan = {
      actionId: "z",
      tool: "custom",
      originalInput: {},
      compensationAction: { tool: "custom:undo" },
      backup: { path: "p", content: "c", snapshotHash: sha("c") },
    };
    mgr.recordCompensation("s", plan);
    const r = mgr.rollback("z");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Compensation execution failed for tool "custom"/);
    expect(mgr.getPlan("z")).toBe(plan);
  });

  it("uses an injected executor and reports a throwing executor as failure", () => {
    const mgr = new RollbackManager();
    const seen: string[] = [];
    mgr.setCompensationExecutor((action, plan) => {
      seen.push(`${String(action.tool)}@${plan.actionId}`);
      return true;
    });
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("e1", "aep:create_element", { id: "A" }));
    expect(mgr.rollback("e1").success).toBe(true);
    expect(seen).toEqual(["aep:delete_element@e1"]);

    mgr.setCompensationExecutor(() => {
      throw new Error("disk full");
    });
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("e2", "aep:create_element", { id: "B" }));
    const r = mgr.rollback("e2");
    expect(r).toEqual({ actionId: "e2", success: false, compensationApplied: null, error: "disk full" });
  });

  it("rolls a session back in reverse order and keeps failed actions for retry", () => {
    const mgr = new RollbackManager();
    const order: string[] = [];
    mgr.setCompensationExecutor((_action, plan) => {
      order.push(plan.actionId);
      return true;
    });
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("1", "aep:create_element", { id: "A" }));
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("2", "aep:update_element", { id: "B" }));
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("3", "aep:create_element", { id: "C" }));
    expect(mgr.getSessionPlans("s").map((p) => p.actionId)).toEqual(["1", "2", "3"]);

    const results = mgr.rollbackSession("s");
    expect(results.map((r) => [r.actionId, r.success])).toEqual([
      ["3", true],
      ["2", false],
      ["1", true],
    ]);
    expect(order).toEqual(["3", "1"]);
    expect(mgr.getSessionPlans("s").map((p) => p.actionId)).toEqual(["2"]);
  });

  it("clears the session when every action rolls back", () => {
    const mgr = new RollbackManager();
    mgr.setCompensationExecutor(() => true);
    mgr.recordCompensation("s", RollbackManager.buildAEPCompensation("1", "aep:create_element", { id: "A" }));
    expect(mgr.rollbackSession("s").every((r) => r.success)).toBe(true);
    expect(mgr.getSessionPlans("s")).toEqual([]);
    expect(mgr.rollbackSession("s")).toEqual([]);
  });

  it("routes ledger writes to the per-session ledger", () => {
    const shared = new EvidenceLedger({ dir, sessionId: "shared" });
    const own = new EvidenceLedger({ dir, sessionId: "own" });
    const mgr = new RollbackManager();
    mgr.setLedger(shared);
    mgr.setLedger(own, "sessA");
    mgr.recordCompensation("sessA", RollbackManager.buildAEPCompensation("a", "aep:create_element", { id: "A" }));
    mgr.recordCompensation("sessB", RollbackManager.buildAEPCompensation("b", "aep:create_element", { id: "B" }));

    expect(mgr.rollback("a").success).toBe(true);
    expect(mgr.rollback("b").success).toBe(true);
    expect(own.entries().map((e) => e.data.actionId ?? null)).toEqual([null, "a"]);
    expect(shared.entries().map((e) => e.data.actionId ?? null)).toEqual([null, "b"]);
  });
});
