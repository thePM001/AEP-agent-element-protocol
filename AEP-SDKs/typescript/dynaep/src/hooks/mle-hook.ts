// @PAD: /root/dynAEP/hooks/examples/mle-hook/index.ts
// =============================================================================
// hooks/examples/mle-hook/index.ts
// MLE (Morpho-Logic Engine) Validation Hook - Reference Implementation
//
// This hook demonstrates MLE-based lattice constraint checking using
// binary hypervector operations (XOR + POPCNT) on u64 vectors.
//
// MLE Approach (conceptual):
//   1. Encode the event's action_path and constraint set into a u64
//      hypervector using locality-sensitive hashing.
//   2. XOR the event vector against known "attractor" patterns stored
//      in the lattice node metadata.
//   3. POPCNT the result to compute Hamming distance.
//   4. Normalise distance to a confidence score in [0.0, 1.0].
//   5. Return pass/fail with confidence.
//
// Sub-millisecond per event when running natively.
//
// IMPORTANT:
//   This is a REFERENCE implementation. It demonstrates the interface
//   contract and the intended MLE integration pattern. If the real MLE
//   binary/WASM module is available at import time, it will be used.
//   Otherwise, the hook falls back to a deterministic lookup table
//   that simulates the MLE behaviour for well-known action paths.
// =============================================================================

import type { LatticeEvent, ActionLattice, LatticeNode } from "../protocol/action-lattice.js";
import type { ValidationHook, HookResult } from "../protocol/action-lattice.js";

// ── Constants ─────────────────────────────────────────────────────────────

/** Hamming distance threshold below which we consider a match. */
const DEFAULT_HAMMING_THRESHOLD = 12;

/** Bits in a u64 hypervector. */
const HV_BITS = 64;

// ── Optional MLE Native Module ────────────────────────────────────────────

/**
 * Attempt to load the real MLE native module.
 *
 * The expected module exports:
 *   - mleEncode(actionPath: string, constraints: string[]): BigUint64Array
 *   - mleCompare(encoded: BigUint64Array, attractors: BigUint64Array[]): number
 *
 * If unavailable, we fall back to pure-TS simulation.
 */
let mleNative: { encode: (path: string) => bigint; compare: (a: bigint, b: bigint) => number } | null = null;

try {
  // Dynamic import - will throw if the module isn't installed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("mle-native");
  mleNative = {
    encode: (path: string): bigint => mod.mleEncode(path, []),
    compare: (a: bigint, b: bigint): number => mod.mleCompare(new BigUint64Array([a]), [new BigUint64Array([b])]),
  };
} catch {
  // Native MLE not available; fallback handles encoding.
  mleNative = null;
}

// ── Fallback Deterministic Lookup ─────────────────────────────────────────

/**
 * A simple string → u64 hash using FNV-1a (64-bit variant).
 *
 * This is NOT cryptographically secure but provides good hash
 * distribution for hypervector encoding in the reference impl.
 */
function fnv1a64(input: string): bigint {
  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;

  let hash = FNV_OFFSET_BASIS;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  for (const byte of data) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }

  return hash;
}

/**
 * Encode an action path into a u64 hypervector.
 *
 * MLE encoding typically uses multiple hash functions to project
 * the input into a high-dimensional binary space. For this reference
 * implementation we use a single FNV-1a hash with bit mixing.
 *
 * In production, the real MLE module would:
 *   - Apply k independent random projections (e.g. k=4..8)
 *   - Concatenate the sign bits into a k-bit code
 *   - Repeat across m independent tables to build a u64 vector
 */
function encodePath(actionPath: string): bigint {
  if (mleNative) {
    return mleNative.encode(actionPath);
  }

  // Fallback: FNV-1a hash with bit rotation mixing
  const h1 = fnv1a64(actionPath);
  const h2 = fnv1a64(actionPath + ":salt");
  const h3 = fnv1a64(actionPath + ":mle");
  const h4 = fnv1a64(actionPath + ":attractor");

  // Mix: XOR shifted hashes to simulate multi-projection encoding
  return (
    h1 ^
    ((h2 << 17n) | (h2 >> 47n)) ^
    ((h3 << 31n) | (h3 >> 33n)) ^
    ((h4 << 7n) | (h4 >> 57n))
  );
}

/**
 * Compute the population count (number of set bits) in a u64.
 *
 * This is the "POPCNT" instruction in hardware. We implement it
 * in pure TypeScript for the reference implementation.
 */
