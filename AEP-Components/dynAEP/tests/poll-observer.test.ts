import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollObserverAdapter, type PollObserverConfig } from "../observers/poll/index.js";
import type { LatticeEvent } from "../observers/interface.js";
import {
  PUBLIC_TEST_HOST,
  createFakeFetch,
  installDevGate,
  jsonResponse,
  quietConsole,
  restoreAll,
  settle,
  type FakeFetch,
  type QuietConsole,
} from "./support/fakes.js";

const URL_ORDERS = `http://${PUBLIC_TEST_HOST}/orders`;
const NOW = 1_700_000_000_000;

/** Serve the bodies in order; the last one repeats. */
function serving(...bodies: Array<unknown | Response>): FakeFetch {
  return createFakeFetch((_call, i) => {
    const body = bodies[Math.min(i, bodies.length - 1)];
    return body instanceof Response ? body : jsonResponse(body);
  });
}

describe("PollObserverAdapter", () => {
  let out: QuietConsole;
  let events: LatticeEvent[];
  let adapter: PollObserverAdapter | null;

  function make(fake: FakeFetch, cfg: Partial<PollObserverConfig> = {}): PollObserverAdapter {
    installDevGate(fake);
    adapter = new PollObserverAdapter({ url: URL_ORDERS, intervalMs: 1_000, ...cfg });
    adapter.onEvent((e) => events.push(e));
    return adapter;
  }

  async function tick(ms = 1_000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(NOW);
    out = quietConsole();
    events = [];
    adapter = null;
  });

  afterEach(async () => {
    await adapter?.stop();
    restoreAll();
  });

  it("derives name and source from the URL host", () => {
    const a = make(serving({}));
    expect(a.name).toBe(`poll:${PUBLIC_TEST_HOST}`);
    expect(new PollObserverAdapter({ url: "::bad::" }).name).toBe("poll:unknown");
    expect(new PollObserverAdapter({ url: URL_ORDERS, name: "orders" }).name).toBe("orders");
  });

  it("captures a first snapshot, ignores unchanged polls and emits on change", async () => {
    const fake = serving({ v: 1 }, { v: 1 }, { v: 2 });
    const a = make(fake);
    await a.start();
    await settle();
    expect(fake.calls).toHaveLength(1);
    expect(events).toHaveLength(0);

    await tick();
    expect(fake.calls).toHaveLength(2);
    expect(events).toHaveLength(0);

    vi.setSystemTime(NOW + 5_000);
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      source: `poll:${PUBLIC_TEST_HOST}`,
      action_path: "poll:change",
      payload: { previous: { v: 1 }, current: { v: 2 }, polled_at: NOW + 6_000 },
      bridge_timestamp: NOW + 6_000,
    });
  });

  it("sends GET with JSON accept and custom headers", async () => {
    const fake = serving({});
    await make(fake, { headers: { Authorization: "Bearer test" } }).start();
    const init = fake.calls[0]?.init;
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({ Accept: "application/json", Authorization: "Bearer test" });
  });

  it("uses custom action path and source", async () => {
    const fake = serving({ a: 1 }, { a: 2 });
    await make(fake, { actionPath: "orders:diff", source: "erp" }).start();
    await tick();
    expect(events[0]?.action_path).toBe("orders:diff");
    expect(events[0]?.source).toBe("erp");
  });

  it("array mode emits added, removed and modified events keyed by idKey", async () => {
    const fake = serving(
      [{ orderId: 1, s: "new" }, { orderId: 2, s: "new" }, "skip-me", { noId: true }],
      [{ orderId: 2, s: "paid" }, { orderId: 3, s: "new" }],
    );
    await make(fake, { mode: "array", idKey: "orderId" }).start();
    await tick();
    const byPath = Object.fromEntries(events.map((e) => [e.action_path, e.payload]));
    expect(Object.keys(byPath).sort()).toEqual(["poll:change:added", "poll:change:modified", "poll:change:removed"]);
    expect(byPath["poll:change:added"]).toMatchObject({ orderId: "3", element: { orderId: 3, s: "new" } });
    expect(byPath["poll:change:removed"]).toMatchObject({ orderId: "1", element: { orderId: 1, s: "new" } });
    expect(byPath["poll:change:modified"]).toMatchObject({
      orderId: "2",
      previous: { orderId: 2, s: "new" },
      current: { orderId: 2, s: "paid" },
    });
  });

  it("array mode handles ids that collide with Object.prototype keys", async () => {
    const fake = serving([{ id: "constructor" }, { id: "toString", v: 1 }], [{ id: "toString", v: 1 }]);
    await make(fake, { mode: "array" }).start();
    await tick();
    expect(events.map((e) => e.action_path)).toEqual(["poll:change:removed"]);
    expect(events[0]?.payload.id).toBe("constructor");
  });

  it("array mode falls back to a full diff when the previous snapshot was not an array", async () => {
    const fake = serving({ items: [] }, [{ id: 1 }]);
    await make(fake, { mode: "array" }).start();
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]?.action_path).toBe("poll:change");
    expect(out.errors).toEqual([]);
  });

  it("treats an empty array and an empty object as different", async () => {
    const fake = serving([], {});
    await make(fake).start();
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ previous: [], current: {} });
  });

  it("a null first response still counts as the initial snapshot", async () => {
    const fake = serving(null, { ready: true });
    await make(fake).start();
    await tick();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ previous: null, current: { ready: true } });
  });

  it("deep comparison ignores key order but sees nested changes", async () => {
    const fake = serving({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }, { b: { c: [1, 3] }, a: 1 });
    await make(fake).start();
    await tick();
    expect(events).toHaveLength(0);
    await tick();
    expect(events).toHaveLength(1);
  });

  it("logs HTTP errors without emitting or replacing the snapshot", async () => {
    const fake = serving({ v: 1 }, new Response("down", { status: 503, statusText: "Service Unavailable" }), { v: 1 });
    await make(fake).start();
    await tick();
    expect(out.errors.join("\n")).toMatch(/HTTP 503 Service Unavailable/);
    await tick();
    expect(events).toHaveLength(0);
  });

  it("logs gate refusals instead of throwing", async () => {
    const fake = serving({});
    const a = make(fake, { url: "http://10.0.0.5/data" });
    await expect(a.start()).resolves.toBeUndefined();
    expect(fake.calls).toHaveLength(0);
    expect(out.errors.join("\n")).toMatch(/Poll error: .*private/);
  });

  it("start is idempotent and stop halts polling", async () => {
    const fake = serving({ v: 1 });
    const a = make(fake);
    await a.start();
    await a.start();
    expect(fake.calls).toHaveLength(1);
    await tick();
    expect(fake.calls).toHaveLength(2);
    await a.stop();
    await a.stop();
    await tick(5_000);
    expect(fake.calls).toHaveLength(2);
  });

  it("an external abort signal stops polling", async () => {
    const fake = serving({ v: 1 });
    const controller = new AbortController();
    await make(fake, { signal: controller.signal }).start();
    controller.abort();
    await tick(5_000);
    expect(fake.calls).toHaveLength(1);
    expect(out.logs.join("\n")).toMatch(/Polling stopped/);
  });

  it("onEvent replaces the previous callback", async () => {
    const fake = serving({ v: 1 }, { v: 2 });
    const a = make(fake);
    const second: LatticeEvent[] = [];
    a.onEvent((e) => second.push(e));
    await a.start();
    await tick();
    expect(events).toHaveLength(0);
    expect(second).toHaveLength(1);
  });
});
