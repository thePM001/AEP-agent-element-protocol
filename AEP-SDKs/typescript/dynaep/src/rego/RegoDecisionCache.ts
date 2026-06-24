// @PAD: /root/dynAEP/sdk/typescript/src/rego/RegoDecisionCache.ts
// ===========================================================================
// OPT-002: Rego Decision Cache
// LRU cache for Rego policy evaluation results keyed by structural signature.
// Cache key captures only structural properties that affect Rego decisions,
// NOT instance-specific values (specific IDs, timestamps, coordinates).
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegoInput {
  scene: Record<string, unknown>;
  registry: Record<string, unknown>;
  theme: Record<string, unknown>;
  event?: {
    target_id?: string;
    type?: string;
    mutation?: Record<string, unknown>;
    [key: string]: unknown;
  };
  temporal?: Record<string, unknown>;
  causal?: Record<string, unknown>;
  perception?: Record<string, unknown>;
  config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegoResult {
  structural_deny: string[];
  temporal_deny: string[];
  perception_deny: string[];
  temporal_warn?: string[];
  perception_warn?: string[];
  temporal_escalate?: string[];
  perception_escalate?: string[];
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
}

interface CacheEntry {
  key: string;
  result: RegoResult;
  prev: CacheEntry | null;
  next: CacheEntry | null;
}

// ---------------------------------------------------------------------------
// Cache Key Computation
// ---------------------------------------------------------------------------

/**
 * Extract cache-relevant structural signature fields from a RegoInput.
 * The key captures ONLY properties that affect Rego evaluation outcomes.
 */
function computeCacheKeyFields(input: RegoInput): Record<string, unknown> {
  const event = input.event ?? {};
  const targetId = (event.target_id ?? "") as string;
  const mutation = (event.mutation ?? {}) as Record<string, unknown>;

  // Element prefix (first 2 chars of target ID)
  const elementPrefix = targetId.length >= 2 ? targetId.substring(0, 2) : "";

  // Determine mutation operation type
  let operationType = "unknown";
  if (event.type === "STATE_DELTA") {
    operationType = "state_delta";
  } else if (typeof event.dynaep_type === "string") {
    const dt = event.dynaep_type as string;
    if (dt === "AEP_MUTATE_STRUCTURE") {
      operationType = mutation.parent ? "move" : "skin_change";
      if (mutation.anchors) operationType = "move";
    } else if (dt === "AEP_MUTATE_BEHAVIOUR") {
      operationType = "behaviour_change";
    } else if (dt === "AEP_MUTATE_SKIN") {
      operationType = "skin_change";
    } else {
      operationType = dt;
    }
  }

  // Z-band validity (boolean)
  const scene = input.scene ?? {};
  const targetScene = scene[targetId] as Record<string, unknown> | undefined;
  let zBandValid = true;
  if (targetScene && typeof targetScene.z === "number") {
    // Z-band validity is what matters, not the specific z value
    const z = targetScene.z as number;
    const bands: Record<string, [number, number]> = {
      SH: [0, 9], PN: [10, 19], NV: [10, 19], CP: [20, 29],
      FM: [20, 29], IC: [20, 29], CZ: [30, 39], CN: [30, 39],
      TB: [40, 49], WD: [50, 59], OV: [60, 69], MD: [70, 79],
      DD: [70, 79], TT: [80, 89],
    };
    const band = bands[elementPrefix];
    if (band) {
      zBandValid = z >= band[0] && z <= band[1];
    }
  }

  // Parent element prefix
  let parentPrefix = "";
  if (targetScene && typeof targetScene.parent === "string") {
    const parentId = targetScene.parent as string;
    parentPrefix = parentId.length >= 2 ? parentId.substring(0, 2) : "";
  }

  // Perception annotations presence and modality
  const perception = input.perception as Record<string, unknown> | undefined;
  const hasPerception = perception !== undefined && perception !== null;
  const modalityType = hasPerception ? (perception.modality ?? "") : "";
  const hasTemporalAnnotations = input.temporal !== undefined && input.temporal !== null;

  // Active modality count (for cross-modality rules)
  let activeModalityCount = 0;
  if (hasPerception && typeof perception.active_modalities === "number") {
    activeModalityCount = perception.active_modalities as number;
  }

  return {
    p: elementPrefix,
    op: operationType,
    zv: zBandValid,
    pp: parentPrefix,
    ht: hasTemporalAnnotations,
    hp: hasPerception,
    mt: modalityType,
    amc: activeModalityCount,
  };
}

/**
 * Compute a deterministic cache key string from structural signature fields.
 * Uses stable JSON serialization (sorted keys) for determinism.
 */
function computeCacheKey(input: RegoInput): string {
  const fields = computeCacheKeyFields(input);
  // Sort keys for deterministic serialization
  const keys = Object.keys(fields).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const val = fields[key];
    parts.push(`${key}:${JSON.stringify(val)}`);
  }
  return parts.join("|");
}

