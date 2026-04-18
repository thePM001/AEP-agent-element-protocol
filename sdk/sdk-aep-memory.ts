// ===========================================================================
// @aep/memory - AEP Lattice Memory Module
// Validation memory fabric for the Agent Element Protocol v2.0.
// Records validation outcomes, enables vector-similarity retrieval,
// fast-path caching, and rejection/acceptance history queries.
//
// Provides InMemoryFabric out of the box. For persistent storage,
// implement the MemoryFabric interface with better-sqlite3 or similar.
// ===========================================================================

import type { AEPValidationResult } from "./sdk-aep-core";

// ---------------------------------------------------------------------------
// Domain Constants
// ---------------------------------------------------------------------------

/** The five AEP protocol domains that memory entries can belong to. */
export type AEPDomain = "ui" | "workflow" | "api" | "event" | "iac";

/** Validation outcome recorded in memory. */
export type ValidationOutcome = "accepted" | "rejected";

// ---------------------------------------------------------------------------
// Vector Utilities
// ---------------------------------------------------------------------------

/**
 * Compute the cosine similarity between two numeric vectors.
 *
 * Returns a value in [-1, 1] where 1 means identical direction,
 * 0 means orthogonal, and -1 means opposite direction.
 *
 * Returns 0.0 for empty vectors, mismatched lengths, or zero-magnitude vectors.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity score
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0.0;
  }

  let dot = 0.0;
  let magA = 0.0;
  let magB = 0.0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0.0) {
    return 0.0;
  }

  return dot / denom;
}

// ---------------------------------------------------------------------------
// MemoryEntry
// ---------------------------------------------------------------------------

/**
 * A single record in the AEP validation memory lattice.
 *
 * Each entry captures the full context of a validation event:
 * what was proposed, which element it targeted, the domain,
 * whether it was accepted or rejected, any errors produced,
 * the traversal path through the scene graph, and an optional
 * embedding vector for similarity search.
 */
export interface MemoryEntry {
  /** Unique identifier for this memory entry (UUID v4). */
  id: string;

  /** ISO 8601 timestamp of when this entry was recorded. */
  timestamp: string;

  /** The AEP element ID that this validation targeted (e.g. "CP-00001"). */
  element_id: string;

  /** The protocol domain this validation belongs to. */
  domain: AEPDomain;

  /** The proposed mutation or action that was validated. */
  proposal: Record<string, any>;

  /** Whether the proposal was accepted or rejected by validation. */
  result: ValidationOutcome;

  /** Error messages produced during validation (empty array if accepted). */
  errors: string[];

  /** Ordered list of element IDs traversed during validation (scene graph path). */
  traversal_path: string[];

  /** Optional embedding vector for similarity search and fast-path matching. */
  embedding?: number[];

