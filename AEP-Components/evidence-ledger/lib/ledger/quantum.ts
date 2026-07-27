// @PAD: p0-v275-c3-quantum-mldsa65-real-v1
// @GCDE: document_sha256=p0-v275-c3-real-ml-dsa-65
// Real ML-DSA-65 (FIPS 204) via aep-lattice-crypto / aep-ml-dsa CLI (pqcrypto-mldsa).
// No HMAC sim. No AEP_ALLOW_QUANTUM_SIM gate. Public-key-only verify is supported.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Wire algorithm label matches aep-lattice-crypto SIGNATURE_LABEL. */
export const ML_DSA_65 = "ML-DSA-65";

function isMlDsa65(algo: string | undefined): boolean {
  if (!algo) return false;
  const a = algo.trim().toLowerCase();
  return a === "ml-dsa-65" || a === "mldsa65";
}

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

function hereDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/** Resolve aep-ml-dsa binary: env override, PATH, then cargo target paths. */
export function resolveAepMlDsaBinary(): string {
  const env = process.env.AEP_ML_DSA_BIN?.trim();
  if (env && existsSync(env)) return env;

  const candidates = [
    "aep-ml-dsa",
    join(process.cwd(), "rust/target/debug/aep-ml-dsa"),
    join(process.cwd(), "rust/target/release/aep-ml-dsa"),
    join(process.cwd(), "target/debug/aep-ml-dsa"),
    join(process.cwd(), "target/release/aep-ml-dsa"),
    join(hereDir(), "../../../../rust/target/debug/aep-ml-dsa"),
    join(hereDir(), "../../../../rust/target/release/aep-ml-dsa"),
    join(hereDir(), "../../../../../rust/target/debug/aep-ml-dsa"),
    "/usr/local/bin/aep-ml-dsa",
  ];
  for (const c of candidates) {
    if (c === "aep-ml-dsa") {
      try {
        execFileSync("which", ["aep-ml-dsa"], { encoding: "utf-8" });
        return "aep-ml-dsa";
      } catch {
        continue;
      }
    }
    if (existsSync(c)) return c;
  }
  throw new Error(
    "aep-ml-dsa binary not found. Build: cargo build -p aep-lattice-crypto --bin aep-ml-dsa " +
      "or set AEP_ML_DSA_BIN to the absolute path."
  );
}

function runMlDsa(args: string[], extraEnv?: Record<string, string>): string {
  const bin = resolveAepMlDsaBinary();
  return execFileSync(bin, args, {
    encoding: "utf-8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(extraEnv ?? {}) },
  }) as unknown as string;
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw.trim()) as T;
  } catch (e) {
    throw new Error(`${label}: invalid JSON from aep-ml-dsa: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Generate a real ML-DSA-65 keypair (hex-encoded pqcrypto keys). */
export function generateQuantumKeyPair(): QuantumKeyPair {
  const raw = runMlDsa(["keygen"]);
  const out = parseJson<{
    algorithm: string;
    public_hex: string;
    secret_hex: string;
  }>(raw, "keygen");
  if (!isMlDsa65(out.algorithm)) {
    throw new Error(`keygen: unexpected algorithm ${out.algorithm}`);
  }
  if (!out.public_hex || !out.secret_hex) {
    throw new Error("keygen: missing key material");
  }
  return {
    publicKey: out.public_hex,
    privateKey: out.secret_hex,
    algorithm: ML_DSA_65,
  };
}

/**
 * Sign with ML-DSA-65.
 * `privateKey` is secret key hex from generateQuantumKeyPair().
 * `publicKey` is optional if privateKey is "publicHex:secretHex" combined form.
 */
export function quantumSign(
  data: string,
  privateKey: string,
  publicKey?: string
): QuantumSignature {
  let secret = privateKey.trim();
  let pub = (publicKey || "").trim();
  // Combined form from operators who store both halves: public:secret
  if (!pub && secret.includes(":")) {
    const idx = secret.indexOf(":");
    pub = secret.slice(0, idx);
    secret = secret.slice(idx + 1);
  }
  if (!secret || !/^[0-9a-fA-F]+$/.test(secret)) {
    throw new Error("quantumSign: privateKey must be non-empty hex (or public:secret)");
  }
  if (!pub || !/^[0-9a-fA-F]+$/.test(pub)) {
    throw new Error(
      "quantumSign: publicKey hex is required (pass third argument from generateQuantumKeyPair().publicKey)"
    );
  }
  // Avoid putting secret material on argv (ps disclosure). Use env + message-hex.
  const msgHex = Buffer.from(String(data), "utf8").toString("hex");
  const args = [
    "sign",
    "--public-hex",
    pub,
    "--message-hex",
    msgHex,
  ];
  const raw = runMlDsa(args, { AEP_ML_DSA_SECRET_HEX: secret });
  const out = parseJson<{
    algorithm: string;
    signature_hex: string;
    public_hex?: string | null;
  }>(raw, "sign");
  if (!isMlDsa65(out.algorithm) || !out.signature_hex) {
    throw new Error("quantumSign: invalid aep-ml-dsa sign response");
  }
  return {
    signature: out.signature_hex,
    algorithm: ML_DSA_65,
    publicKey: pub,
  };
}

/**
 * Verify ML-DSA-65 with public key only (real PQ).
 * Optional privateKey is ignored for verify (kept for API compatibility).
 */
export function quantumVerify(
  data: string,
  signature: QuantumSignature,
  _privateKey?: string
): boolean {
  if (!signature || !isMlDsa65(signature.algorithm)) return false;
  if (!signature.signature || !signature.publicKey) return false;
  if (!/^[0-9a-fA-F]+$/.test(signature.signature)) return false;
  if (!/^[0-9a-fA-F]+$/.test(signature.publicKey)) return false;
  // Reject legacy HMAC-sim fingerprints (64-byte hex pub + 64-byte hex sig).
  if (signature.publicKey.length === 128 && signature.signature.length === 128) {
    return false;
  }
  try {
    const raw = runMlDsa([
      "verify",
      "--public-hex",
      signature.publicKey,
      "--signature-hex",
      signature.signature,
      "--message",
      data,
    ]);
    const out = parseJson<{ algorithm: string; valid: boolean }>(raw, "verify");
    return isMlDsa65(out.algorithm) && out.valid === true;
  } catch {
    return false;
  }
}

// Back-compat aliases: same real ML-DSA path (no sim).
export const generateQuantumKeyPairSim = generateQuantumKeyPair;
export const quantumSignSim = quantumSign;
export const quantumVerifySim = quantumVerify;
