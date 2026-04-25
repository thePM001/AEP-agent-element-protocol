import {
  generateQuantumKeyPair,
  quantumSign,
  quantumVerify,
} from "../../src/ledger/quantum.js";

describe("Post-Quantum Signatures (Simulated ML-DSA-65)", () => {
  it("generates a key pair with expected fields", () => {
    const kp = generateQuantumKeyPair();
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();
    expect(kp.algorithm).toBe("ml-dsa-65-sim");
    expect(kp.publicKey).not.toBe(kp.privateKey);
  });

  it("public key is derived from private key seed", () => {
    const kp = generateQuantumKeyPair();
    // publicKey is SHA-512 of the 32-byte seed, so 128 hex chars
    expect(kp.publicKey.length).toBe(128);
    // privateKey is 32 bytes hex, so 64 hex chars
    expect(kp.privateKey.length).toBe(64);
  });

  it("each generated pair is unique", () => {
    const kp1 = generateQuantumKeyPair();
    const kp2 = generateQuantumKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });

  it("signs data and returns signature object", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("hello world", kp.privateKey);
    expect(sig.signature).toBeDefined();
    expect(sig.algorithm).toBe("ml-dsa-65-sim");
    expect(sig.publicKey).toBe(kp.publicKey);
  });

  it("signature is HMAC-SHA512 (128 hex chars)", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("test data", kp.privateKey);
    expect(sig.signature.length).toBe(128);
  });

  it("verifies valid signature", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("test data", kp.privateKey);
    // quantumVerify takes (data, signature) only
    const valid = quantumVerify("test data", sig);
    expect(valid).toBe(true);
  });

  it("different data produces different signatures", () => {
    const kp = generateQuantumKeyPair();
    const sig1 = quantumSign("data1", kp.privateKey);
    const sig2 = quantumSign("data2", kp.privateKey);
    expect(sig1.signature).not.toBe(sig2.signature);
  });

  it("signature includes the correct public key", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("payload", kp.privateKey);
    expect(sig.publicKey).toBe(kp.publicKey);
  });

  it("rejects signature with wrong algorithm", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("data", kp.privateKey);
    // Tamper with the algorithm field
    const tampered = { ...sig, algorithm: "rsa-2048" };
    const valid = quantumVerify("data", tampered);
    expect(valid).toBe(false);
  });

  it("rejects signature with wrong length", () => {
    const kp = generateQuantumKeyPair();
    const sig = quantumSign("data", kp.privateKey);
    // Truncate the signature so length check fails
    const tampered = { ...sig, signature: sig.signature.substring(0, 64) };
    const valid = quantumVerify("data", tampered);
    expect(valid).toBe(false);
  });
});
