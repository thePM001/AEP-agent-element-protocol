// AEP 2.5 -- OpenTelemetry Exporter
// Exports evidence ledger entries as OpenTelemetry spans.
// Uses a lightweight built-in implementation that does not require
// @opentelemetry/api at runtime. Produces OTLP-compatible JSON.

import type { LedgerEntry } from "../ledger/types.js";

export interface OTELSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: "INTERNAL" | "CLIENT" | "SERVER";
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
  events: OTELEvent[];
  status: { code: "OK" | "ERROR"; message?: string };
}

export interface OTELEvent {
  name: string;
  timeUnixNano: string;
  attributes: Record<string, string | number | boolean>;
}

export interface OTELExporterOptions {
  endpoint: string;
  serviceName: string;
  enabled?: boolean;
}

/**
 * Generates a 32-hex-char trace ID from a session ID.
 */
function traceIdFromSession(sessionId: string): string {
  // Use a deterministic hash of the session ID
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(8, "0");
  return (hex + hex + hex + hex).slice(0, 32);
}

/**
 * Generates a 16-hex-char span ID from a sequence number.
 */
function spanIdFromSeq(seq: number, salt: string): string {
  let hash = seq;
  for (let i = 0; i < salt.length; i++) {
    hash = ((hash << 5) - hash + salt.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0").slice(0, 16);
}

function isoToNano(iso: string): string {
  const ms = new Date(iso).getTime();
  return (BigInt(ms) * 1_000_000n).toString();
}

export class AEPTelemetryExporter {
  private options: OTELExporterOptions;
  private spans: OTELSpan[] = [];
  private rootSpanId: string | null = null;
  private traceId: string | null = null;

  constructor(options: OTELExporterOptions) {
    this.options = {
      enabled: true,
      ...options,
    };
  }

  get enabled(): boolean {
    return this.options.enabled !== false;
  }

  /**
   * Export a single ledger entry as an OTEL span or span event.
   */
  exportEntry(entry: LedgerEntry): void {
    if (!this.enabled) return;

    const sessionId = (entry.data as Record<string, unknown>).sessionId as string ?? "unknown";
    if (!this.traceId) {
      this.traceId = traceIdFromSession(sessionId);
    }

    switch (entry.type) {
      case "session:start":
        this.rootSpanId = spanIdFromSeq(entry.seq, entry.hash);
        this.spans.push({
          traceId: this.traceId,
          spanId: this.rootSpanId,
          parentSpanId: null,
          name: "aep.session",
          kind: "INTERNAL",
          startTimeUnixNano: isoToNano(entry.ts),
          endTimeUnixNano: isoToNano(entry.ts), // Updated on session:terminate
          attributes: {
            "aep.service_name": this.options.serviceName,
            "aep.session_id": sessionId,
            "aep.policy_name": (entry.data as Record<string, unknown>).policyName as string ?? "",
          },
          events: [],
          status: { code: "OK" },
        });
        break;

      case "session:terminate": {
        // Update root span end time
        const root = this.spans.find((s) => s.spanId === this.rootSpanId);
        if (root) {
          root.endTimeUnixNano = isoToNano(entry.ts);
          const reason = (entry.data as Record<string, unknown>).reason as string ?? "";
          if (reason === "kill" || reason === "error") {
            root.status = { code: "ERROR", message: reason };
          }
        }
        break;
      }

      case "action:evaluate": {
        const data = entry.data as Record<string, unknown>;
        const spanId = spanIdFromSeq(entry.seq, entry.hash);
        this.spans.push({
          traceId: this.traceId,
          spanId,
          parentSpanId: this.rootSpanId,
          name: `aep.action.${data.tool as string ?? "unknown"}`,
          kind: "INTERNAL",
          startTimeUnixNano: isoToNano(entry.ts),
          endTimeUnixNano: isoToNano(entry.ts),
          attributes: {
            "aep.action_id": data.actionId as string ?? "",
            "aep.tool": data.tool as string ?? "",
            "aep.decision": data.decision as string ?? "",
            "aep.trust_change": 0,
            "aep.ring": 0,
          },
          events: [],
          status: {
            code: data.decision === "deny" ? "ERROR" : "OK",
            ...(data.decision === "deny" ? { message: ((data.reasons as string[]) ?? []).join("; ") } : {}),
          },
        });
        break;
      }

      case "recovery:attempt": {
        const data = entry.data as Record<string, unknown>;
        const spanId = spanIdFromSeq(entry.seq, entry.hash);
        this.spans.push({
          traceId: this.traceId,
          spanId,
          parentSpanId: this.rootSpanId,
          name: "aep.recovery.attempt",
          kind: "INTERNAL",
          startTimeUnixNano: isoToNano(entry.ts),
          endTimeUnixNano: isoToNano(entry.ts),
          attributes: {
            "aep.attempt_number": data.attemptNumber as number ?? 0,
            "aep.result": data.result as string ?? "",
          },
          events: [],
          status: { code: data.result === "recovered" ? "OK" : "ERROR" },
        });
        break;
      }

      case "scanner:finding": {
        // Add as an event on the root span
        const data = entry.data as Record<string, unknown>;
        const root = this.spans.find((s) => s.spanId === this.rootSpanId);
        root?.events.push({
          name: `scanner.${data.scanner as string ?? "unknown"}`,
          timeUnixNano: isoToNano(entry.ts),
          attributes: {
            "aep.scanner": data.scanner as string ?? "",
            "aep.severity": data.severity as string ?? "",
            "aep.category": data.category as string ?? "",
          },
        });
        break;
      }

      case "workflow:phase_enter": {
        const data = entry.data as Record<string, unknown>;
        const spanId = spanIdFromSeq(entry.seq, entry.hash);
        this.spans.push({
          traceId: this.traceId,
          spanId,
          parentSpanId: this.rootSpanId,
          name: `aep.workflow.phase.${data.phase as string ?? "unknown"}`,
          kind: "INTERNAL",
          startTimeUnixNano: isoToNano(entry.ts),
          endTimeUnixNano: isoToNano(entry.ts),
          attributes: {
            "aep.workflow": data.workflow as string ?? "",
            "aep.phase": data.phase as string ?? "",
            "aep.role": data.role as string ?? "",
            "aep.ring": data.ring as number ?? 0,
          },
          events: [],
          status: { code: "OK" },
        });
        break;
      }

      default:
        // Other entry types are not exported as spans
        break;
    }
  }

  /**
   * Flush all collected spans. Returns the OTLP JSON payload.
   * In a production integration this would POST to the endpoint.
   */
  async flush(): Promise<{ spans: OTELSpan[]; payload: string }> {
    const payload = JSON.stringify({
      resourceSpans: [{
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: this.options.serviceName } },
          ],
        },
        scopeSpans: [{
          scope: { name: "aep-governance" },
          spans: this.spans.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId ?? undefined,
            name: s.name,
            kind: s.kind === "INTERNAL" ? 1 : s.kind === "CLIENT" ? 3 : 2,
            startTimeUnixNano: s.startTimeUnixNano,
            endTimeUnixNano: s.endTimeUnixNano,
            attributes: Object.entries(s.attributes).map(([k, v]) => ({
              key: k,
              value: typeof v === "string"
                ? { stringValue: v }
                : typeof v === "number"
                ? { intValue: v }
                : { boolValue: v },
            })),
            events: s.events.map((e) => ({
              name: e.name,
              timeUnixNano: e.timeUnixNano,
              attributes: Object.entries(e.attributes).map(([k, v]) => ({
                key: k,
                value: typeof v === "string"
                  ? { stringValue: v }
                  : typeof v === "number"
                  ? { intValue: v }
                  : { boolValue: v },
              })),
            })),
            status: { code: s.status.code === "OK" ? 1 : 2, message: s.status.message },
          })),
        }],
      }],
    });

    const result = { spans: [...this.spans], payload };
    this.spans = [];
    return result;
  }

  /**
   * Get collected spans without flushing.
   */
  getSpans(): readonly OTELSpan[] {
    return this.spans;
  }
}