// ---------------------------------------------------------------------------
// LRU Cache Implementation
// ---------------------------------------------------------------------------

export class RegoDecisionCache {
  private readonly maxSize: number;
  private readonly map: Map<string, CacheEntry> = new Map();

  // Doubly-linked list sentinels for LRU ordering
  private readonly head: CacheEntry;
  private readonly tail: CacheEntry;

  // Stats
  private hitCount = 0;
  private missCount = 0;
  private evictionCount = 0;

  constructor(maxSize = 5000) {
    this.maxSize = maxSize;

    // Sentinel nodes (never evicted, never in the map)
    this.head = { key: "__HEAD__", result: { structural_deny: [], temporal_deny: [], perception_deny: [] }, prev: null, next: null };
    this.tail = { key: "__TAIL__", result: { structural_deny: [], temporal_deny: [], perception_deny: [] }, prev: null, next: null };
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Look up a cached Rego result by structural signature.
   * Returns the cached result on hit, null on miss.
   * Promotes the entry to most-recently-used on hit.
   */
  lookup(input: RegoInput): RegoResult | null {
    const key = computeCacheKey(input);
    const entry = this.map.get(key);

    if (!entry) {
      this.missCount++;
      return null;
    }

    this.hitCount++;
    // Move to front (most recently used)
    this.removeNode(entry);
    this.addToFront(entry);

    return entry.result;
  }

  /**
   * Store a Rego evaluation result under its structural signature key.
   * Evicts least-recently-used entries if the cache is full.
   */
  store(input: RegoInput, result: RegoResult): void {
    const key = computeCacheKey(input);

    // If key already exists, update and promote
    const existing = this.map.get(key);
    if (existing) {
      existing.result = result;
      this.removeNode(existing);
      this.addToFront(existing);
      return;
    }

    // Evict if at capacity
    if (this.map.size >= this.maxSize) {
      const lru = this.tail.prev!;
      if (lru !== this.head) {
        this.removeNode(lru);
        this.map.delete(lru.key);
        this.evictionCount++;
      }
    }

    // Insert new entry at front
    const entry: CacheEntry = { key, result, prev: null, next: null };
    this.addToFront(entry);
    this.map.set(key, entry);
  }

  /**
   * Clear the entire cache. Called on policy reload.
   */
  invalidate(): void {
    this.map.clear();
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /**
   * Return cache statistics.
   */
  stats(): CacheStats {
    return {
      hits: this.hitCount,
      misses: this.missCount,
      evictions: this.evictionCount,
      size: this.map.size,
      maxSize: this.maxSize,
    };
  }

  // -----------------------------------------------------------------------
  // Linked list helpers
  // -----------------------------------------------------------------------

  private removeNode(node: CacheEntry): void {
    const prev = node.prev;
    const next = node.next;
    if (prev) prev.next = next;
    if (next) next.prev = prev;
    node.prev = null;
    node.next = null;
  }

  private addToFront(node: CacheEntry): void {
    node.next = this.head.next;
    node.prev = this.head;
    if (this.head.next) this.head.next.prev = node;
    this.head.next = node;
  }
}
