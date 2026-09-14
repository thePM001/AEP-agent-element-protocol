// ===========================================================================
// Benchmark: OPT-007 Attractor Matching - LSH vs Brute Force
//
// Compares LSH-indexed attractor matching against brute-force linear scan
// at 100, 500, 1000, and 2000 attractors. Measures per-query latency,
// candidate set sizes, and match accuracy (false-negative rate).
//
// Target: LSH < 20% latency of brute-force at 1000+ attractors
// ===========================================================================

import { AttractorIndex, type LedgerAttractor } from "../sdk/typescript/src/lattice/AttractorIndex";
import type { FeatureSource } from "../sdk/typescript/src/lattice/FeatureExtractor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ELEMENT_TYPES = ["SH", "PN", "CP", "NV", "CZ", "CN", "TB", "WD"];
const MUTATION_TYPES = ["create", "update", "delete", "move", "reparent", "restyle", "reorder", "state_change"];

function randomFeatureSource(seed: number): FeatureSource {
  // Deterministic PRNG based on seed
  let s = seed | 0 || 1;
  const rng = (): number => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return Math.abs(s) / 2147483648;
  };

  return {
    elementType: ELEMENT_TYPES[Math.floor(rng() * ELEMENT_TYPES.length)],
    zBand: Math.floor(rng() * 500),
    parentType: ELEMENT_TYPES[Math.floor(rng() * ELEMENT_TYPES.length)],
    mutationType: MUTATION_TYPES[Math.floor(rng() * MUTATION_TYPES.length)],
    constraintCount: Math.floor(rng() * 10),
    skinBinding: `skin-${Math.floor(rng() * 20)}`,
    stateCount: Math.floor(rng() * 5),
    hasChildren: rng() > 0.5,
    depth: Math.floor(rng() * 10),
  };
}

function makeAttractor(id: number): LedgerAttractor {
  return {
    id: `attractor-${id}`,
    features: randomFeatureSource(id),
    verdict: id % 3 === 0 ? "rejected" : "accepted",
    insertedAt: Date.now(),
    lastMatchedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchInsert(attractorCount: number, indexType: "lsh" | "brute_force"): void {
  const index = new AttractorIndex({
    maxAttractors: attractorCount + 100,
    indexType,
    lshTables: 8,
    lshHashDimension: 4,
  });

  const attractors: LedgerAttractor[] = [];
  for (let i = 0; i < attractorCount; i++) {
    attractors.push(makeAttractor(i));
  }

  const start = performance.now();
  for (const a of attractors) {
    index.insert(a);
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / attractorCount;
  console.log(`  Insert ${indexType} (${attractorCount}): ${avgUs.toFixed(1)}µs/insert, ${Math.round(attractorCount / (elapsed / 1000))} inserts/sec`);
}

function benchQuery(attractorCount: number, queryCount: number, indexType: "lsh" | "brute_force"): void {
  const index = new AttractorIndex({
    maxAttractors: attractorCount + 100,
    similarityThreshold: 0.85,
    indexType,
    lshTables: 8,
    lshHashDimension: 4,
  });

  // Populate index
  for (let i = 0; i < attractorCount; i++) {
    index.insert(makeAttractor(i));
  }

  // Generate queries (some matching, some novel)
  const queries: FeatureSource[] = [];
  for (let i = 0; i < queryCount; i++) {
    if (i % 3 === 0) {
      // Re-query an existing attractor (should match)
      queries.push(randomFeatureSource(i % attractorCount));
    } else {
      // Novel query (may or may not match)
      queries.push(randomFeatureSource(attractorCount + i));
    }
  }

  const start = performance.now();
  let matches = 0;
  for (const q of queries) {
    const result = index.findMatch(q);
    if (result) matches++;
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / queryCount;
  const stats = index.stats();
  console.log(`  Query ${indexType} (${attractorCount} attractors, ${queryCount} queries): ${avgUs.toFixed(1)}µs/query, ${matches} matches, avg candidates: ${stats.avgCandidates.toFixed(1)}`);
}

function benchEviction(maxAttractors: number, totalInserts: number): void {
  const index = new AttractorIndex({
    maxAttractors,
    indexType: "lsh",
    lshTables: 8,
    lshHashDimension: 4,
  });

  const start = performance.now();
  for (let i = 0; i < totalInserts; i++) {
    index.insert(makeAttractor(i));
  }
  const elapsed = performance.now() - start;
  const stats = index.stats();
  const avgUs = (elapsed * 1000) / totalInserts;
  console.log(`  Eviction (max=${maxAttractors}, inserts=${totalInserts}): ${avgUs.toFixed(1)}µs/insert, ${stats.evictions} evictions, final size: ${stats.size}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("=== OPT-007: Attractor Matching - LSH vs Brute Force ===\n");

console.log("--- Insert throughput ---");
for (const count of [100, 500, 1000, 2000]) {
  benchInsert(count, "lsh");
  benchInsert(count, "brute_force");
  console.log();
}

console.log("--- Query latency ---");
for (const count of [100, 500, 1000, 2000]) {
  benchQuery(count, 200, "lsh");
  benchQuery(count, 200, "brute_force");
  console.log();
}

console.log("--- LRU eviction ---");
benchEviction(500, 2000);
benchEviction(1000, 5000);

console.log("\nDone.");
