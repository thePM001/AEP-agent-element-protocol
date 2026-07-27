// @PAD: /root/dynAEP/sdk/typescript/src/lattice/FeatureExtractor.ts
// ===========================================================================
// @dynaep/core - Feature Extractor for Lattice Memory Attractors
// OPT-007: Converts proposals and attractors into fixed-dimension feature
// vectors for locality-sensitive hashing. Features capture structural
// properties that determine validation equivalence.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal proposal/attractor interface for feature extraction.
 * These fields map to the structural properties that determine
 * whether two proposals would receive the same validation verdict.
 */
export interface FeatureSource {
  elementType?: string;
  zBand?: number;
  parentType?: string;
  mutationType?: string;
  constraintCount?: number;
  skinBinding?: string;
  stateCount?: number;
  hasChildren?: boolean;
  depth?: number;
  id?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total feature vector dimension */
export const FEATURE_DIMENSION = 48;

/** Known element type prefixes for one-hot encoding */
const ELEMENT_TYPES: readonly string[] = [
  "SH", "PN", "CP", "NV", "CZ", "CN", "TB", "WD",
  "OV", "MD", "DD", "TT", "FM", "IC",
] as const;

/** Known mutation operation types */
const MUTATION_TYPES: readonly string[] = [
  "create", "update", "delete", "move", "reparent",
  "restyle", "reorder", "state_change",
] as const;

// ---------------------------------------------------------------------------
// Feature Extraction
// ---------------------------------------------------------------------------

/**
 * Simple deterministic string hash that produces a number in [0, 1).
 * Used to convert string identifiers into numeric features.
 */
function stringHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Normalize to [0, 1)
  return (Math.abs(hash) % 10000) / 10000;
}

/**
 * Extract a fixed-dimension feature vector from a proposal or attractor.
 * The feature vector captures structural properties that determine
 * validation equivalence:
 *
 * Features [0-13]:  Element type one-hot encoding (14 types)
 * Feature  [14]:    Z-band normalized to [0, 1]
 * Features [15-28]: Parent type one-hot encoding (14 types)
 * Features [29-36]: Mutation operation type one-hot (8 types)
 * Feature  [37]:    Constraint count (normalized by dividing by 20)
 * Feature  [38]:    Skin binding hash (0-1)
 * Feature  [39]:    State count (normalized by dividing by 10)
 * Feature  [40]:    Has children (0 or 1)
 * Feature  [41]:    Depth in scene graph (normalized by dividing by 20)
 * Features [42-47]: Reserved / padding (zeros)
 *
 * Total: 48 features (FEATURE_DIMENSION)
 */
export function extractFeatures(source: FeatureSource): Float32Array {
  const features = new Float32Array(FEATURE_DIMENSION);

  // Element type one-hot [0-13]
  if (source.elementType) {
    const prefix = source.elementType.length >= 2
      ? source.elementType.substring(0, 2).toUpperCase()
      : source.elementType.toUpperCase();
    const idx = ELEMENT_TYPES.indexOf(prefix);
    if (idx >= 0 && idx < 14) {
      features[idx] = 1.0;
    }
  } else if (source.id) {
    // Infer from ID prefix
    const prefix = source.id.substring(0, 2).toUpperCase();
    const idx = ELEMENT_TYPES.indexOf(prefix);
    if (idx >= 0 && idx < 14) {
      features[idx] = 1.0;
    }
  }

  // Z-band normalized [14]
  if (source.zBand !== undefined) {
    features[14] = Math.min(1.0, Math.max(0.0, source.zBand / 1000));
  }

  // Parent type one-hot [15-28]
  if (source.parentType) {
    const prefix = source.parentType.length >= 2
      ? source.parentType.substring(0, 2).toUpperCase()
      : source.parentType.toUpperCase();
    const idx = ELEMENT_TYPES.indexOf(prefix);
    if (idx >= 0 && idx < 14) {
      features[15 + idx] = 1.0;
    }
  }

  // Mutation type one-hot [29-36]
  if (source.mutationType) {
    const idx = MUTATION_TYPES.indexOf(source.mutationType.toLowerCase());
    if (idx >= 0 && idx < 8) {
      features[29 + idx] = 1.0;
    }
  }

  // Constraint count normalized [37]
  if (source.constraintCount !== undefined) {
    features[37] = Math.min(1.0, source.constraintCount / 20);
  }

  // Skin binding hash [38]
  if (source.skinBinding) {
    features[38] = stringHash(source.skinBinding);
  }

  // State count normalized [39]
  if (source.stateCount !== undefined) {
    features[39] = Math.min(1.0, source.stateCount / 10);
  }

  // Has children [40]
  if (source.hasChildren !== undefined) {
    features[40] = source.hasChildren ? 1.0 : 0.0;
  }

  // Depth normalized [41]
  if (source.depth !== undefined) {
    features[41] = Math.min(1.0, source.depth / 20);
  }

  return features;
}

/**
 * Compute cosine similarity between two feature vectors.
 * Returns a value in [-1, 1], where 1 means identical direction.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
