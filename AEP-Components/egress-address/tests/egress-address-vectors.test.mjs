// The shared egress vectors run against the shared module and against every JavaScript
// helper that checks an outbound address. No URL row needs a name lookup, so a row that
// asks for one gets the verdict "lookup" and fails.
import { describe, expect, it } from "vitest";
import { assertUrlNotSsrf as transportCheck } from "../../lattice-channels/lib/lattice-transport.mjs";
import { assertUrlNotSsrf as gatedFetchCheck } from "../../lattice-channels/lib/lattice-gated-fetch.mjs";
import { checkResolved, parseIpv4, parseIpv6 } from "../lib/egress-address.mjs";
import { loadEgressVectors, runEgressVectors } from "../lib/egress-vectors.mjs";

const vectors = loadEgressVectors();

function noLookup(host) {
  throw new Error(`vector row asked for a name lookup of ${host}`);
}

function verdictOf(check, url) {
  try {
    check(url, noLookup, {});
    return "allow";
  } catch (err) {
    if (String(err && err.message).includes("vector row asked")) return "lookup";
    return "deny";
  }
}

describe("egress vectors", () => {
  it("egress-address.mjs gives every address and url row its answer", () => {
    expect(runEgressVectors(vectors)).toEqual([]);
  });

  for (const [name, check] of [
    ["lattice-transport.mjs", transportCheck],
    ["lattice-gated-fetch.mjs", gatedFetchCheck],
  ]) {
    it(`${name} gives every url row its verdict`, () => {
      const wrong = vectors.urls.filter((row) => verdictOf(check, row.url) !== row.verdict).map((row) => row.url);
      expect(wrong).toEqual([]);
    });
  }
});

describe("address parsing", () => {
  it("reads every IPv4 spelling of the URL standard", () => {
    for (const text of ["127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "127.1", "0x7f.1", "127.0.0.1."]) {
      expect(parseIpv4(text)).toBe(0x7f000001);
    }
    for (const text of ["256.0.0.1", "1.2.3.4.5", "example.com", "", "1.2.3.4x", "1.2.3.256"]) {
      expect(parseIpv4(text)).toBeNull();
    }
  });

  it("reads IPv6 with brackets, a zone and an IPv4 tail", () => {
    expect(parseIpv6("[::1]")).toBe(1n);
    expect(parseIpv6("fe80::1%eth0")).toBe((0xfe80n << 112n) | 1n);
    expect(parseIpv6("::ffff:127.0.0.1")).toBe((0xffffn << 32n) | 0x7f000001n);
    for (const text of ["1::2::3", "12345::1", "1:2:3:4:5:6:7:8:9", "::g", "127.0.0.1"]) {
      expect(parseIpv6(text)).toBeNull();
    }
  });

  it("reads a bare 0x part as zero, as the URL standard does", () => {
    expect(parseIpv4("1.2.3.0x")).toBe(0x01020300);
  });

  it("refuses a lookup when one answer is refused", () => {
    const strict = { allowLoopback: false, allowPrivate: false };
    expect(checkResolved(["1.1.1.1", "1.1.1.1"], strict)).toEqual(["1.1.1.1"]);
    expect(() => checkResolved(["1.1.1.1", "100.64.0.9"], strict)).toThrow(/shared/);
    expect(() => checkResolved([], strict)).toThrow(/no address/);
  });
});
