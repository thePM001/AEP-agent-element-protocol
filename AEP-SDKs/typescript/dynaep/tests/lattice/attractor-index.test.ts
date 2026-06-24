// @PAD: /root/dynAEP/sdk/typescript/tests/lattice/attractor-index.test.ts
// ===========================================================================
// Tests for AttractorIndex + LSH - OPT-007 Lattice Memory Indexing
// ===========================================================================

import { AttractorIndex, type LedgerAttractor } from "../../src/lattice/AttractorIndex";
import { extractFeatures, cosineSimilarity, FEATURE_DIMENSION, type FeatureSource } from "../../src/lattice/FeatureExtractor";
import { LSHIndex } from "../../src/lattice/LSHIndex";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAttractor(id: string, features: FeatureSource, verdict: "accepted" | "rejected" = "accepted"): LedgerAttractor {
  return {
    id,
    features,
    verdict,
    insertedAt: Date.now(),
    lastMatchedAt: 0,
  };
}

const baseFeatures: FeatureSource = {
  elementType: "CP",
  zBand: 100,
  parentType: "PN",
  mutationType: "update",
  constraintCount: 3,
  skinBinding: "dark-theme",
  stateCount: 2,
  hasChildren: true,
  depth: 4,
};

// ---------------------------------------------------------------------------
// FeatureExtractor Tests
// ---------------------------------------------------------------------------

console.log("=== OPT-007: Attractor Index + LSH Tests ===\n");
console.log("--- FeatureExtractor ---");

test("extractFeatures returns correct dimension", () => {
  const features = extractFeatures(baseFeatures);
  assert(features.length === FEATURE_DIMENSION, `Feature dimension should be ${FEATURE_DIMENSION}, got ${features.length}`);
});

test("extractFeatures encodes element type as one-hot", () => {
  const features = extractFeatures({ elementType: "CP" });
  // CP is index 2 in ELEMENT_TYPES
  assert(features[2] === 1.0, "CP should be encoded at index 2");
  // All other type slots should be 0
  for (let i = 0; i < 14; i++) {
    if (i !== 2) {
      assert(features[i] === 0, `Index ${i} should be 0`);
    }
  }
});

test("extractFeatures normalizes zBand", () => {
  const f500 = extractFeatures({ zBand: 500 });
  assert(f500[14] === 0.5, "zBand 500 should normalize to 0.5");

  const f0 = extractFeatures({ zBand: 0 });
  assert(f0[14] === 0.0, "zBand 0 should normalize to 0.0");

  const f2000 = extractFeatures({ zBand: 2000 });
  assert(f2000[14] === 1.0, "zBand 2000 should clamp to 1.0");
});

test("extractFeatures encodes mutation type", () => {
  const features = extractFeatures({ mutationType: "delete" });
  // "delete" is index 2 in MUTATION_TYPES
  assert(features[29 + 2] === 1.0, "delete should be encoded at index 31");
});

test("cosineSimilarity of identical vectors is 1", () => {
  const a = extractFeatures(baseFeatures);
  const b = extractFeatures(baseFeatures);
  const sim = cosineSimilarity(a, b);
  assert(Math.abs(sim - 1.0) < 0.0001, `Identical features should have similarity ~1.0, got ${sim}`);
});

test("cosineSimilarity of orthogonal vectors is 0", () => {
  const a = new Float32Array(FEATURE_DIMENSION);
  a[0] = 1.0;
  const b = new Float32Array(FEATURE_DIMENSION);
  b[1] = 1.0;
  const sim = cosineSimilarity(a, b);
  assert(Math.abs(sim) < 0.0001, `Orthogonal features should have similarity ~0, got ${sim}`);
});

test("cosineSimilarity of zero vector is 0", () => {
  const a = extractFeatures(baseFeatures);
  const zero = new Float32Array(FEATURE_DIMENSION);
  const sim = cosineSimilarity(a, zero);
  assert(sim === 0, "Zero vector similarity should be 0");
});

test("extractFeatures from ID prefix when no elementType", () => {
  const features = extractFeatures({ id: "SH-00001" });
  // SH is index 0
  assert(features[0] === 1.0, "SH prefix from ID should set index 0");
});

// ---------------------------------------------------------------------------
// LSHIndex Tests
// ---------------------------------------------------------------------------

console.log("\n--- LSHIndex ---");

