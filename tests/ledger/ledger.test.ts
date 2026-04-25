import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceLedger } from "../../src/ledger/ledger.js";

const TEST_DIR = join(import.meta.dirname ?? __dirname, "../../.test-ledgers");

describe("EvidenceLedger", () => {
  let ledger: EvidenceLedger;
  let sessionId: string;

  beforeEach(() => {
    sessionId = randomUUID();
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    ledger = new EvidenceLedger({ dir: TEST_DIR, sessionId });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("appends entries with correct hash chain", () => {
    const e1 = ledger.append("session:start", { policy: "test" });
    expect(e1.seq).toBe(1);
    expect(e1.prev).toContain("sha256:000");
    expect(e1.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const e2 = ledger.append("action:evaluate", { tool: "file:read" });
    expect(e2.seq).toBe(2);
    expect(e2.prev).toBe(e1.hash);
    expect(e2.hash).not.toBe(e1.hash);
  });

  it("verifies valid chain returns true", () => {
    ledger.append("session:start", { policy: "test" });
    ledger.append("action:evaluate", { tool: "file:read" });
    ledger.append("action:result", { success: true });
    ledger.append("session:terminate", { reason: "done" });

    const result = ledger.verify();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it("detects tampering when entry is modified", () => {
    ledger.append("session:start", { policy: "test" });
    ledger.append("action:evaluate", { tool: "file:read" });
    ledger.append("session:terminate", { reason: "done" });

    // Tamper with the file
    const filePath = join(TEST_DIR, `${sessionId}.jsonl`);
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const entry = JSON.parse(lines[1]);
    entry.data.tool = "TAMPERED";
    lines[1] = JSON.stringify(entry);
    writeFileSync(filePath, lines.join("\n") + "\n");

    // Re-create ledger to read from tampered file
    const verifier = new EvidenceLedger({ dir: TEST_DIR, sessionId });
    const result = verifier.verify();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("returns all entries", () => {
    ledger.append("session:start", {});
    ledger.append("action:evaluate", { tool: "a" });
    ledger.append("action:evaluate", { tool: "b" });

    const entries = ledger.entries();
    expect(entries).toHaveLength(3);
    expect(entries[0].type).toBe("session:start");
    expect(entries[1].type).toBe("action:evaluate");
    expect(entries[2].type).toBe("action:evaluate");
  });

  it("generates correct report", () => {
    ledger.append("session:start", {});
    ledger.append("action:evaluate", { decision: "allow" });
    ledger.append("action:evaluate", { decision: "deny" });
    ledger.append("aep:validate", { elementId: "CP-00001" });
    ledger.append("aep:reject", { elementId: "XX-00001", errors: ["bad"] });
    ledger.append("session:terminate", { reason: "done" });

    const report = ledger.report();
    expect(report.sessionId).toBe(sessionId);
    expect(report.entryCount).toBe(6);
    expect(report.chainValid).toBe(true);
    expect(report.actionCounts["session:start"]).toBe(1);
    expect(report.actionCounts["action:evaluate"]).toBe(2);
    expect(report.actionCounts["aep:validate"]).toBe(1);
    expect(report.actionCounts["aep:reject"]).toBe(1);
    expect(report.actionCounts["session:terminate"]).toBe(1);
    expect(report.timeRange).not.toBeNull();
  });

  it("handles empty ledger", () => {
    const entries = ledger.entries();
    expect(entries).toHaveLength(0);
    const result = ledger.verify();
    expect(result.valid).toBe(true);
    const report = ledger.report();
    expect(report.entryCount).toBe(0);
    expect(report.timeRange).toBeNull();
  });

  it("resumes chain from existing file", () => {
    ledger.append("session:start", {});
    ledger.append("action:evaluate", {});

    // Create new ledger instance for same session
    const ledger2 = new EvidenceLedger({ dir: TEST_DIR, sessionId });
    const e = ledger2.append("action:result", {});
    expect(e.seq).toBe(3);

    // Chain should still be valid
    expect(ledger2.verify().valid).toBe(true);
  });

  describe("stateRef snapshots", () => {
    it("includes stateRef when stateProvider is set", () => {
      let counter = 0;
      const stateLedger = new EvidenceLedger({
        dir: TEST_DIR,
        sessionId: randomUUID(),
        stateProvider: () => ({ counter: ++counter }),
      });

      const e1 = stateLedger.append("session:start", {});
      expect(e1.stateRef).toBeDefined();
      expect(e1.stateRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("stateRef changes between entries as state changes", () => {
      let counter = 0;
      const stateLedger = new EvidenceLedger({
        dir: TEST_DIR,
        sessionId: randomUUID(),
        stateProvider: () => ({ counter: ++counter }),
      });

      const e1 = stateLedger.append("session:start", {});
      const e2 = stateLedger.append("action:evaluate", { tool: "x" });
      expect(e1.stateRef).not.toBe(e2.stateRef);
    });

    it("works without stateProvider (backward compat)", () => {
      const e = ledger.append("session:start", {});
      expect(e.stateRef).toBeUndefined();
    });
  });
});
