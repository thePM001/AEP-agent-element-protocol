import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OfflineLedger } from "../lib/ledger/offline.js";
import { TimestampQueue, type TsaFetch } from "../lib/ledger/timestamp.js";
import { EvidenceLedger } from "../lib/ledger/ledger.js";

const sha = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

describe("OfflineLedger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aep-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("chains local hashes and stamps entries with the injected clock", () => {
    const clock = () => new Date(Date.UTC(2026, 2, 3, 4, 5, 6));
    const off = new OfflineLedger({ clock });
    const a = off.append("session:start", { x: 1 });
    const b = off.append("action:evaluate", { y: 2 });

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(a.ts).toBe("2026-03-03T04:05:06.000Z");
    expect(a.prevLocalHash).toBe("offline:0000");
    expect(a.localHash).toBe("offline:" + sha("offline:0000" + "session:start" + '{"x":1}'));
    expect(b.prevLocalHash).toBe(a.localHash);
    expect(off.size()).toBe(2);
    expect(off.verifyLocalChain()).toBe(true);
  });

  it("getQueue returns a copy of the queue array", () => {
    const off = new OfflineLedger();
    off.append("session:start", {});
    const q = off.getQueue();
    q.pop();
    expect(off.size()).toBe(1);
  });

  it("detects tampering of a queued entry", () => {
    const off = new OfflineLedger();
    off.append("action:evaluate", { decision: "deny" });
    off.append("action:evaluate", { decision: "deny" });
    const first = off.getQueue()[0];
    expect(first).toBeDefined();
    if (first) first.data.decision = "allow";
    expect(off.verifyLocalChain()).toBe(false);
  });

  it("refuses to sync a tampered queue", () => {
    const off = new OfflineLedger();
    off.append("action:evaluate", { n: 1 });
    const first = off.getQueue()[0];
    if (first) first.prevLocalHash = "offline:ffff";
    const ledger = new EvidenceLedger({ dir, sessionId: "sync-bad" });
    expect(() => off.sync(ledger)).toThrow(/integrity/);
    expect(ledger.entries()).toEqual([]);
  });

  it("syncs entries into the evidence ledger in order and resets", () => {
    const off = new OfflineLedger();
    off.append("session:start", { a: 1 });
    off.append("action:evaluate", { b: 2 });
    const ledger = new EvidenceLedger({ dir, sessionId: "sync" });

    expect(off.sync(ledger)).toEqual({ synced: 2, errors: [] });
    expect(off.size()).toBe(0);
    expect(ledger.entries().map((e) => [e.type, e.data])).toEqual([
      ["session:start", { a: 1 }],
      ["action:evaluate", { b: 2 }],
    ]);
    expect(ledger.verify().valid).toBe(true);

    // After clear the chain restarts from the genesis value
    const again = off.append("session:start", {});
    expect(again.seq).toBe(1);
    expect(again.prevLocalHash).toBe("offline:0000");
  });

  it("keeps the queue when an append fails during sync", () => {
    const off = new OfflineLedger();
    off.append("session:start", {});
    off.append("action:evaluate", {});
    class FlakyLedger extends EvidenceLedger {
      calls = 0;
      override append(...args: Parameters<EvidenceLedger["append"]>): ReturnType<EvidenceLedger["append"]> {
        this.calls++;
        if (this.calls === 2) throw new Error("write failed");
        return super.append(...args);
      }
    }
    const flaky = new FlakyLedger({ dir, sessionId: "flaky" });
    const result = off.sync(flaky);
    expect(result.synced).toBe(1);
    expect(result.errors).toEqual(["seq 2: write failed"]);
    expect(off.size()).toBe(2);
  });
});

describe("TimestampQueue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mints local tokens from the injected clock when no TSA is configured", async () => {
    const q = new TimestampQueue({}, { now: () => 1_000 });
    q.enqueue("h1");
    expect(q.getPending()).toBe(1);
    await q.flush();
    expect(q.getPending()).toBe(0);
    expect(q.getProcessed()).toBe(1);
    expect(q.getToken("h1")).toBe("local:" + sha("h1" + "1000").slice(0, 32));
    expect(q.getToken("unknown")).toBeUndefined();
  });

  it("processes at most batchSize entries per flush", async () => {
    const q = new TimestampQueue({ batchSize: 2 }, { now: () => 5 });
    for (const h of ["a", "b", "c"]) q.enqueue(h);
    await q.flush();
    expect(q.getPending()).toBe(1);
    expect(q.getProcessed()).toBe(2);
    await q.flush();
    expect(q.getPending()).toBe(0);
    expect(q.getToken("c")).toMatch(/^local:[0-9a-f]{32}$/);
    await q.flush();
    expect(q.getProcessed()).toBe(3);
  });

  it("posts to the TSA and uses a JSON token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: TsaFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const q = new TimestampQueue({ tsaUrl: "https://tsa.example.test/ts" }, { now: () => 42, fetchImpl });
    q.enqueue("deadbeef");
    await q.flush();
    expect(q.getToken("deadbeef")).toBe("tsa:abc");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://tsa.example.test/ts");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ hash: "deadbeef", algorithm: "sha256", requested_at: 42 });
  });

  it("keeps an already prefixed token and accepts timestamp_token", async () => {
    const replies = [{ token: "tsa:already" }, { timestamp_token: "alt" }];
    const fetchImpl: TsaFetch = async () =>
      new Response(JSON.stringify(replies.shift()), { headers: { "content-type": "application/json" } });
    const q = new TimestampQueue({ tsaUrl: "https://tsa.example.test" }, { fetchImpl });
    q.enqueue("one");
    q.enqueue("two");
    await q.flush();
    expect(q.getToken("one")).toBe("tsa:already");
    expect(q.getToken("two")).toBe("tsa:alt");
  });

  it("digests a binary TSA reply", async () => {
    const raw = Buffer.from([1, 2, 3, 4]);
    const fetchImpl: TsaFetch = async () =>
      new Response(raw, { headers: { "content-type": "application/timestamp-reply" } });
    const q = new TimestampQueue({ tsaUrl: "https://tsa.example.test" }, { fetchImpl });
    q.enqueue("bin");
    await q.flush();
    expect(q.getToken("bin")).toBe("tsa:" + sha(raw).slice(0, 32));
  });

  it("records tsa-failed instead of minting offline tokens when the TSA errors", async () => {
    const fetchImpl: TsaFetch = async () => new Response("nope", { status: 502 });
    const q = new TimestampQueue({ tsaUrl: "https://tsa.example.test" }, { fetchImpl });
    q.enqueue("h");
    await q.flush();
    expect(q.getToken("h")).toBe("tsa-failed:TSA rejected request: HTTP 502");

    const throwing: TsaFetch = async () => {
      throw new Error("connection refused");
    };
    const q2 = new TimestampQueue({ tsaUrl: "https://tsa.example.test" }, { fetchImpl: throwing });
    q2.enqueue("h2");
    await q2.flush();
    expect(q2.getToken("h2")).toBe("tsa-failed:connection refused");
  });

  it("auto flush runs on the configured interval until stopped", async () => {
    vi.useFakeTimers();
    const q = new TimestampQueue({ flushIntervalMs: 100 }, { now: () => 7 });
    q.startAutoFlush();
    q.startAutoFlush();
    q.enqueue("t1");
    await vi.advanceTimersByTimeAsync(100);
    expect(q.getProcessed()).toBe(1);
    q.stopAutoFlush();
    q.enqueue("t2");
    await vi.advanceTimersByTimeAsync(500);
    expect(q.getPending()).toBe(1);
  });
});