  /** Optional arbitrary metadata attached to this entry. */
  metadata?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// UUID Generation
// ---------------------------------------------------------------------------

/**
 * Generate a UUID v4 string. Uses crypto.randomUUID when available,
 * falls back to a Math.random-based implementation for older runtimes.
 */
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback: RFC 4122 v4 UUID via Math.random
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

/**
 * Create a new MemoryEntry with auto-generated id and timestamp.
 *
 * @param elementId   - The AEP element ID (e.g. "CP-00001")
 * @param domain      - The protocol domain ("ui", "workflow", "api", "event", "iac")
 * @param proposal    - The proposed mutation or action
 * @param result      - "accepted" or "rejected"
 * @param errors      - Validation errors (empty array if accepted)
 * @param traversalPath - Scene graph traversal path
 * @param embedding   - Optional embedding vector
 * @param metadata    - Optional metadata
 * @returns A fully populated MemoryEntry
 */
export function createMemoryEntry(
  elementId: string,
  domain: AEPDomain,
  proposal: Record<string, any>,
  result: ValidationOutcome,
  errors: string[],
  traversalPath: string[],
  embedding?: number[],
  metadata?: Record<string, any>,
): MemoryEntry {
  return {
    id: generateUUID(),
    timestamp: new Date().toISOString(),
    element_id: elementId,
    domain,
    proposal,
    result,
    errors,
    traversal_path: traversalPath,
    embedding,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// MemoryFabric Interface
// ---------------------------------------------------------------------------

/**
 * Abstract interface for AEP validation memory storage.
 *
 * Implementations must support recording entries, vector similarity search,
 * history queries by element, fast-path cache lookup, and bulk export.
 *
 * The SDK ships InMemoryFabric. For persistent storage, implement this
 * interface with better-sqlite3, PostgreSQL+pgvector, or similar.
 */
export interface MemoryFabric {
  /**
   * Record a validation entry into the memory fabric.
   * @param entry - The memory entry to store
   */
  record(entry: MemoryEntry): void;

  /**
   * Find the nearest memory entries to a given embedding vector,
   * ranked by cosine similarity (highest first).
   *
   * Only entries that have embeddings are considered.
   *
   * @param embedding - The query embedding vector
   * @param limit     - Maximum number of results to return (default: 5)
   * @returns Array of matching entries sorted by descending similarity
   */
  findNearestAttractor(embedding: number[], limit?: number): MemoryEntry[];

  /**
   * Get all rejected validation entries for a specific element.
   *
   * @param elementId - The AEP element ID to query
   * @returns Array of rejected entries, most recent first
   */
  getRejectionHistory(elementId: string): MemoryEntry[];

  /**
   * Get all accepted validation entries for a specific element.
   *
   * @param elementId - The AEP element ID to query
   * @returns Array of accepted entries, most recent first
   */
  getAcceptanceHistory(elementId: string): MemoryEntry[];

  /**
   * Get the total number of validation events recorded for an element.
   *
   * @param elementId - The AEP element ID to query
   * @returns Total count of validations (accepted + rejected)
   */
  getValidationCount(elementId: string): number;

  /**
   * Fast-path lookup: find a previously accepted entry whose embedding
   * exceeds the similarity threshold. Returns the single best match
   * or null if no entry is similar enough.
   *
   * This enables skipping full re-validation when a near-identical
   * proposal was already accepted.
   *
   * @param embedding  - The query embedding vector
   * @param threshold  - Minimum cosine similarity to qualify (default: 0.95)
   * @returns The best matching accepted entry, or null
   */
  getFastPathHit(embedding: number[], threshold?: number): MemoryEntry | null;

  /**
   * Export the complete history of all recorded memory entries.
   *
   * @returns Array of all entries in insertion order
   */
  exportHistory(): MemoryEntry[];

  /**
   * Remove all entries from the memory fabric.
   */
  clear(): void;
}

// ---------------------------------------------------------------------------
// InMemoryFabric
// ---------------------------------------------------------------------------

/**
 * In-memory implementation of the AEP MemoryFabric.
 *
 * Stores all entries in a plain array. Cosine similarity is computed
 * on the fly for vector searches. Suitable for development, testing,
 * and short-lived agent sessions.
 *
 * For production use with large entry counts or persistence requirements,
 * implement MemoryFabric with a database backend (e.g. better-sqlite3
 * with a vector extension, or PostgreSQL with pgvector).
 *
 * @example
 * ```ts
 * import { InMemoryFabric, createMemoryEntry } from "@aep/memory";
 *
 * const fabric = new InMemoryFabric();
 *
 * const entry = createMemoryEntry(
 *   "CP-00001",
 *   "ui",
 *   { z: 25, label: "Submit Button" },
 *   "accepted",
 *   [],
 *   ["SH-00001", "PN-00001", "CP-00001"],
 *   [0.1, 0.9, 0.3], // embedding
 * );
 *
 * fabric.record(entry);
 *
 * // Fast-path: skip validation if a near-identical proposal was accepted
 * const hit = fabric.getFastPathHit([0.1, 0.9, 0.3]);
 * if (hit) {
 *   console.log("Fast-path hit, skipping re-validation");
 * }
 *
 * // Inspect rejection patterns for an element
 * const rejections = fabric.getRejectionHistory("CP-00001");
 * ```
 */
export class InMemoryFabric implements MemoryFabric {
  private entries: MemoryEntry[] = [];

  /** @inheritdoc */
  record(entry: MemoryEntry): void {
    this.entries.push(entry);
  }

  /** @inheritdoc */
  findNearestAttractor(embedding: number[], limit: number = 5): MemoryEntry[] {
    if (embedding.length === 0) {
      return [];
    }

    const scored: Array<{ entry: MemoryEntry; similarity: number }> = [];

    for (const entry of this.entries) {
      if (!entry.embedding || entry.embedding.length === 0) {
        continue;
      }
      const sim = cosineSimilarity(embedding, entry.embedding);
      scored.push({ entry, similarity: sim });
    }

    // Sort by descending similarity
    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, limit).map((s) => s.entry);
  }

  /** @inheritdoc */
  getRejectionHistory(elementId: string): MemoryEntry[] {
    return this.entries
      .filter((e) => e.element_id === elementId && e.result === "rejected")
      .reverse();
  }

  /** @inheritdoc */
  getAcceptanceHistory(elementId: string): MemoryEntry[] {
    return this.entries
      .filter((e) => e.element_id === elementId && e.result === "accepted")
      .reverse();
  }

  /** @inheritdoc */
  getValidationCount(elementId: string): number {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.element_id === elementId) {
        count++;
      }
    }
    return count;
  }

  /** @inheritdoc */
  getFastPathHit(
    embedding: number[],
    threshold: number = 0.95,
  ): MemoryEntry | null {
    if (embedding.length === 0) {
      return null;
    }

    let bestEntry: MemoryEntry | null = null;
    let bestSimilarity = -Infinity;

    for (const entry of this.entries) {
      // Fast-path only considers accepted entries with embeddings
      if (entry.result !== "accepted") {
        continue;
      }
      if (!entry.embedding || entry.embedding.length === 0) {
        continue;
      }

      const sim = cosineSimilarity(embedding, entry.embedding);
      if (sim >= threshold && sim > bestSimilarity) {
        bestSimilarity = sim;
        bestEntry = entry;
      }
    }

    return bestEntry;
  }

  /** @inheritdoc */
  exportHistory(): MemoryEntry[] {
    return [...this.entries];
  }

  /** @inheritdoc */
  clear(): void {
    this.entries = [];
  }
}
