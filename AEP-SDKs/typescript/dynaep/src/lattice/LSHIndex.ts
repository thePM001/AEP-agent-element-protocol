// @PAD: /root/dynAEP/sdk/typescript/src/lattice/LSHIndex.ts
// ===========================================================================
// @dynaep/core - Locality-Sensitive Hash Index
// OPT-007: Random hyperplane projection LSH for O(1) expected-time
// attractor matching. Uses L hash tables with k-bit hashes to find
// candidate matches, then verifies with exact cosine similarity.
// ===========================================================================

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * Simple seeded PRNG (xorshift128+) for reproducible random projections.
 * Deterministic output from a given seed for test reproducibility.
 */
class SeededRNG {
  private s0: number;
  private s1: number;

  constructor(seed: number) {
    this.s0 = seed | 0 || 1;
    this.s1 = (seed * 2654435761) | 0 || 1;
  }

  /**
   * Returns a float in [0, 1).
   */
  next(): number {
    let s1 = this.s0;
    const s0 = this.s1;
    this.s0 = s0;
    s1 ^= s1 << 23;
    s1 ^= s1 >> 17;
    s1 ^= s0;
    s1 ^= s0 >> 26;
    this.s1 = s1;
    return Math.abs((this.s0 + this.s1) | 0) / 2147483648;
  }

  /**
   * Returns a value from standard normal distribution (Box-Muller).
   */
  nextGaussian(): number {
    const u1 = this.next() || 0.0001; // avoid log(0)
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ---------------------------------------------------------------------------
// LSHIndex
// ---------------------------------------------------------------------------

interface LSHEntry<T> {
  key: string;
  features: Float32Array;
  value: T;
}

/**
 * Locality-Sensitive Hash index using random hyperplane projection.
 *
 * For each of L tables, k random hyperplane normal vectors are generated.
 * A feature vector is hashed by computing the sign of its projection onto
 * each hyperplane, producing a k-bit binary string. Vectors that are
 * similar in cosine distance will tend to hash to the same bucket.
 *
 * Query: compute the hash for each table, collect candidates from all
 * matching buckets, return the deduplicated union.
 */
export class LSHIndex<T> {
  private readonly numTables: number;
  private readonly hashDimension: number;
  private readonly featureDimension: number;
  private readonly hyperplanes: Float32Array[];
  private readonly tables: Map<string, LSHEntry<T>[]>[];
  private readonly keyToEntry: Map<string, LSHEntry<T>>;

  /**
   * @param numTables     - Number of hash tables (L parameter). More tables = higher recall.
   * @param hashDimension - Number of hash bits per table (k parameter). More bits = fewer false positives.
   * @param featureDimension - Dimensionality of feature vectors.
   * @param seed          - Optional PRNG seed for reproducible hyperplanes.
   */
  constructor(
    numTables: number,
    hashDimension: number,
    featureDimension: number,
    seed: number = 42,
  ) {
    this.numTables = numTables;
    this.hashDimension = hashDimension;
    this.featureDimension = featureDimension;
    this.keyToEntry = new Map<string, LSHEntry<T>>();

    // Generate random hyperplane normal vectors
    const rng = new SeededRNG(seed);
    this.hyperplanes = [];
    for (let t = 0; t < numTables * hashDimension; t++) {
      const plane = new Float32Array(featureDimension);
      for (let d = 0; d < featureDimension; d++) {
        plane[d] = rng.nextGaussian();
      }
      this.hyperplanes.push(plane);
    }

    // Initialize hash tables
    this.tables = [];
    for (let t = 0; t < numTables; t++) {
      this.tables.push(new Map<string, LSHEntry<T>[]>());
    }
  }

  /**
   * Insert a keyed feature vector into all hash tables.
   */
  insert(key: string, features: Float32Array, value: T): void {
    // Remove existing entry with the same key if present
    if (this.keyToEntry.has(key)) {
      this.remove(key);
    }

    const entry: LSHEntry<T> = { key, features, value };
    this.keyToEntry.set(key, entry);

    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(features, t);
      const table = this.tables[t];
      let bucket = table.get(hash);
      if (!bucket) {
        bucket = [];
        table.set(hash, bucket);
      }
      bucket.push(entry);
    }
  }

  /**
   * Query for candidate matches across all hash tables.
   * Returns deduplicated candidates (typically 1-5 for well-tuned parameters).
   */
  query(features: Float32Array): T[] {
    const seen = new Set<string>();
    const candidates: T[] = [];

    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(features, t);
      const bucket = this.tables[t].get(hash);
      if (bucket) {
        for (const entry of bucket) {
          if (!seen.has(entry.key)) {
            seen.add(entry.key);
            candidates.push(entry.value);
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Remove a keyed entry from all hash tables.
   */
  remove(key: string): void {
    const entry = this.keyToEntry.get(key);
    if (!entry) return;

    this.keyToEntry.delete(key);

    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(entry.features, t);
      const table = this.tables[t];
      const bucket = table.get(hash);
      if (bucket) {
        const idx = bucket.findIndex((e) => e.key === key);
        if (idx >= 0) {
          bucket.splice(idx, 1);
          if (bucket.length === 0) {
            table.delete(hash);
          }
        }
      }
    }
  }

  /**
   * Clear all tables and entries.
   */
  clear(): void {
    this.keyToEntry.clear();
    for (const table of this.tables) {
      table.clear();
    }
  }

  /**
   * Return the number of entries in the index.
   */
  get size(): number {
    return this.keyToEntry.size;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Compute the k-bit hash for a feature vector in a specific table.
   * Each bit is the sign of the dot product with a random hyperplane.
   */
  private computeHash(features: Float32Array, tableIndex: number): string {
    const bits: string[] = [];
    const baseIdx = tableIndex * this.hashDimension;

    for (let h = 0; h < this.hashDimension; h++) {
      const plane = this.hyperplanes[baseIdx + h];
      let dotProduct = 0;
      const len = Math.min(features.length, plane.length);
      for (let d = 0; d < len; d++) {
        dotProduct += features[d] * plane[d];
      }
      bits.push(dotProduct >= 0 ? "1" : "0");
    }

    return bits.join("");
  }
}
