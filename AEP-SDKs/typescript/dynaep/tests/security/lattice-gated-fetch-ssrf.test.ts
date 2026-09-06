/**
 * AEP28-ENV-027: lattice gated fetch must resolve hosts, not only string prefixes.
 */
import { describe, it, expect } from "vitest";
import { assertUrlNotSsrf } from "../../src/transport/lattice-gated-fetch.js";

const denyEnv = {
  AEP_LATTICE_ALLOW_LOOPBACK: "0",
  AEP_LATTICE_ALLOW_PRIVATE: "0",
} as NodeJS.ProcessEnv;

describe("AEP28-ENV-027 SSRF resolve gate", () => {
  it("denies decimal IPv4 loopback without DNS", () => {
    expect(() =>
      assertUrlNotSsrf("http://2130706433/", () => {
        throw new Error("decimal must not DNS");
      }, denyEnv),
    ).toThrow(/loopback/);
  });

  it("denies IPv6 mapped loopback without DNS", () => {
    expect(() =>
      assertUrlNotSsrf("http://[::ffff:127.0.0.1]/", () => {
        throw new Error("literal must not DNS");
      }, denyEnv),
    ).toThrow(/loopback/);
  });

  it("denies userinfo host spoof", () => {
    expect(() =>
      assertUrlNotSsrf("http://evil.example@127.0.0.1/", () => {
        throw new Error("userinfo must not DNS");
      }, denyEnv),
    ).toThrow(/userinfo/);
  });

  it("denies DNS-to-private", () => {
    expect(() =>
      assertUrlNotSsrf("https://public.example/", () => ["10.1.2.3"], denyEnv),
    ).toThrow(/private/);
  });

  it("denies DNS mix of public and loopback", () => {
    expect(() =>
      assertUrlNotSsrf("https://rebind.example/", () => ["1.1.1.1", "127.0.0.1"], denyEnv),
    ).toThrow(/loopback/);
  });

  it("allows DNS-to-public", () => {
    expect(() =>
      assertUrlNotSsrf("https://public.example/", () => ["1.1.1.1"], denyEnv),
    ).not.toThrow();
  });

  it("allows public literal without DNS", () => {
    expect(() =>
      assertUrlNotSsrf("https://1.1.1.1/", () => {
        throw new Error("literal must not DNS");
      }, denyEnv),
    ).not.toThrow();
  });

  it("resolves localhost and denies loopback", () => {
    expect(() => assertUrlNotSsrf("http://localhost/", undefined, denyEnv)).toThrow(
      /loopback|DNS/,
    );
  });
});
