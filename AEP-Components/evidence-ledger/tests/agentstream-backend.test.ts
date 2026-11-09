import { describe, it, expect } from "vitest";
import {
  AgentstreamEvidenceBackend,
  createAgentstreamBackend,
  type AgentstreamFetch,
} from "../lib/evidence/index.js";

interface Call {
  url: string;
  init: RequestInit;
  meta: Parameters<AgentstreamFetch>[2];
}

function fakeFetch(reply: () => Response | Promise<Response>): { fetchImpl: AgentstreamFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: AgentstreamFetch = async (url, init, meta) => {
    calls.push({ url, init, meta });
    return reply();
  };
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("AgentstreamEvidenceBackend.healthCheck", () => {
  it("reports ok for healthy status words and calls the health endpoint", async () => {
    for (const word of ["ok", "healthy", "ONLINE"]) {
      const { fetchImpl, calls } = fakeFetch(() => json({ status: word }));
      const backend = new AgentstreamEvidenceBackend({ url: "https://as.example.test/", fetchImpl });
      expect(await backend.healthCheck()).toEqual({ ok: true, status: "ok" });
      expect(calls[0]?.url).toBe("https://as.example.test/api/health");
      expect(calls[0]?.meta).toMatchObject({ gateway: "agentstream", eventType: "AGENTSTREAM_HEALTH_CHECK" });
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("falls back to the health field, then to ok when the body is not JSON", async () => {
    const viaHealth = fakeFetch(() => json({ health: "degraded" }));
    expect(await new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl: viaHealth.fetchImpl }).healthCheck()).toEqual({
      ok: false,
      status: "degraded",
    });

    const notJson = fakeFetch(() => new Response("plain text", { status: 200 }));
    expect(await new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl: notJson.fetchImpl }).healthCheck()).toEqual({
      ok: true,
      status: "ok",
    });
  });

  it("reports http status on a non-ok response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("", { status: 503 }));
    const backend = new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl });
    expect(await backend.healthCheck()).toEqual({ ok: false, status: "http_503" });
  });

  it("reports the error message when the transport throws", async () => {
    const fetchImpl: AgentstreamFetch = async () => {
      throw new Error("inference_engine dock required");
    };
    const backend = new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl });
    expect(await backend.healthCheck()).toEqual({ ok: false, status: "inference_engine dock required" });
  });
});

describe("AgentstreamEvidenceBackend.append", () => {
  it("posts the record to the capsule endpoint and returns it", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ stored: true }, 201));
    const backend = createAgentstreamBackend({ url: "https://as.example.test", capsule: "my capsule/1", fetchImpl });
    const record = await backend.append({ type: "action:evaluate", payload: { decision: "allow" } });

    expect(record.type).toBe("action:evaluate");
    expect(record.payload).toEqual({ decision: "allow" });
    expect(record.id).toMatch(/^ev-\d+$/);
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://as.example.test/api/evidence/my%20capsule%2F1");
    expect(call?.init.method).toBe("POST");
    expect(JSON.parse(String(call?.init.body))).toEqual(record);
    expect(call?.meta).toMatchObject({ channelId: "ch-agentstream-append", eventType: "AGENTSTREAM_EVIDENCE_APPEND" });
  });

  it("uses the default capsule name", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({}));
    await new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl }).append({ type: "t", payload: {} });
    expect(calls[0]?.url).toBe("https://h/api/evidence/aep-evidence");
  });

  it("throws on a non-ok response", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("err", { status: 500 }));
    const backend = new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl });
    await expect(backend.append({ type: "t", payload: {} })).rejects.toThrow("Agentstream append failed: HTTP 500");
  });

  it("rethrows transport errors", async () => {
    const fetchImpl: AgentstreamFetch = async () => {
      throw new Error("refused");
    };
    const backend = new AgentstreamEvidenceBackend({ url: "https://h", fetchImpl });
    await expect(backend.append({ type: "t", payload: {} })).rejects.toThrow("refused");
  });

  it("aborts a request that outlives timeoutMs", async () => {
    const fetchImpl: AgentstreamFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted by timeout")));
      });
    const backend = new AgentstreamEvidenceBackend({ url: "https://h", timeoutMs: 20, fetchImpl });
    await expect(backend.append({ type: "t", payload: {} })).rejects.toThrow("aborted by timeout");
    expect(await backend.healthCheck()).toEqual({ ok: false, status: "aborted by timeout" });
  });
});
