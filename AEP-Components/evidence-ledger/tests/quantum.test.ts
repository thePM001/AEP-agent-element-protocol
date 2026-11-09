// Only the input checks that run before the aep-ml-dsa binary is resolved are
// tested here: CI has no Rust binary, and tests must not start processes.
import { describe, it, expect } from "vitest";
import { ML_DSA_65, quantumSign, quantumVerify, quantumVerifySim } from "../lib/ledger/quantum.js";

const hex = (n: number): string => "ab".repeat(n);

describe("quantumSign input validation", () => {
  it("rejects a non-hex private key", () => {
    expect(() => quantumSign("msg", "not-hex!", hex(8))).toThrow(/privateKey must be non-empty hex/);
  });

  it("rejects an empty private key", () => {
    expect(() => quantumSign("msg", "   ", hex(8))).toThrow(/privateKey must be non-empty hex/);
  });

  it("requires a public key when the private key is not in combined form", () => {
    expect(() => quantumSign("msg", hex(8))).toThrow(/publicKey hex is required/);
  });

  it("rejects a non-hex public half in combined public:secret form", () => {
    expect(() => quantumSign("msg", "zz:" + hex(8))).toThrow(/publicKey hex is required/);
  });
});

describe("quantumVerify fail-closed checks", () => {
  const good = { signature: hex(100), algorithm: ML_DSA_65, publicKey: hex(90) };

  it("rejects other algorithms", () => {
    expect(quantumVerify("m", { ...good, algorithm: "Ed25519" })).toBe(false);
    expect(quantumVerify("m", { ...good, algorithm: "" })).toBe(false);
  });

  it("rejects empty or non-hex signature and key", () => {
    expect(quantumVerify("m", { ...good, signature: "" })).toBe(false);
    expect(quantumVerify("m", { ...good, publicKey: "" })).toBe(false);
    expect(quantumVerify("m", { ...good, signature: "xyz" })).toBe(false);
    expect(quantumVerify("m", { ...good, publicKey: "xyz" })).toBe(false);
  });

  it("rejects the legacy HMAC simulation fingerprint shape", () => {
    expect(quantumVerify("m", { signature: hex(64), algorithm: "mldsa65", publicKey: hex(64) })).toBe(false);
  });

  it("keeps the Sim alias pointing at the real verifier", () => {
    expect(quantumVerifySim).toBe(quantumVerify);
  });
});
