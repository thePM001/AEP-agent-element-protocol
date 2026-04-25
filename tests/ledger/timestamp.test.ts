import { TimestampQueue } from "../../src/ledger/timestamp.js";

describe("TimestampQueue", () => {
  it("starts with zero pending and processed", () => {
    const queue = new TimestampQueue({ batchSize: 5, flushIntervalMs: 60000 });
    expect(queue.getPending()).toBe(0);
    expect(queue.getProcessed()).toBe(0);
  });

  it("enqueues entries and tracks pending count", () => {
    const queue = new TimestampQueue({ batchSize: 5, flushIntervalMs: 60000 });
    queue.enqueue("hash1");
    queue.enqueue("hash2");
    expect(queue.getPending()).toBe(2);
  });

  it("getToken returns undefined before flush", () => {
    const queue = new TimestampQueue({ batchSize: 5, flushIntervalMs: 60000 });
    queue.enqueue("hash1");
    expect(queue.getToken("hash1")).toBeUndefined();
  });

  it("flush produces tokens for enqueued hashes", async () => {
    const queue = new TimestampQueue({ batchSize: 5, flushIntervalMs: 60000 });
    queue.enqueue("hash-a");
    queue.enqueue("hash-b");

    await queue.flush();

    const tokenA = queue.getToken("hash-a");
    const tokenB = queue.getToken("hash-b");
    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    expect(typeof tokenA).toBe("string");
  });

  it("flush with no TSA URL produces local tokens", async () => {
    const queue = new TimestampQueue({ batchSize: 5 });
    queue.enqueue("local-hash");

    await queue.flush();

    const token = queue.getToken("local-hash");
    expect(token).toBeDefined();
    expect(token!.startsWith("local:")).toBe(true);
  });

  it("flush with TSA URL falls back to offline token", async () => {
    const queue = new TimestampQueue({
      batchSize: 5,
      tsaUrl: "http://unreachable.invalid/tsa",
    });
    queue.enqueue("tsa-hash");

    await queue.flush();

    const token = queue.getToken("tsa-hash");
    expect(token).toBeDefined();
    // Should get offline fallback since the URL is unreachable
    expect(token!.startsWith("offline:")).toBe(true);
  });

  it("flush moves entries from pending to processed", async () => {
    const queue = new TimestampQueue({ batchSize: 10, flushIntervalMs: 60000 });
    queue.enqueue("p1");
    queue.enqueue("p2");
    expect(queue.getPending()).toBe(2);
    expect(queue.getProcessed()).toBe(0);

    await queue.flush();

    expect(queue.getPending()).toBe(0);
    expect(queue.getProcessed()).toBe(2);
  });

  it("flush respects batch size", async () => {
    const queue = new TimestampQueue({ batchSize: 2, flushIntervalMs: 60000 });
    queue.enqueue("b1");
    queue.enqueue("b2");
    queue.enqueue("b3");

    await queue.flush();

    // Only 2 should have been processed (batch size)
    expect(queue.getProcessed()).toBe(2);
    expect(queue.getPending()).toBe(1);
  });

  it("multiple flushes process remaining entries", async () => {
    const queue = new TimestampQueue({ batchSize: 1, flushIntervalMs: 60000 });
    queue.enqueue("m1");
    queue.enqueue("m2");

    await queue.flush();
    expect(queue.getProcessed()).toBe(1);

    await queue.flush();
    expect(queue.getProcessed()).toBe(2);
    expect(queue.getPending()).toBe(0);
  });

  it("flushing empty queue is a no-op", async () => {
    const queue = new TimestampQueue({ batchSize: 5, flushIntervalMs: 60000 });
    await queue.flush();
    expect(queue.getProcessed()).toBe(0);
  });

  it("start and stop auto-flush", async () => {
    const queue = new TimestampQueue({ batchSize: 100, flushIntervalMs: 50 });
    queue.startAutoFlush();
    queue.enqueue("auto1");

    // Wait for auto-flush interval to fire
    await new Promise((r) => setTimeout(r, 120));
    queue.stopAutoFlush();

    const token = queue.getToken("auto1");
    expect(token).toBeDefined();
  });

  it("stopAutoFlush is safe to call without start", () => {
    const queue = new TimestampQueue({ batchSize: 5 });
    // Should not throw
    queue.stopAutoFlush();
  });

  it("startAutoFlush called twice does not create duplicate timers", async () => {
    const queue = new TimestampQueue({ batchSize: 100, flushIntervalMs: 50 });
    queue.startAutoFlush();
    queue.startAutoFlush();
    queue.enqueue("dup-check");

    await new Promise((r) => setTimeout(r, 120));
    queue.stopAutoFlush();

    // Should still work normally with just one timer
    expect(queue.getToken("dup-check")).toBeDefined();
  });
});
