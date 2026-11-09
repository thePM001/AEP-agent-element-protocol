import { describe, it, expect } from "vitest";
import { AEPTelemetryExporter } from "../lib/otel-exporter.js";
import type { LedgerEntry, LedgerEntryType } from "../../evidence-ledger/lib/ledger/types.js";

interface OtlpValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface OtlpAttr {
  key: string;
  value: OtlpValue;
}
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  events: Array<{ name: string; timeUnixNano: string; attributes: OtlpAttr[] }>;
  status: { code: number; message?: string };
}
interface OtlpPayload {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttr[] };
    scopeSpans: Array<{ scope: { name: string }; spans: OtlpSpan[] }>;
  }>;
}

let seq = 0;
function entry(type: LedgerEntryType, data: Record<string, unknown>, ts = "2026-03-01T10:00:00.000Z"): LedgerEntry {
  seq++;
  return { seq, ts, hash: `hash-${seq}`, prev: `hash-${seq - 1}`, type, data };
}

function nanos(iso: string): string {
  return (BigInt(Date.parse(iso)) * 1_000_000n).toString();
}

function exporter(enabled?: boolean): AEPTelemetryExporter {
  return new AEPTelemetryExporter({
    endpoint: "http://collector.invalid:4318/v1/traces",
    serviceName: "aep-test",
    ...(enabled === undefined ? {} : { enabled }),
  });
}

describe("AEPTelemetryExporter span export", () => {
  it("creates a root session span with service and policy attributes", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "sess-1", policyName: "strict" }));
    const [root] = exp.getSpans();
    expect(root).toBeDefined();
    expect(root?.name).toBe("aep.session");
    expect(root?.parentSpanId).toBeNull();
    expect(root?.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root?.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(root?.attributes).toEqual({
      "aep.service_name": "aep-test",
      "aep.session_id": "sess-1",
      "aep.policy_name": "strict",
    });
    expect(root?.startTimeUnixNano).toBe(nanos("2026-03-01T10:00:00.000Z"));
    expect(root?.status).toEqual({ code: "OK" });
  });

  it("derives the same trace id for the same session and a different one for another session", () => {
    const a = exporter();
    const b = exporter();
    const c = exporter();
    a.exportEntry(entry("session:start", { sessionId: "same" }));
    b.exportEntry(entry("session:start", { sessionId: "same" }));
    c.exportEntry(entry("session:start", { sessionId: "other" }));
    expect(a.getSpans()[0]?.traceId).toBe(b.getSpans()[0]?.traceId);
    expect(a.getSpans()[0]?.traceId).not.toBe(c.getSpans()[0]?.traceId);
  });

  it("always emits a 32 char lowercase hex trace id and 16 char span id", () => {
    for (let i = 0; i < 200; i++) {
      const exp = exporter();
      exp.exportEntry(entry("session:start", { sessionId: `session-${i}` }));
      const span = exp.getSpans()[0];
      expect(span?.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span?.spanId).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("falls back to an unknown session id", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", {}));
    expect(exp.getSpans()[0]?.attributes["aep.session_id"]).toBe("unknown");
  });

  it("parents action spans under the session and maps deny to ERROR with reasons", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    exp.exportEntry(entry("action:evaluate", { actionId: "a1", tool: "fs.write", decision: "allow" }));
    exp.exportEntry(
      entry("action:evaluate", { actionId: "a2", tool: "net.fetch", decision: "deny", reasons: ["ring", "budget"] }),
    );
    const [root, allowed, denied] = exp.getSpans();
    expect(allowed?.parentSpanId).toBe(root?.spanId);
    expect(allowed?.traceId).toBe(root?.traceId);
    expect(allowed?.name).toBe("aep.action.fs.write");
    expect(allowed?.status).toEqual({ code: "OK" });
    expect(allowed?.attributes).toMatchObject({ "aep.action_id": "a1", "aep.decision": "allow" });
    expect(allowed?.attributes).not.toHaveProperty("aep.chain.steps_total");
    expect(denied?.status).toEqual({ code: "ERROR", message: "ring; budget" });
    expect(denied?.spanId).not.toBe(allowed?.spanId);
  });

  it("adds chain statistics to action spans when present", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    exp.exportEntry(
      entry("action:evaluate", { tool: "t", decision: "allow", steps_total: 15, steps_evaluated: 4, force_all_preconditions: true }),
    );
    expect(exp.getSpans()[1]?.attributes).toMatchObject({
      "aep.chain.steps_total": 15,
      "aep.chain.steps_evaluated": 4,
      "aep.chain.steps_short_circuited": 0,
      "aep.chain.steps_aborted": 0,
      "aep.chain.force_all_preconditions": true,
    });
  });

  it("exports chain, recovery, workflow and model spans", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    exp.exportEntry(entry("chain:evaluate", { tool: "deploy" }));
    exp.exportEntry(entry("recovery:attempt", { attemptNumber: 2, result: "failed" }));
    exp.exportEntry(entry("workflow:phase_enter", { workflow: "release", phase: "review", role: "auditor", ring: 2 }));
    exp.exportEntry(entry("model:call", { provider: "local", model: "small", decision: "error", latencyMs: 12 }));
    exp.exportEntry(entry("model:call", { provider: "local", model: "small", decision: "deny", reason: "budget" }));

    const spans = exp.getSpans();
    expect(spans.map((s) => s.name)).toEqual([
      "aep.session",
      "aep.chain.deploy",
      "aep.recovery.attempt",
      "aep.workflow.phase.review",
      "aep.model.local.small",
      "aep.model.local.small",
    ]);
    expect(spans[1]?.attributes["aep.chain.steps_total"]).toBe(15);
    expect(spans[2]?.status).toEqual({ code: "ERROR" });
    expect(spans[2]?.attributes).toEqual({ "aep.attempt_number": 2, "aep.result": "failed" });
    expect(spans[3]?.attributes).toEqual({
      "aep.workflow": "release",
      "aep.phase": "review",
      "aep.role": "auditor",
      "aep.ring": 2,
    });
    expect(spans[4]?.kind).toBe("CLIENT");
    expect(spans[4]?.status).toEqual({ code: "ERROR" });
    expect(spans[4]?.attributes["aep.latency_ms"]).toBe(12);
    expect(spans[4]?.attributes["aep.scan_passed"]).toBe(true);
    expect(spans[5]?.status).toEqual({ code: "ERROR", message: "budget" });
  });

  it("closes the root span on terminate and marks kill as an error", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }, "2026-03-01T10:00:00.000Z"));
    exp.exportEntry(entry("session:terminate", { reason: "kill" }, "2026-03-01T10:05:00.000Z"));
    const [root] = exp.getSpans();
    expect(root?.endTimeUnixNano).toBe(nanos("2026-03-01T10:05:00.000Z"));
    expect(root?.status).toEqual({ code: "ERROR", message: "kill" });

    const clean = exporter();
    clean.exportEntry(entry("session:start", { sessionId: "s" }));
    clean.exportEntry(entry("session:terminate", { reason: "complete" }));
    expect(clean.getSpans()[0]?.status).toEqual({ code: "OK" });
  });

  it("ignores entry types that are not exported", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    exp.exportEntry(entry("task:create", { id: "t" }));
    exp.exportEntry(entry("knowledge:ingest", {}));
    expect(exp.getSpans()).toHaveLength(1);
  });

  it("records nothing when disabled", () => {
    const exp = exporter(false);
    expect(exp.enabled).toBe(false);
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    expect(exp.getSpans()).toEqual([]);
    expect(exporter().enabled).toBe(true);
  });
});

