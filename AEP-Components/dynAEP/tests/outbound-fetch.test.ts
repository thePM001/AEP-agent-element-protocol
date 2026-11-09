import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { observerLatticeFetch } from "../observers/lib/outbound-fetch.js";
import {
  PUBLIC_TEST_HOST,
  createFakeFetch,
  installDevGate,
  jsonResponse,
  restoreAll,
  setEnv,
  type FakeFetch,
} from "./support/fakes.js";

describe("observerLatticeFetch", () => {
  let fake: FakeFetch;

  beforeEach(() => {
    fake = createFakeFetch(() => jsonResponse({ ok: true }));
    installDevGate(fake);
  });

  afterEach(() => {
    restoreAll();
  });

  it("forwards a public URL and the request init in dev mode", async () => {
    const url = `http://${PUBLIC_TEST_HOST}/orders`;
    const res = await observerLatticeFetch(url, { method: "GET", headers: { Accept: "application/json" } }, {
      adapter: "poll",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(url);
    expect(fake.calls[0]?.init).toEqual({ method: "GET", headers: { Accept: "application/json" } });
  });

  it("accepts a URL object and default arguments", async () => {
    await observerLatticeFetch(new URL(`https://${PUBLIC_TEST_HOST}/x?y=1`));
    expect(fake.calls[0]?.url).toBe(`https://${PUBLIC_TEST_HOST}/x?y=1`);
  });

  it.each([
    ["IPv6 loopback", "http://[::1]:9000/", /loopback blocked/],
    ["private range", "http://10.1.2.3/", /private\/metadata host blocked/],
    ["link-local metadata IP", "http://169.254.169.254/latest", /private\/metadata host blocked/],
    ["metadata hostname", "http://metadata.google.internal/", /private\/metadata host blocked/],
    ["IPv4 mapped loopback", "http://[::ffff:7f00:1]/", /loopback blocked/],
    ["decimal encoded loopback", "http://2130706433/", /loopback blocked/],
    ["non-http protocol", "file:///etc/hosts", /blocked protocol/],
    ["userinfo", `http://user:pw@${PUBLIC_TEST_HOST}/`, /userinfo/],
    ["garbage", "not a url", /invalid URL/],
  ])("refuses %s before any request", async (_label, url, message) => {
    await expect(observerLatticeFetch(url)).rejects.toThrow(message);
    expect(fake.calls).toHaveLength(0);
  });

  it("allows loopback only with the explicit env switch", async () => {
    setEnv("AEP_LATTICE_ALLOW_LOOPBACK", "1");
    await observerLatticeFetch("http://[::1]:9000/health");
    expect(fake.calls).toHaveLength(1);
  });

  it("refuses the strict kill switch without the dev flag", async () => {
    setEnv("AEP_LATTICE_STRICT_DEV", "");
    await expect(observerLatticeFetch(`http://${PUBLIC_TEST_HOST}/`)).rejects.toThrow(/fail-closed/);
    expect(fake.calls).toHaveLength(0);
  });
});