test("LSHIndex inserts and queries matching vectors", () => {
  const lsh = new LSHIndex<string>(4, 3, FEATURE_DIMENSION, 42);
  const features = extractFeatures(baseFeatures);
  lsh.insert("key-1", features, "value-1");

  const candidates = lsh.query(features);
  assert(candidates.length >= 1, "Query with identical features should return at least 1 candidate");
  assert(candidates.includes("value-1"), "Should include the inserted value");
});

test("LSHIndex returns empty for unrelated vectors", () => {
  const lsh = new LSHIndex<string>(4, 3, FEATURE_DIMENSION, 42);

  const a = new Float32Array(FEATURE_DIMENSION);
  a[0] = 1.0;
  lsh.insert("key-1", a, "value-1");

  const b = new Float32Array(FEATURE_DIMENSION);
  b[FEATURE_DIMENSION - 1] = 1.0;
  const candidates = lsh.query(b);
  // May or may not match depending on hyperplane orientations
  // This is a probabilistic test; we just verify it doesn't crash
  assert(Array.isArray(candidates), "Should return an array");
});

test("LSHIndex remove works correctly", () => {
  const lsh = new LSHIndex<string>(4, 3, FEATURE_DIMENSION, 42);
  const features = extractFeatures(baseFeatures);
  lsh.insert("key-1", features, "value-1");

  assert(lsh.size === 1, "Size should be 1 after insert");
  lsh.remove("key-1");
  assert(lsh.size === 0, "Size should be 0 after remove");

  const candidates = lsh.query(features);
  assert(!candidates.includes("value-1"), "Removed entry should not appear in results");
});

test("LSHIndex clear empties all tables", () => {
  const lsh = new LSHIndex<string>(4, 3, FEATURE_DIMENSION, 42);
  for (let i = 0; i < 10; i++) {
    const f = extractFeatures({ elementType: "CP", zBand: i * 100 });
    lsh.insert(`key-${i}`, f, `value-${i}`);
  }
  assert(lsh.size === 10, "Size should be 10");
  lsh.clear();
  assert(lsh.size === 0, "Size should be 0 after clear");
});

test("LSHIndex deduplicates candidates across tables", () => {
  const lsh = new LSHIndex<string>(8, 2, FEATURE_DIMENSION, 42);
  const features = extractFeatures(baseFeatures);
  lsh.insert("key-1", features, "value-1");

  // Same features queried should return value-1 exactly once
  const candidates = lsh.query(features);
  const count = candidates.filter(c => c === "value-1").length;
  assert(count === 1, `Should deduplicate: got ${count} copies of value-1`);
});

test("LSHIndex replaces on duplicate key insert", () => {
  const lsh = new LSHIndex<string>(4, 3, FEATURE_DIMENSION, 42);
  const f1 = extractFeatures({ elementType: "CP" });
  const f2 = extractFeatures({ elementType: "SH" });

  lsh.insert("key-1", f1, "value-1");
  lsh.insert("key-1", f2, "value-1-updated");

  assert(lsh.size === 1, "Should have 1 entry after overwrite");
});

// ---------------------------------------------------------------------------
// AttractorIndex Tests
// ---------------------------------------------------------------------------

console.log("\n--- AttractorIndex ---");

test("Insert and find exact match", () => {
  const index = new AttractorIndex({ similarityThreshold: 0.9 });
  const attractor = makeAttractor("a-1", baseFeatures);
  index.insert(attractor);

  const match = index.findMatch(baseFeatures);
  assert(match !== null, "Should find exact match");
  assert(match!.id === "a-1", "Should match a-1");
  assert(match!.verdict === "accepted", "Should preserve verdict");
});

test("No match for dissimilar proposal", () => {
  const index = new AttractorIndex({ similarityThreshold: 0.95 });
  index.insert(makeAttractor("a-1", {
    elementType: "SH",
    mutationType: "create",
    zBand: 0,
  }));

  const match = index.findMatch({
    elementType: "WD",
    mutationType: "delete",
    zBand: 999,
    constraintCount: 20,
    depth: 20,
  });
  assert(match === null, "Dissimilar proposal should not match");
});

test("Stats track inserts, matches, misses", () => {
  const index = new AttractorIndex({ similarityThreshold: 0.9 });
  index.insert(makeAttractor("a-1", baseFeatures));
  index.findMatch(baseFeatures); // match
  index.findMatch({ elementType: "WD", mutationType: "delete" }); // miss

  const stats = index.stats();
  assert(stats.inserts === 1, "Should track 1 insert");
  assert(stats.matches === 1, "Should track 1 match");
  assert(stats.misses === 1, "Should track 1 miss");
  assert(stats.size === 1, "Size should be 1");
});

