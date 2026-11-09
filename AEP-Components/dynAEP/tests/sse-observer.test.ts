import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSEConsumerAdapter, type SSEConsumerConfig } from "../observers/sse/index.js";
import type { LatticeEvent } from "../observers/interface.js";
import {
  PUBLIC_TEST_HOST,
  createFakeFetch,
  installDevGate,
  quietConsole,
  restoreAll,
  settle,
  type FakeCall,
  type FakeFetch,
  type QuietConsole,
} from "./support/fakes.js";

const URL_STREAM = `http://${PUBLIC_TEST_HOST}/stream`;
const NOW = 1_700_000_000_000;
const realRandom = Math.random;

/** A server-sent event stream the test writes into. Aborting the request errors it. */
class FakeStream {
  readonly body: ReadableStream<Uint8Array>;
  private ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly enc = new TextEncoder();

  constructor(signal: AbortSignal | null | undefined) {
    this.body = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.ctrl = c;
      },
    });
    signal?.addEventListener("abort", () => this.ctrl?.error(new Error("aborted")), { once: true });
  }

  push(text: string): void {
    this.ctrl?.enqueue(this.enc.encode(text));
  }

  end(): void {
    this.ctrl?.close();
  }
}

interface StreamServer {
  fake: FakeFetch;
  streams: FakeStream[];
}

