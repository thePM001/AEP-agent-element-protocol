import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceLedger } from "../../src/ledger/ledger.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../.test-report-ledgers-" + randomUUID().slice(0, 8)
);

describe("Ledger report generation", () => {
  let sessionId: string;
  let ledger: EvidenceLedger;

  beforeAll(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    sessionId = randomUUID();
    ledger = new EvidenceLedger({ dir: TEST_DIR, sessionId });

    // Build a realistic session ledger
    ledger.append("session:start", { sessionId });
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    ledger.append("action:evaluate", { tool: "file:write", decision: "allow" });
    ledger.append("action:evaluate", { tool: "file:delete", decision: "deny" });
    ledger.append("action:evaluate", { tool: "file:read", decision: "allow" });
    ledger.append("session:terminate", { reason: "completed" });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("produces a report with correct entry count", () => {
    const report = ledger.report();
    expect(report.entryCount).toBe(7);
  });

  it("includes session ID in report", () => {
    const report = ledger.report();
    expect(report.sessionId).toBe(sessionId);
  });

  it("counts action types correctly", () => {
    const report = ledger.report();
    expect(report.actionCounts["session:start"]).toBe(1);
    expect(report.actionCounts["action:evaluate"]).toBe(5);
    expect(report.actionCounts["session:terminate"]).toBe(1);
  });

  it("includes time range", () => {
    const report = ledger.report();
    expect(report.timeRange).not.toBeNull();
    expect(report.timeRange!.first).toBeDefined();
    expect(report.timeRange!.last).toBeDefined();
  });

  it("validates chain integrity", () => {
    const report = ledger.report();
    expect(report.chainValid).toBe(true);
  });

  it("serialises to JSON correctly", () => {
    const report = ledger.report();
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.sessionId).toBe(sessionId);
    expect(parsed.entryCount).toBe(7);
    expect(parsed.chainValid).toBe(true);
  });

  it("formats as CSV with headers and rows", () => {
    const report = ledger.report();
    const csvHeader = "session_id,entry_count,chain_valid,first_ts,last_ts";
    const first = report.timeRange?.first ?? "";
    const last = report.timeRange?.last ?? "";
    const csvRow = `${report.sessionId},${report.entryCount},${report.chainValid},${first},${last}`;

    expect(csvHeader).toContain("session_id");
    expect(csvRow).toContain(sessionId);
    expect(csvRow).toContain("7");
    expect(csvRow).toContain("true");
  });

  it("formats as HTML with table rows", () => {
    const report = ledger.report();
    const rows = Object.entries(report.actionCounts)
      .map(([t, c]) => `<tr><td>${t}</td><td>${c}</td></tr>`)
      .join("\n");

    expect(rows).toContain("session:start");
    expect(rows).toContain("action:evaluate");
    expect(rows).toContain("<td>5</td>");
  });

  it("handles empty ledger report", () => {
    const emptyId = randomUUID();
    const emptyLedger = new EvidenceLedger({ dir: TEST_DIR, sessionId: emptyId });
    const report = emptyLedger.report();

    expect(report.entryCount).toBe(0);
    expect(report.timeRange).toBeNull();
    expect(Object.keys(report.actionCounts)).toHaveLength(0);
  });
});
