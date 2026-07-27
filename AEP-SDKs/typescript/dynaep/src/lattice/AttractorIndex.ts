// @PAD: /root/dynAEP/sdk/typescript/src/lattice/AttractorIndex.ts
// ===========================================================================
// @dynaep/core - Attractor Index with LSH
// OPT-007: Replaces brute-force O(A) attractor matching with
// locality-sensitive hashing for O(1) expected lookup. Includes
// capacity management with LRU eviction.
//
// The TLA+ invariant MemoryDoesNotAffectDecision is preserved:
// LSH false negatives send proposals to cold-path (still correct),
// LSH false positives are eliminated by exact similarity verification.
// ===========================================================================

import { LSHIndex } from "./LSHIndex";
import { extractFeatures, cosineSimilarity, FEATURE_DIMENSION, type FeatureSource } from "./FeatureExtractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AttractorConfig {
  maxAttractors: number;
  similarityThreshold: number;
  indexType: "lsh" | "brute_force";
  lshTables: number;
  lshHashDimension: number;
}

export interface LedgerAttractor {
  id: string;
  features: FeatureSource;
  verdict: "accepted" | "rejected";
  insertedAt: number;
  lastMatchedAt: number;
}

export interface AttractorStats {
  size: number;
  inserts: number;
  matches: number;
  misses: number;
  evictions: number;
  avgCandidates: number;
}

// ---------------------------------------------------------------------------
// AttractorIndex
// ---------------------------------------------------------------------------

export class AttractorIndex {
  private readonly config: AttractorConfig;
  private readonly lshIndex: LSHIndex<string> | null;
  private readonly attractors: Map<string, LedgerAttractor>;
  private readonly featureVectors: Map<string, Float32Array>;
  private readonly accessOrder: Map<string, number>;
  private accessCounter: number;

  // Stats tracking
  private statInserts: number;
  private statMatches: number;
  private statMisses: number;
  private statEvictions: number;
  private totalCandidates: number;
  private totalQueries: number;

  constructor(config: Partial<AttractorConfig> = {}) {
    this.config = {
      maxAttractors: config.maxAttractors ?? 2000,
      similarityThreshold: config.similarityThreshold ?? 0.95,
      indexType: config.indexType ?? "lsh",
      lshTables: config.lshTables ?? 8,
      lshHashDimension: config.lshHashDimension ?? 4,
    };

    this.attractors = new Map<string, LedgerAttractor>();
    this.featureVectors = new Map<string, Float32Array>();
    this.accessOrder = new Map<string, number>();
    this.accessCounter = 0;

    if (this.config.indexType === "lsh") {
      this.lshIndex = new LSHIndex<string>(
        this.config.lshTables,
        this.config.lshHashDimension,
        FEATURE_DIMENSION,
      );
    } else {
      this.lshIndex = null;
    }

    this.statInserts = 0;
    this.statMatches = 0;
    this.statMisses = 0;
    this.statEvictions = 0;
    this.totalCandidates = 0;
    this.totalQueries = 0;
  }

  /**
   * Insert an attractor into the index. If at capacity, evicts the
   * least recently used (matched) attractor first.
   */
  insert(attractor: LedgerAttractor): void {
    // Evict LRU if at capacity
    if (this.attractors.size >= this.config.maxAttractors) {
      this.evictLRU();
    }

    const features = extractFeatures(attractor.features);
    this.attractors.set(attractor.id, attractor);
    this.featureVectors.set(attractor.id, features);
    this.accessOrder.set(attractor.id, this.accessCounter++);

    if (this.lshIndex) {
      this.lshIndex.insert(attractor.id, features, attractor.id);
    }

    this.statInserts++;
  }

  /**
   * Find the best matching attractor for a proposal.
   * Uses LSH for candidate generation (O(1) per table) then
   * exact cosine similarity verification on candidates.
   *
   * Returns null if no attractor exceeds the similarity threshold.
   * LSH false negatives are acceptable (proposal goes to cold path).
   */
  findMatch(proposal: FeatureSource): LedgerAttractor | null {
    const proposalFeatures = extractFeatures(proposal);
    this.totalQueries++;

    let candidates: string[];

    if (this.lshIndex) {
      // LSH candidate generation
      candidates = this.lshIndex.query(proposalFeatures);
    } else {
      // Brute-force: all attractors are candidates
      candidates = Array.from(this.attractors.keys());
    }

    this.totalCandidates += candidates.length;

    let bestAttractor: LedgerAttractor | null = null;
    let bestSimilarity = -1;

    for (const candidateId of candidates) {
      const candidateFeatures = this.featureVectors.get(candidateId);
      if (!candidateFeatures) continue;

      const similarity = cosineSimilarity(proposalFeatures, candidateFeatures);
      if (similarity >= this.config.similarityThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestAttractor = this.attractors.get(candidateId) ?? null;
      }
    }

    if (bestAttractor) {
      // Update LRU tracking
      bestAttractor.lastMatchedAt = Date.now();
      this.accessOrder.set(bestAttractor.id, this.accessCounter++);
      this.statMatches++;
    } else {
      this.statMisses++;
    }

    return bestAttractor;
  }

  /**
   * Remove a specific attractor from the index.
   */
  remove(attractorId: string): void {
    this.attractors.delete(attractorId);
    this.featureVectors.delete(attractorId);
    this.accessOrder.delete(attractorId);

    if (this.lshIndex) {
      this.lshIndex.remove(attractorId);
    }
  }

  /**
   * Return the number of attractors in the index.
   */
  size(): number {
    return this.attractors.size;
  }

  /**
   * Return index statistics.
   */
  stats(): AttractorStats {
    return {
      size: this.attractors.size,
      inserts: this.statInserts,
      matches: this.statMatches,
      misses: this.statMisses,
      evictions: this.statEvictions,
      avgCandidates: this.totalQueries > 0
        ? this.totalCandidates / this.totalQueries
        : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Evict the least recently used attractor (by last access time).
   */
  private evictLRU(): void {
    let oldestId: string | null = null;
    let oldestAccess = Infinity;

    for (const [id, access] of this.accessOrder) {
      if (access < oldestAccess) {
        oldestAccess = access;
        oldestId = id;
      }
    }

    if (oldestId !== null) {
      this.remove(oldestId);
      this.statEvictions++;
    }
  }
}
