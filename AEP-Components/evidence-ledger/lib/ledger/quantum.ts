import { createHash, createHmac, randomBytes } from "node:crypto";

// ML-DSA-65 simulation using HMAC-based signatures
// Real ML-DSA-65 (FIPS 204) requires a native library.
// This provides the interface and falls back to HMAC-SHA512 for testing.

export interface QuantumKeyPair {
  publicKey: string;
  privateKey: string;
  algorithm: string;
}

export interface QuantumSignature {
  signature: string;
  algorithm: string;
  publicKey: string;
}

export function generateQuantumKeyPair(): QuantumKeyPair {
  const seed = randomBytes(32);
  const privateKey = seed.toString("hex");
  const publicKey = createHash("sha512").update(seed).digest("hex");
  return { publicKey, privateKey, algorithm: "ml-dsa-65-sim" };
}

export function quantumSign(data: string, privateKey: string): QuantumSignature {
  const publicKey = createHash("sha512").update(Buffer.from(privateKey, "hex")).digest("hex");
  const sig = createHmac("sha512", Buffer.from(publicKey, "hex"))
    .update(data)
    .digest("hex");
  return { signature: sig, algorithm: "ml-dsa-65-sim", publicKey };
}

export function quantumVerify(data: string, signature: QuantumSignature): boolean {
  if (signature.algorithm !== "ml-dsa-65-sim") return false;
  if (signature.signature.length !== 128) return false;
  if (!signature.publicKey || signature.publicKey.length !== 128) return false;
  try {
    const expected = createHmac("sha512", Buffer.from(signature.publicKey, "hex"))
      .update(data)
      .digest("hex");
    return expected === signature.signature;
  } catch {
    return false;
  }
}