/** Each request gets a fresh stream unless `fail` says to answer with an HTTP error. */
function streamServer(fail: (index: number) => number | null = () => null): StreamServer {
  const streams: FakeStream[] = [];
  const fake = createFakeFetch((call: FakeCall, index: number) => {
    const status = fail(index);
    if (status !== null) return new Response("nope", { status, statusText: "Err" });
    const stream = new FakeStream(call.init.signal);
    streams.push(stream);
    return new Response(stream.body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  });
  return { fake, streams };
}

describe("SSEConsumerAdapter", () => {
  let out: QuietConsole;
  let events: LatticeEvent[];
  let adapter: SSEConsumerAdapter | null;

  async function startWith(server: StreamServer, cfg: Partial<SSEConsumerConfig> = {}): Promise<SSEConsumerAdapter> {
    installDevGate(server.fake);
    adapter = new SSEConsumerAdapter({ url: URL_STREAM, reconnectBaseMs: 100, maxReconnectMs: 1_000, ...cfg });
    adapter.onEvent((e) => events.push(e));
    await adapter.start();
    await settle();
    return adapter;
  }

  function stream(server: StreamServer, i = 0): FakeStream {
    const s = server.streams[i];
    if (!s) throw new Error(`no stream ${i}`);
    return s;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    out = quietConsole();
    events = [];
    adapter = null;
  });

  afterEach(async () => {
    await adapter?.stop();
    Math.random = realRandom;
    restoreAll();
  });

  it("derives its name from the URL host", () => {
    expect(new SSEConsumerAdapter({ url: URL_STREAM }).name).toBe(`sse:${PUBLIC_TEST_HOST}`);
    expect(new SSEConsumerAdapter({ url: "nope" }).name).toBe("sse:unknown");
    expect(new SSEConsumerAdapter({ url: URL_STREAM, name: "feed" }).name).toBe("feed");
  });

  it("requests an event stream with an abort signal", async () => {
    const server = streamServer();
    await startWith(server);
    const init = server.fake.calls[0]?.init;
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Accept: "text/event-stream", "Cache-Control": "no-cache" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns typed JSON messages into lattice events", async () => {
    const server = streamServer();
    await startWith(server, { typeToActionPath: { order: "market:order:new" }, source: "exchange" });
    stream(server).push('event: order\ndata: {"id":1}\nid: 7\n\nevent: fill\ndata: {"id":2}\n\n');
    await settle();
    expect(events).toEqual([
      { source: "exchange", action_path: "market:order:new", payload: { id: 1 }, bridge_timestamp: NOW },
      { source: "exchange", action_path: "fill", payload: { id: 2 }, bridge_timestamp: NOW },
    ]);
  });

  it("wraps text data and uses the default action path", async () => {
    const server = streamServer();
    await startWith(server, { defaultActionPath: "feed:msg" });
    stream(server).push("id: 42\ndata: hello world\n\n");
    await settle();
    expect(events[0]).toMatchObject({
      source: `sse:${PUBLIC_TEST_HOST}`,
      action_path: "feed:msg",
      payload: { text: "hello world", event_id: "42" },
    });
  });

  it("reassembles messages split across chunks", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).push("data: hel");
    await settle();
    expect(events).toHaveLength(0);
    stream(server).push("lo\n");
    stream(server).push("\n");
    await settle();
    expect(events[0]?.payload).toMatchObject({ text: "hello" });
  });

  it("accepts CRLF line endings", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).push('event: ping\r\ndata: {"a":1}\r\n\r\n');
    await settle();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action_path: "ping", payload: { a: 1 } });
  });

  it("joins multiple data lines with a newline", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).push("data: line one\ndata: line two\n\n");
    await settle();
    expect(events[0]?.payload).toMatchObject({ text: "line one\nline two" });
  });

  it("keeps non-object JSON as text so the payload is always an object", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).push("data: 42\n\ndata: [1,2]\n\ndata: null\n\n");
    await settle();
    expect(events.map((e) => e.payload)).toEqual([
      { text: "42", event_id: "" },
      { text: "[1,2]", event_id: "" },
      { text: "null", event_id: "" },
    ]);
  });

  it("skips comments and heartbeats", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).push(": keepalive\n\n\n\nretry: 5000\n\n");
    await settle();
    expect(events).toHaveLength(0);
  });

  it("reconnects with backoff after an HTTP error", async () => {
    const server = streamServer((i) => (i === 0 ? 503 : null));
    await startWith(server);
    expect(server.fake.calls).toHaveLength(1);
    expect(out.errors.join("\n")).toMatch(/HTTP 503/);
    // attempt 1 failed: delay = 100 * 2^1 = 200ms with +/-20% jitter
    await vi.advanceTimersByTimeAsync(150);
    expect(server.fake.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(server.fake.calls).toHaveLength(2);
    stream(server).push("data: back\n\n");
    await settle();
    expect(events[0]?.payload).toMatchObject({ text: "back" });
  });

  it("caps the backoff at maxReconnectMs", async () => {
    // Pin the jitter factor to exactly 1.0 so every delay is min(400 * 2^n, 500) = 500ms.
    // afterEach puts the real Math.random back.
    Math.random = () => 0.5;
    const server = streamServer(() => 500);
    await startWith(server, { reconnectBaseMs: 400, maxReconnectMs: 500 });
    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(600);
      await settle();
    }
    // Requests at 0, 500, 1000, 1500, 2000 ms. Uncapped doubling would give 0, 800, 2400.
    expect(server.fake.calls).toHaveLength(5);
  });

  it("reconnects when the stream ends", async () => {
    const server = streamServer();
    await startWith(server);
    stream(server).end();
    await settle();
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(server.fake.calls).toHaveLength(2);
    expect(out.logs.join("\n")).toMatch(/Stream ended/);
  });

  it("stop aborts the request and cancels reconnects", async () => {
    const server = streamServer();
    const a = await startWith(server);
    await a.stop();
    await a.stop();
    await settle();
    expect(server.fake.calls[0]?.init.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(server.fake.calls).toHaveLength(1);
    expect(out.errors).toEqual([]);
  });

  it("an external abort stops the consumer instead of looping", async () => {
    const server = streamServer();
    const controller = new AbortController();
    await startWith(server, { signal: controller.signal });
    controller.abort();
    await settle();
    await vi.advanceTimersByTimeAsync(5_000);
    await settle();
    expect(server.fake.calls).toHaveLength(1);
    expect(server.fake.calls[0]?.init.signal?.aborted).toBe(true);
  });

  it("does not connect when the external signal is already aborted", async () => {
    const server = streamServer();
    const controller = new AbortController();
    controller.abort();
    await startWith(server, { signal: controller.signal });
    expect(server.fake.calls).toHaveLength(0);
  });

  it("start is idempotent", async () => {
    const server = streamServer();
    const a = await startWith(server);
    await a.start();
    await settle();
    expect(server.fake.calls).toHaveLength(1);
  });
});