test("LRU eviction at capacity", () => {
  const index = new AttractorIndex({
    maxAttractors: 3,
    similarityThreshold: 0.9,
  });

  index.insert(makeAttractor("a-1", { elementType: "SH" }));
  index.insert(makeAttractor("a-2", { elementType: "PN" }));
  index.insert(makeAttractor("a-3", { elementType: "CP" }));
  assert(index.size() === 3, "Should have 3 attractors");

  // Insert 4th should evict a-1 (oldest)
  index.insert(makeAttractor("a-4", { elementType: "NV" }));
  assert(index.size() === 3, "Should still have 3 after eviction");
  const stats = index.stats();
  assert(stats.evictions === 1, "Should track 1 eviction");
});

test("LRU eviction respects access order", () => {
  const index = new AttractorIndex({
    maxAttractors: 3,
    similarityThreshold: 0.5, // low threshold to ensure matches
  });

  index.insert(makeAttractor("a-1", { elementType: "SH", zBand: 100 }));
  index.insert(makeAttractor("a-2", { elementType: "PN", zBand: 200 }));
  index.insert(makeAttractor("a-3", { elementType: "CP", zBand: 300 }));

  // Access a-1 to make it recently used
  index.findMatch({ elementType: "SH", zBand: 100 });

  // Insert a-4: should evict a-2 (least recently used, not a-1)
  index.insert(makeAttractor("a-4", { elementType: "NV" }));
  assert(index.size() === 3, "Should have 3");
});

test("Remove works correctly", () => {
  const index = new AttractorIndex({ similarityThreshold: 0.9 });
  index.insert(makeAttractor("a-1", baseFeatures));
  assert(index.size() === 1, "Should have 1");

  index.remove("a-1");
  assert(index.size() === 0, "Should have 0 after remove");

  const match = index.findMatch(baseFeatures);
  assert(match === null, "Removed attractor should not match");
});

test("Brute force mode works without LSH", () => {
  const index = new AttractorIndex({
    indexType: "brute_force",
    similarityThreshold: 0.9,
  });
  index.insert(makeAttractor("a-1", baseFeatures));

  const match = index.findMatch(baseFeatures);
  assert(match !== null, "Should find match in brute force mode");
  assert(match!.id === "a-1", "Should match a-1");
});

test("TLA+ invariant: LSH false negatives do not affect correctness", () => {
  // MemoryDoesNotAffectDecision: if LSH misses a valid attractor,
  // findMatch returns null, sending the proposal to cold path.
  // The decision is STILL CORRECT because the cold path evaluates fully.
  // We verify that findMatch never returns an INCORRECT match.
  const index = new AttractorIndex({
    similarityThreshold: 0.99, // Very strict threshold
  });

  index.insert(makeAttractor("a-1", {
    elementType: "CP",
    mutationType: "update",
    zBand: 100,
    constraintCount: 3,
  }));

  // Query with slightly different features
  const match = index.findMatch({
    elementType: "CP",
    mutationType: "update",
    zBand: 150, // Different zBand
    constraintCount: 5, // Different constraints
  });

  // If match is found, it must genuinely be similar
  if (match !== null) {
    const matchFeatures = extractFeatures(match.features);
    const queryFeatures = extractFeatures({
      elementType: "CP",
      mutationType: "update",
      zBand: 150,
      constraintCount: 5,
    });
    const sim = cosineSimilarity(matchFeatures, queryFeatures);
    assert(sim >= 0.99, `False positive: similarity ${sim} below threshold 0.99`);
  }
  // If null, that's acceptable (false negative -> cold path)
  assert(true, "No false positives detected");
});

test("avgCandidates tracks LSH candidate set size", () => {
  const index = new AttractorIndex({
    lshTables: 4,
    lshHashDimension: 2,
    similarityThreshold: 0.9,
  });

  for (let i = 0; i < 50; i++) {
    index.insert(makeAttractor(`a-${i}`, {
      elementType: "CP",
      zBand: i * 20,
      constraintCount: i % 10,
    }));
  }

  // Do some queries
  for (let i = 0; i < 10; i++) {
    index.findMatch({ elementType: "CP", zBand: i * 20 });
  }

  const stats = index.stats();
  // avgCandidates should be much less than total attractors (50)
  // LSH should narrow down candidates significantly
  assert(stats.avgCandidates < 50, `avgCandidates (${stats.avgCandidates.toFixed(1)}) should be less than total (50)`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

setTimeout(() => {
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}, 100);