describe("AEPTelemetryExporter event export", () => {
  it("attaches scanner findings as events on the root span", () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s" }));
    exp.exportEntry(
      entry("scanner:finding", { scanner: "pii", severity: "hard", category: "pii:email" }, "2026-03-01T10:01:00.000Z"),
    );
    const root = exp.getSpans()[0];
    expect(exp.getSpans()).toHaveLength(1);
    expect(root?.events).toEqual([
      {
        name: "scanner.pii",
        timeUnixNano: nanos("2026-03-01T10:01:00.000Z"),
        attributes: { "aep.scanner": "pii", "aep.severity": "hard", "aep.category": "pii:email" },
      },
    ]);
  });

  it("drops a finding that arrives before any session span", () => {
    const exp = exporter();
    exp.exportEntry(entry("scanner:finding", { scanner: "pii" }));
    expect(exp.getSpans()).toEqual([]);
  });
});

describe("AEPTelemetryExporter.flush", () => {
  it("produces an OTLP JSON payload and clears collected spans", async () => {
    const exp = exporter();
    exp.exportEntry(entry("session:start", { sessionId: "s", policyName: "p" }));
    exp.exportEntry(entry("scanner:finding", { scanner: "urls", severity: "soft", category: "url:detected" }));
    exp.exportEntry(entry("model:call", { provider: "local", model: "m", decision: "deny", reason: "r", latencyMs: 3 }));

    const { spans, payload } = await exp.flush();
    expect(spans).toHaveLength(2);
    expect(exp.getSpans()).toEqual([]);

    const parsed: OtlpPayload = JSON.parse(payload);
    const resource = parsed.resourceSpans[0];
    expect(resource?.resource.attributes).toEqual([{ key: "service.name", value: { stringValue: "aep-test" } }]);
    const scope = resource?.scopeSpans[0];
    expect(scope?.scope.name).toBe("aep-governance");

    const [root, model] = scope?.spans ?? [];
    expect(root?.kind).toBe(1);
    expect(root).not.toHaveProperty("parentSpanId");
    expect(root?.status).toEqual({ code: 1 });
    expect(root?.events[0]?.name).toBe("scanner.urls");
    expect(root?.events[0]?.attributes).toContainEqual({ key: "aep.severity", value: { stringValue: "soft" } });

    expect(model?.kind).toBe(3);
    expect(model?.parentSpanId).toBe(root?.spanId);
    expect(model?.status).toEqual({ code: 2, message: "r" });
    expect(model?.attributes).toContainEqual({ key: "aep.latency_ms", value: { intValue: 3 } });
    expect(model?.attributes).toContainEqual({ key: "aep.scan_passed", value: { boolValue: true } });

    const fractional = exporter();
    fractional.exportEntry(entry("session:start", { sessionId: "s" }));
    fractional.exportEntry(entry("model:call", { provider: "p", model: "m", decision: "allow", latencyMs: 12.5 }));
    const fractionalPayload: OtlpPayload = JSON.parse((await fractional.flush()).payload);
    const fractionalModel = fractionalPayload.resourceSpans[0]?.scopeSpans[0]?.spans[1];
    expect(fractionalModel?.attributes).toContainEqual({ key: "aep.latency_ms", value: { doubleValue: 12.5 } });

    const again = await exp.flush();
    expect(again.spans).toEqual([]);
    const empty: OtlpPayload = JSON.parse(again.payload);
    expect(empty.resourceSpans[0]?.scopeSpans[0]?.spans).toEqual([]);
  });
});
