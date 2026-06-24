#!/usr/bin/env node

import { createHash } from "node:crypto";

export const DEFAULT_EMBEDDING_DIM = 128;

/** Deterministic pseudo-embedding aligned with sdk-aep-memory-base-node deriveEmbedding. */
export function deriveEmbedding(entry, dim = DEFAULT_EMBEDDING_DIM) {
  const seed = createHash("sha256")
    .update(
      JSON.stringify({
        element_id: entry.element_id,
        domain: entry.domain,
        proposal: entry.proposal,
        result: entry.result,
      }),
    )
    .digest();
  const out = new Array(dim);
  for (let i = 0; i < dim; i++) {
    out[i] = seed[i % seed.length] / 127.5 - 1.0;
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => v / norm);
}