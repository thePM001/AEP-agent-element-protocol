// AEP 2.5 -- Governed Retriever
// Retrieves knowledge chunks with covenant scope filtering, double scanning
// and anti-context-rot ordering (U-shaped attention mitigation).

import type { KnowledgeBase, KnowledgeChunk, KnowledgeQueryOptions } from "./types.js";
import type { CovenantSpec } from "../covenant/types.js";
import type { ScannerPipeline } from "../scanners/pipeline.js";
import type { EvidenceLedger } from "../ledger/ledger.js";

interface ScoredChunk {
  chunk: KnowledgeChunk;
  score: number;
}

export class GovernedRetriever {
  private kb: KnowledgeBase;
  private covenant: CovenantSpec | null;
  private pipeline: ScannerPipeline | null;

  constructor(
    kb: KnowledgeBase,
    covenant?: CovenantSpec,
    pipeline?: ScannerPipeline
  ) {
    this.kb = kb;
    this.covenant = covenant ?? null;
    this.pipeline = pipeline ?? null;
  }

  /**
   * Retrieve relevant chunks from the knowledge base.
   *
   * 1. Search for relevant chunks (keyword matching + TF-IDF scoring)
   * 2. Filter by covenant scope (agent sees only permitted areas)
   * 3. Re-validate through scanner pipeline (catch flagged chunks)
   * 4. Anti-context-rot ordering:
   *    Most relevant -> position 1 (context start)
   *    Second most relevant -> position LAST (context end)
   *    Remaining -> positions 2 through N-1 (middle)
   * 5. Return validated, scoped, ordered chunks
   */
  retrieve(
    query: string,
    options?: KnowledgeQueryOptions,
    ledger?: EvidenceLedger
  ): KnowledgeChunk[] {
    const maxChunks = options?.maxChunks ?? 10;
    const scope = options?.scope;
    const antiContextRot = options?.antiContextRot ?? true;
    const doubleScan = options?.doubleScan ?? true;

    // Step 1: Score all chunks by relevance
    const scored = this.scoreChunks(query);

    // Step 2: Filter by covenant scope
    let filtered = this.filterByScope(scored, scope);

    // Step 3: Re-validate flagged chunks through scanner pipeline (double scan)
    if (doubleScan && this.pipeline) {
      filtered = filtered.filter((sc) => {
        if (sc.chunk.validated) return true;
        // Re-scan flagged chunks
        const result = this.pipeline!.scan(sc.chunk.content);
        return result.passed;
      });
    }

    // Take top N by score
    const topN = filtered.slice(0, maxChunks);

    // Step 4: Anti-context-rot ordering
    let ordered: KnowledgeChunk[];
    if (antiContextRot && topN.length >= 3) {
      ordered = this.applyAntiContextRot(topN);
    } else {
      ordered = topN.map((sc) => sc.chunk);
    }

    // Step 5: Log retrieval
    ledger?.append("knowledge:retrieve", {
      query,
      chunksReturned: ordered.length,
      scope: scope ?? null,
      antiContextRot,
      doubleScan,
    });

    return ordered;
  }

  /**
   * Score chunks using TF-IDF-like keyword matching.
   * Returns scored chunks sorted by relevance (highest first).
   */
  private scoreChunks(query: string): ScoredChunk[] {
    const queryTerms = this.tokenise(query);
    if (queryTerms.length === 0) return [];

    // Build document frequency map across all chunks
    const docFreq = new Map<string, number>();
    for (const chunk of this.kb.chunks) {
      const terms = new Set(this.tokenise(chunk.content));
      for (const term of terms) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }

    const totalDocs = this.kb.chunks.length || 1;

    const scored: ScoredChunk[] = this.kb.chunks.map((chunk) => {
      const chunkTerms = this.tokenise(chunk.content);
      const termFreq = new Map<string, number>();
      for (const term of chunkTerms) {
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      }

      let score = 0;
      for (const qt of queryTerms) {
        const tf = (termFreq.get(qt) ?? 0) / (chunkTerms.length || 1);
        const df = docFreq.get(qt) ?? 0;
        const idf = df > 0 ? Math.log(totalDocs / df) : 0;
        score += tf * idf;
      }

      return { chunk, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  /**
   * Filter scored chunks by covenant scope.
   * If scope is provided, only return chunks whose covenantScope overlaps
   * with the requested scope. If the covenant forbids a scope, exclude it.
   */
  private filterByScope(
    scored: ScoredChunk[],
    scope?: string[]
  ): ScoredChunk[] {
    if (!scope || scope.length === 0) return scored;

    // Check covenant for forbidden scopes
    const forbiddenScopes = new Set<string>();
    if (this.covenant) {
      for (const rule of this.covenant.rules) {
        if (rule.type === "forbid" && rule.action === "knowledge:retrieve") {
          for (const cond of rule.conditions) {
            if (cond.field === "scope" && cond.operator === "==") {
              forbiddenScopes.add(String(cond.value));
            }
            if (cond.field === "scope" && cond.operator === "in" && Array.isArray(cond.value)) {
              for (const v of cond.value) {
                forbiddenScopes.add(v);
              }
            }
          }
        }
      }
    }

    // Filter: requested scope minus forbidden scopes
    const allowedScope = scope.filter((s) => !forbiddenScopes.has(s));
    if (allowedScope.length === 0) return [];

    return scored.filter((sc) => {
      // If chunk has no scope assigned, include it (unscoped content)
      if (!sc.chunk.covenantScope || sc.chunk.covenantScope.length === 0) {
        return true;
      }
      // Chunk must overlap with at least one allowed scope
      return sc.chunk.covenantScope.some((cs) => allowedScope.includes(cs));
    });
  }

  /**
   * Apply anti-context-rot ordering to counteract U-shaped attention.
   * LLMs attend strongly to the beginning and end of context but lose
   * accuracy on middle content. Place the most relevant chunks at
   * context boundaries.
   *
   * Position 1 (start): most relevant chunk
   * Position N (end):   second most relevant chunk
   * Positions 2..N-1:   remaining chunks in descending relevance
   */
  private applyAntiContextRot(scored: ScoredChunk[]): KnowledgeChunk[] {
    if (scored.length === 0) return [];
    if (scored.length === 1) return [scored[0].chunk];
    if (scored.length === 2) return scored.map((s) => s.chunk);

    const result: KnowledgeChunk[] = [];
    // Position 1: most relevant
    result.push(scored[0].chunk);
    // Middle positions: remaining in order (3rd, 4th, ...)
    for (let i = 2; i < scored.length; i++) {
      result.push(scored[i].chunk);
    }
    // Position last: second most relevant
    result.push(scored[1].chunk);

    return result;
  }

  /**
   * Tokenise text into lowercase terms for TF-IDF scoring.
   */
  private tokenise(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }
}
