/**
 * Optional Agentstream evidence backend (paid add-on connector).
 * All outbound calls are lattice-gated via inference_engine dock.
 */

import { latticeGatedFetch } from "../../../lattice-channels/client/lattice/index.js";

export interface AgentstreamConfig {
  url: string;
  capsule?: string;
  timeoutMs?: number;
}

export interface EvidenceEntry {
  id: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown>;
}

export class AgentstreamEvidenceBackend {
  private readonly url: string;
  private readonly capsule: string;
  private readonly timeoutMs: number;

  constructor(config: AgentstreamConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.capsule = config.capsule ?? "aep-evidence";
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async healthCheck(): Promise<{ ok: boolean; status: string }> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await latticeGatedFetch(
        `${this.url}/api/health`,
        {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        },
        {
          agentId: "agentstream-evidence",
          channelId: "ch-agentstream-health",
          gateway: "agentstream",
          eventType: "AGENTSTREAM_HEALTH_CHECK",
        },
      );
      clearTimeout(timer);
      if (!res.ok) return { ok: false, status: `http_${res.status}` };
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const raw = String(body.status ?? body.health ?? "ok").toLowerCase();
      const ok = raw === "ok" || raw === "healthy" || raw === "online";
      return { ok, status: ok ? "ok" : raw };
    } catch (err) {
      return { ok: false, status: err instanceof Error ? err.message : "offline" };
    }
  }

  async append(entry: Omit<EvidenceEntry, "id" | "timestamp">): Promise<EvidenceEntry> {
    const record: EvidenceEntry = {
      id: `ev-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await latticeGatedFetch(
        `${this.url}/api/evidence/${encodeURIComponent(this.capsule)}`,
        {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(record),
        },
        {
          agentId: "agentstream-evidence",
          channelId: "ch-agentstream-append",
          gateway: "agentstream",
          eventType: "AGENTSTREAM_EVIDENCE_APPEND",
        },
      );
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`Agentstream append failed: HTTP ${res.status}`);
      }
      return record;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
}

export function createAgentstreamBackend(config: AgentstreamConfig): AgentstreamEvidenceBackend {
  return new AgentstreamEvidenceBackend(config);
}