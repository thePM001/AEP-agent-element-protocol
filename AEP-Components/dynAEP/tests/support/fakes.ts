// Test helpers shared by the observer tests. No network: global fetch is
// replaced by an in-memory fake and the lattice gate runs in dev mode
// (AEP_LATTICE_STRICT=0 with AEP_LATTICE_STRICT_DEV=1), so it performs the
// SSRF checks and then hands the request to the fake.
import { vi } from "vitest";

/** Public documentation range (TEST-NET-3): classified public, never contacted. */
export const PUBLIC_TEST_HOST = "203.0.113.10";

export interface FakeCall {
  url: string;
  init: RequestInit;
}

export type FakeResponder = (call: FakeCall, index: number) => Response | Promise<Response>;

export interface FakeFetch {
  calls: FakeCall[];
  fn: typeof fetch;
}

export function createFakeFetch(responder: FakeResponder): FakeFetch {
  const calls: FakeCall[] = [];
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const call: FakeCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call, calls.length - 1);
  };
  return { calls, fn };
}

const savedEnv = new Map<string, string | undefined>();
let savedFetch: typeof fetch | null = null;
let savedLog: typeof console.log | null = null;
let savedError: typeof console.error | null = null;

/** Set an env var for the current test; restoreAll() puts the old value back. */
export function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

/** Run the lattice gate in dev mode and route its fetch to the fake. */
export function installDevGate(fake: FakeFetch): void {
  setEnv("AEP_LATTICE_STRICT", "0");
  setEnv("AEP_LATTICE_STRICT_DEV", "1");
  setEnv("AEP_LATTICE_ALLOW_LOOPBACK", "");
  setEnv("AEP_LATTICE_ALLOW_PRIVATE", "");
  if (savedFetch === null) savedFetch = globalThis.fetch;
  globalThis.fetch = fake.fn;
}

export interface QuietConsole {
  logs: string[];
  errors: string[];
}

/** Silence adapter logging while keeping the lines for assertions. */
export function quietConsole(): QuietConsole {
  const captured: QuietConsole = { logs: [], errors: [] };
  const fmt = (args: unknown[]): string => args.map(String).join(" ");
  if (savedLog === null) savedLog = console.log;
  if (savedError === null) savedError = console.error;
  console.log = (...args: unknown[]) => {
    captured.logs.push(fmt(args));
  };
  console.error = (...args: unknown[]) => {
    captured.errors.push(fmt(args));
  };
  return captured;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Let pending promise chains (fetch, body reads) run to completion. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function restoreAll(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  if (savedFetch !== null) globalThis.fetch = savedFetch;
  if (savedLog !== null) console.log = savedLog;
  if (savedError !== null) console.error = savedError;
  savedFetch = null;
  savedLog = null;
  savedError = null;
  vi.useRealTimers();
}
