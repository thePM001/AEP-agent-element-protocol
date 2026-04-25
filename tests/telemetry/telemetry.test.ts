import { AEPTelemetryExporter } from "../../src/telemetry/otel-exporter.js";
import type { LedgerEntry } from "../../src/ledger/types.js";

function makeEntry(type: string, data: Record<string, unknown> = {}, seq = 1): LedgerEntry {
  return {
    seq,
    ts: new Date().toISOString(),
    hash: `sha256:${seq.toString(16).padStart(8, "0")}`,
    prev: `sha256:${(seq - 1).toString(16).padStart(8, "0")}`,
    type: type as LedgerEntry["type"],
    data,
  };
}

describe("AEPTelemetryExporter", () => {
  describe("Spans created for session start", () => {
    it("creates a root span for session:start", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", {
        sessionId: "sess-001",
        policyName: "test-policy",
      }));

      const spans = exporter.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("aep.session");
      expect(spans[0].parentSpanId).toBeNull();
      expect(spans[0].attributes["aep.session_id"]).toBe("sess-001");
      expect(spans[0].attributes["aep.service_name"]).toBe("test-agent");
    });
  });

  describe("Spans created for action evaluate with attributes", () => {
    it("creates child span with tool and decision attributes", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "sess-002" }, 1));
      exporter.exportEntry(makeEntry("action:evaluate", {
        actionId: "act-001",
        tool: "file:read",
        decision: "allow",
        reasons: [],
      }, 2));

      const spans = exporter.getSpans();
      expect(spans).toHaveLength(2);

      const actionSpan = spans[1];
      expect(actionSpan.name).toBe("aep.action.file:read");
      expect(actionSpan.parentSpanId).toBe(spans[0].spanId);
      expect(actionSpan.attributes["aep.tool"]).toBe("file:read");
      expect(actionSpan.attributes["aep.decision"]).toBe("allow");
      expect(actionSpan.status.code).toBe("OK");
    });

    it("marks denied actions as ERROR status", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "s" }, 1));
      exporter.exportEntry(makeEntry("action:evaluate", {
        actionId: "act-002",
        tool: "file:delete",
        decision: "deny",
        reasons: ["Forbidden pattern matched"],
      }, 2));

      const spans = exporter.getSpans();
      expect(spans[1].status.code).toBe("ERROR");
    });
  });

  describe("Recovery attempts as child spans", () => {
    it("creates span for recovery:attempt", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "s" }, 1));
      exporter.exportEntry(makeEntry("recovery:attempt", {
        attemptNumber: 1,
        result: "recovered",
      }, 2));

      const spans = exporter.getSpans();
      expect(spans).toHaveLength(2);
      expect(spans[1].name).toBe("aep.recovery.attempt");
      expect(spans[1].attributes["aep.attempt_number"]).toBe(1);
      expect(spans[1].status.code).toBe("OK");
    });
  });

  describe("Scanner findings as span events", () => {
    it("adds scanner finding as event on root span", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "s" }, 1));
      exporter.exportEntry(makeEntry("scanner:finding", {
        scanner: "pii",
        severity: "hard",
        category: "ssn",
      }, 2));

      const spans = exporter.getSpans();
      expect(spans).toHaveLength(1); // Only root span, finding is an event
      expect(spans[0].events).toHaveLength(1);
      expect(spans[0].events[0].name).toBe("scanner.pii");
      expect(spans[0].events[0].attributes["aep.severity"]).toBe("hard");
    });
  });

  describe("Flush sends to endpoint", () => {
    it("flush returns spans and OTLP payload", async () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "s" }, 1));
      exporter.exportEntry(makeEntry("action:evaluate", { tool: "f", decision: "allow" }, 2));

      const result = await exporter.flush();
      expect(result.spans).toHaveLength(2);
      expect(result.payload).toContain("resourceSpans");
      expect(result.payload).toContain("test-agent");

      // After flush, spans are cleared
      expect(exporter.getSpans()).toHaveLength(0);
    });
  });

  describe("Disabled by default (no spans when off)", () => {
    it("produces no spans when disabled", () => {
      const exporter = new AEPTelemetryExporter({
        endpoint: "http://localhost:4318",
        serviceName: "test-agent",
        enabled: false,
      });

      exporter.exportEntry(makeEntry("session:start", { sessionId: "s" }, 1));
      exporter.exportEntry(makeEntry("action:evaluate", { tool: "f", decision: "allow" }, 2));

      expect(exporter.getSpans()).toHaveLength(0);
      expect(exporter.enabled).toBe(false);
    });
  });
});