function popcnt64(x: bigint): number {
  // Hamming weight via divide-and-conquer (Kernighan style for bigint)
  let count = 0;
  let v = x;
  while (v > 0n) {
    v &= v - 1n;
    count++;
  }
  return count;
}

/**
 * Compute the Hamming distance between two u64 hypervectors.
 *
 * In MLE, distance = POPCNT(a XOR b).
 * Small distance → high similarity.
 */
function hammingDistance(a: bigint, b: bigint): number {
  return popcnt64(a ^ b);
}

/**
 * Generate attractor patterns from a LatticeNode.
 *
 * Attractors are idealised hypervectors that known-good events
 * for this action path should match closely.
 *
 * For the reference implementation, we derive attractors from:
 *   - The node's label and category
 *   - Each constraint
 *   - The trust floor level
 */
function generateAttractors(node: LatticeNode): bigint[] {
  const attractors: bigint[] = [];

  // Primary attractor: label + category + trust floor
  attractors.push(
    encodePath(`${node.label}:${node.category}:${node.trust_floor}`),
  );

  // Constraint attractors: one per constraint
  for (const constraint of node.constraints) {
    const encoded = encodePath(
      `${node.label}:${constraint.type}:${constraint.field || "*"}:${constraint.condition || "*"}`,
    );
    attractors.push(encoded);
  }

  return attractors;
}

// ── MLE Validator Hook ────────────────────────────────────────────────────

/**
 * MLE Validation Hook.
 *
 * Evaluates events by encoding their action path and payload features
 * into a u64 hypervector, then comparing against stored attractor
 * patterns. High Hamming distance → likely anomalous → lower score.
 */
const mleValidationHook: ValidationHook = {
  name: "mle-validator",
  version: "1.0.0",

  async validate(
    event: LatticeEvent,
    _lattice: ActionLattice,
    node: LatticeNode,
  ): Promise<HookResult> {
    const startTime = process.hrtime.bigint();

    // ── Step 1: Encode event into hypervector ─────────────────────────
    const eventVector = encodePath(event.action_path);

    // Optionally incorporate payload features for richer encoding
    let payloadVector = 0n;
    if (event.payload && typeof event.payload === "object") {
      const payloadStr = JSON.stringify(event.payload, Object.keys(event.payload).sort());
      payloadVector = encodePath(payloadStr);
    }

    // Combined event vector: action_path XOR payload features
    const combinedVector = eventVector ^ payloadVector;

    // ── Step 2: Generate attractors from lattice node ─────────────────
    const attractors = generateAttractors(node);

    // If there are no attractors, we can't validate - pass with low confidence
    if (attractors.length === 0) {
      return {
        passed: true,
        score: 1.0,
        confidence: 0.2,
        details:
          "MLE hook: no attractors defined for this node; allowing with low confidence",
      };
    }

    // ── Step 3: Compare against attractors ────────────────────────────
    let minDistance = HV_BITS; // worst case

    for (const attractor of attractors) {
      const dist = hammingDistance(combinedVector, attractor);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }

    // ── Step 4: Normalise to score and confidence ────────────────────
    // Score: 1.0 at distance 0, linear decay to 0.0 at HV_BITS
    const score = Math.max(0.0, 1.0 - minDistance / HV_BITS);

    // Pass if within Hamming threshold
    const passed = minDistance <= DEFAULT_HAMMING_THRESHOLD;

    // Confidence: inversely proportional to distance, capped at [0.0, 1.0]
    const confidence = Math.max(0.0, Math.min(1.0, 1.0 - minDistance / (HV_BITS / 2)));

    // ── Step 5: Compute latency for observability ────────────────────
    const endTime = process.hrtime.bigint();
    const elapsedUs = Number(endTime - startTime) / 1000;

    // ── Build result ──────────────────────────────────────────────────
    const result: HookResult = {
      passed,
      score,
      confidence,
      details:
        `MLE hook: action='${event.action_path}', ` +
        `minHamming=${minDistance}/${HV_BITS}, ` +
        `score=${score.toFixed(3)}, ` +
        `confidence=${confidence.toFixed(3)}, ` +
        `latency=${elapsedUs.toFixed(1)}µs` +
        (passed ? ", PASS" : ", FAIL"),
    };

    // If the event is anomalous but passed, provide an adjustment hint
    if (passed && score < 0.7) {
      result.adjustments = {
        mle_anomaly_warning: true,
        mle_hamming_distance: minDistance,
        mle_confidence: confidence,
        recommended_action: "review",
      };
    }

    return result;
  },
};

export default mleValidationHook;
export { encodePath, hammingDistance, popcnt64, generateAttractors, mleNative };
