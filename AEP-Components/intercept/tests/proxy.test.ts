import { describe, it, expect } from "vitest";
import { createInterceptProxy, type InterceptHooks } from "../lib/proxy.js";

class Counter {
  n = 0;
  label = "counter";
  inc(by: number): number {
    this.n += by;
    return this.n;
  }
}

type AuditEvent = Parameters<NonNullable<InterceptHooks["audit"]>>[0];

function method(p: object, name: string | symbol): (...args: unknown[]) => unknown {
  const fn: unknown = Reflect.get(p, name);
  if (typeof fn !== "function") throw new Error(`${String(name)} is not a function`);
  return (...args: unknown[]) => fn.apply(p, args);
}

describe("createInterceptProxy", () => {
  it("forwards allowed calls to the target and reports them", () => {
    const target = new Counter();
    const events: AuditEvent[] = [];
    const after: unknown[] = [];
    const p = createInterceptProxy(target, {
      beforeCall: () => true,
      afterCall: (prop, args, result) => after.push([prop, args, result]),
      audit: (e) => events.push(e),
    });
    expect(method(p, "inc")(2)).toBe(2);
    expect(method(p, "inc")(3)).toBe(5);
    expect(target.n).toBe(5);
    expect(after).toEqual([
      ["inc", [2], 2],
      ["inc", [3], 5],
    ]);
    expect(events.map((e) => e.phase)).toEqual(["get", "call", "get", "call"]);
    expect(events[1]).toEqual({ phase: "call", prop: "inc", args: [2] });
  });

  it("allows calls when beforeCall returns nothing", () => {
    const target = new Counter();
    const p = createInterceptProxy(target, { beforeCall: () => undefined });
    expect(method(p, "inc")(1)).toBe(1);
  });

  it("denies a call when beforeCall returns false", () => {
    const target = new Counter();
    const denied: Array<[string | symbol, unknown[]]> = [];
    const events: AuditEvent[] = [];
    const p = createInterceptProxy(target, {
      beforeCall: (prop, args) => !(prop === "inc" && Number(args[0]) > 10),
      onDenied: (prop, args) => denied.push([prop, args]),
      audit: (e) => events.push(e),
    });
    expect(() => method(p, "inc")(50)).toThrow("intercept denied call to inc (policy hook)");
    expect(target.n).toBe(0);
    expect(denied).toEqual([["inc", [50]]]);
    expect(events.at(-1)).toEqual({ phase: "deny", prop: "inc", args: [50] });
    expect(method(p, "inc")(4)).toBe(4);
  });

  it("returns plain properties and audits writes", () => {
    const target = new Counter();
    const events: AuditEvent[] = [];
    const p = createInterceptProxy(target, { audit: (e) => events.push(e) });
    expect(Reflect.get(p, "label")).toBe("counter");
    expect(Reflect.set(p, "label", "renamed")).toBe(true);
    expect(target.label).toBe("renamed");
    expect(events).toEqual([
      { phase: "get", prop: "label" },
      { phase: "set", prop: "label" },
    ]);
  });

  it("handles symbol keys and works with no hooks", () => {
    const tag = Symbol("tag");
    const target = { [tag]: () => "tagged" };
    const p = createInterceptProxy(target);
    expect(method(p, tag)()).toBe("tagged");
  });

  it("keeps an explicit receiver other than the proxy", () => {
    const target = new Counter();
    const other = new Counter();
    const p = createInterceptProxy(target);
    const fn: unknown = Reflect.get(p, "inc");
    if (typeof fn !== "function") throw new Error("inc missing");
    expect(fn.call(other, 7)).toBe(7);
    expect(other.n).toBe(7);
    expect(target.n).toBe(0);
  });
});
