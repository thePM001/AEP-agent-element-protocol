import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { RollbackManager } from "../../src/rollback/manager.js";
import { EvidenceLedger } from "../../src/ledger/ledger.js";

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../../.test-rollback-ledgers"
);

describe("RollbackManager", () => {
  let manager: RollbackManager;
  let ledger: EvidenceLedger;
  const sessionId = "test-session-1";

  beforeEach(() => {
    manager = new RollbackManager();
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    ledger = new EvidenceLedger({ dir: TEST_DIR, sessionId: randomUUID() });
    manager.setLedger(ledger);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("stores and retrieves compensation plans", () => {
    const content = JSON.stringify({ id: "CP-00010", z: 25 });
    const plan = {
      actionId: "act-1",
      tool: "aep:create_element",
      originalInput: { id: "CP-00010", z: 25 },
      compensationAction: { tool: "aep:delete_element", input: { id: "CP-00010" } },
      backup: { path: "aep:element:CP-00010", content, snapshotHash: sha256(content) },
    };

    manager.recordCompensation(sessionId, plan);
    const retrieved = manager.getPlan("act-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.tool).toBe("aep:create_element");
  });

  it("rolls back a single action", () => {
    const content = JSON.stringify({ id: "CP-00020" });
    const plan = {
      actionId: "act-2",
      tool: "aep:create_element",
      originalInput: { id: "CP-00020" },
      compensationAction: { tool: "aep:delete_element", input: { id: "CP-00020" } },
      backup: { path: "aep:element:CP-00020", content, snapshotHash: sha256(content) },
    };

    manager.recordCompensation(sessionId, plan);
    const result = manager.rollback("act-2");
    expect(result.success).toBe(true);
    expect(result.compensationApplied).toEqual(plan.compensationAction);

    // Plan should be removed after rollback
    expect(manager.getPlan("act-2")).toBeNull();
  });

  it("returns error for missing action", () => {
    const result = manager.rollback("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("No compensation plan");
  });

  it("rolls back full session in reverse order", () => {
    const cA = JSON.stringify({ id: "CP-00001" });
    const cB = JSON.stringify({ id: "CP-00002" });
    const cC = JSON.stringify({ id: "CP-00001", label: "new" });
    manager.recordCompensation(sessionId, {
      actionId: "act-a",
      tool: "aep:create_element",
      originalInput: { id: "CP-00001" },
      compensationAction: { tool: "aep:delete_element", input: { id: "CP-00001" } },
      backup: { path: "aep:element:CP-00001", content: cA, snapshotHash: sha256(cA) },
    });
    manager.recordCompensation(sessionId, {
      actionId: "act-b",
      tool: "aep:create_element",
      originalInput: { id: "CP-00002" },
      compensationAction: { tool: "aep:delete_element", input: { id: "CP-00002" } },
      backup: { path: "aep:element:CP-00002", content: cB, snapshotHash: sha256(cB) },
    });
    manager.recordCompensation(sessionId, {
      actionId: "act-c",
      tool: "aep:update_element",
      originalInput: { id: "CP-00001", label: "new" },
      compensationAction: {
        tool: "aep:update_element",
        input: { id: "CP-00001", label: "old" },
      },
      backup: { path: "aep:element:CP-00001", content: cC, snapshotHash: sha256(cC) },
    });

    const results = manager.rollbackSession(sessionId);
    expect(results).toHaveLength(3);
    // Should be in reverse order: act-c, act-b, act-a
    expect(results[0].actionId).toBe("act-c");
    expect(results[1].actionId).toBe("act-b");
    expect(results[2].actionId).toBe("act-a");
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("logs rollback in evidence ledger", () => {
    const logContent = JSON.stringify({ id: "CP-00099" });
    manager.recordCompensation(sessionId, {
      actionId: "act-logged",
      tool: "aep:delete_element",
      originalInput: { id: "CP-00099" },
      compensationAction: null,
      backup: { path: "aep:element:CP-00099", content: logContent, snapshotHash: sha256(logContent) },
    });

    manager.rollback("act-logged");
    const entries = ledger.entries();
    const rollbackEntries = entries.filter((e) => e.type === "action:rollback");
    expect(rollbackEntries).toHaveLength(1);
    expect(rollbackEntries[0].data.actionId).toBe("act-logged");
  });

  describe("AEP-specific compensation", () => {
    it("builds create -> delete compensation", () => {
      const plan = RollbackManager.buildAEPCompensation(
        "act-1",
        "aep:create_element",
        { id: "CP-00010", z: 25, parent: "PN-00001" }
      );
      expect(plan.compensationAction).toEqual({
        tool: "aep:delete_element",
        input: { id: "CP-00010" },
      });
    });

    it("builds delete -> recreate compensation with backup", () => {
      const previousState = {
        id: "CP-00010",
        type: "component",
        z: 25,
        parent: "PN-00001",
      };
      const plan = RollbackManager.buildAEPCompensation(
        "act-2",
        "aep:delete_element",
        { id: "CP-00010" },
        previousState
      );
      expect(plan.compensationAction).toEqual({
        tool: "aep:create_element",
        input: previousState,
      });
      expect(plan.backup.content).toBe(JSON.stringify(previousState));
    });

    it("builds update -> restore compensation", () => {
      const previousState = { id: "CP-00010", label: "old-label" };
      const plan = RollbackManager.buildAEPCompensation(
        "act-3",
        "aep:update_element",
        { id: "CP-00010", label: "new-label" },
        previousState
      );
      expect(plan.compensationAction).toEqual({
        tool: "aep:update_element",
        input: previousState,
      });
    });

    it("builds skin update -> restore compensation", () => {
      const prev = { accent: "#58A6FF" };
      const plan = RollbackManager.buildAEPCompensation(
        "act-4",
        "aep:update_skin",
        { accent: "#FF0000" },
        prev
      );
      expect(plan.compensationAction).toEqual({
        tool: "aep:update_skin",
        input: prev,
      });
    });

    it("always includes backup with snapshotHash", () => {
      const plan = RollbackManager.buildAEPCompensation(
        "act-backup",
        "aep:create_element",
        { id: "CP-00099", z: 20 }
      );
      expect(plan.backup).toBeDefined();
      expect(plan.backup.path).toBe("aep:element:CP-00099");
      expect(plan.backup.content).toBe(JSON.stringify({ id: "CP-00099", z: 20 }));
      expect(plan.backup.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("snapshotHash matches SHA-256 of backup content", () => {
      const input = { id: "CP-00077", z: 22, parent: "PN-00001" };
      const plan = RollbackManager.buildAEPCompensation(
        "act-hash",
        "aep:create_element",
        input
      );
      const expected = sha256(JSON.stringify(input));
      expect(plan.backup.snapshotHash).toBe(expected);
    });

    it("rollback entry includes snapshotHash", () => {
      const input = { id: "CP-00088", z: 21 };
      const plan = RollbackManager.buildAEPCompensation(
        "act-snap",
        "aep:create_element",
        input
      );
      manager.recordCompensation(sessionId, plan);
      manager.rollback("act-snap");

      const entries = ledger.entries();
      const rollbackEntry = entries.find((e) => e.type === "action:rollback");
      expect(rollbackEntry).toBeDefined();
      expect(rollbackEntry!.data.snapshotHash).toBe(plan.backup.snapshotHash);
    });
  });
});
