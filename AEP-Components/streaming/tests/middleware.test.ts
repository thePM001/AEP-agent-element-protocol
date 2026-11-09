import { afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StreamMiddleware } from "../lib/middleware.js";
import { AEPStreamValidator } from "../lib/validator.js";
import { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function source(chunks: string[], opts: { failAt?: number } = {}): { stream: ReadableStream<string>; cancelled: () => boolean } {
  let cancelled = false;
  let i = 0;
  const stream = new ReadableStream<string>({
    pull(controller) {
      if (opts.failAt === i) {
        controller.error(new Error("upstream broke"));
        return;
      }
      const c = chunks[i++];
      if (c === undefined) controller.close();
      else controller.enqueue(c);
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, cancelled: () => cancelled };
}

async function drain(stream: ReadableStream<string>): Promise<{ chunks: string[]; error: Error | null }> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { chunks, error: null };
      chunks.push(value);
    }
  } catch (e) {
    return { chunks, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

const forbidBad = () =>
  new AEPStreamValidator({ covenant: { name: "guard", rules: [{ type: "forbid", action: "bad", conditions: [] }] } });

describe("StreamMiddleware.wrap", () => {
  it("passes clean chunks through unchanged", async () => {
    const src = source(["hel", "lo", " world"]);
    const out = await drain(StreamMiddleware.wrap(src.stream, forbidBad()));
    expect(out).toEqual({ chunks: ["hel", "lo", " world"], error: null });
  });

  it("errors the stream, cancels upstream and logs to the ledger on a violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aep-"));
    dirs.push(dir);
    const ledger = new EvidenceLedger({ dir, sessionId: "stream-test" });
    const src = source(["ok ", "ba", "d", "never"]);
    const out = await drain(StreamMiddleware.wrap(src.stream, forbidBad(), ledger));
    expect(out.chunks).toEqual(["ok ", "ba"]);
    expect(out.error?.message).toBe('AEP stream aborted: covenant:forbid:bad - Covenant "guard" forbids "bad"');
    expect(src.cancelled()).toBe(true);
    const entries = ledger.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("stream:abort");
    expect(entries[0]?.data).toEqual({
      accumulated: "ok bad",
      violationAt: 5,
      rule: "covenant:forbid:bad",
      reason: 'Covenant "guard" forbids "bad"',
    });
  });

  it("aborts without a ledger too", async () => {
    const out = await drain(StreamMiddleware.wrap(source(["bad"]).stream, forbidBad()));
    expect(out.chunks).toEqual([]);
    expect(out.error?.message).toMatch(/^AEP stream aborted/);
  });

  it("propagates an upstream error", async () => {
    const out = await drain(StreamMiddleware.wrap(source(["a", "b"], { failAt: 1 }).stream, forbidBad()));
    expect(out.chunks).toEqual(["a"]);
    expect(out.error?.message).toBe("upstream broke");
  });

  it("cancels upstream when the consumer cancels", async () => {
    const src = source(["a", "b", "c"]);
    const wrapped = StreamMiddleware.wrap(src.stream, forbidBad());
    const reader = wrapped.getReader();
    expect((await reader.read()).value).toBe("a");
    await reader.cancel("enough");
    await new Promise((r) => setTimeout(r, 0));
    expect(src.cancelled()).toBe(true);
  });
});
