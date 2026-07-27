// @PAD: /root/dynAEP/sdk/typescript/tests/rego/rego-cache.test.ts
// ===========================================================================
// Tests: OPT-002 Rego Decision Cache
// ===========================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { RegoDecisionCache, type RegoInput, type RegoResult } from "../../src/rego/RegoDecisionCache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<RegoInput> = {}): RegoInput {
  return {
    scene: {},
    registry: {},
    theme: {},
    event: {
      target_id: "CP-00001",
      type: "CUSTOM",
      dynaep_type: "AEP_MUTATE_STRUCTURE",
      mutation: { parent: "SH-00001" },
    },
    ...overrides,
  };
}

function makeResult(deny: string[] = []): RegoResult {
  return {
    structural_deny: deny,
    temporal_deny: [],
    perception_deny: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RegoDecisionCache", () => {
  let cache: RegoDecisionCache;

  beforeEach(() => {
    cache = new RegoDecisionCache(100);
  });

  it("returns null on cache miss", () => {
    const input = makeInput();
    expect(cache.lookup(input)).toBeNull();
  });

  it("returns cached result on hit", () => {
    const input = makeInput();
    const result = makeResult(["z-band violation"]);
    cache.store(input, result);

    const cached = cache.lookup(input);
    expect(cached).not.toBeNull();
    expect(cached!.structural_deny).toEqual(["z-band violation"]);
  });

  it("cache key normalizes structurally identical mutations", () => {
    // Two different element IDs with same prefix should share cache key
    const input1 = makeInput({
      event: { target_id: "CP-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: { parent: "SH-00001" } },
    });
    const input2 = makeInput({
      event: { target_id: "CP-00007", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: { parent: "SH-00002" } },
    });

    const result = makeResult(["test"]);
    cache.store(input1, result);

    // Should hit because structural signature is identical
    // (same prefix CP, same parent prefix SH, same operation)
    const cached = cache.lookup(input2);
    expect(cached).not.toBeNull();
    expect(cached!.structural_deny).toEqual(["test"]);
  });

  it("cache key distinguishes structurally different mutations", () => {
    // Different element prefixes should have different cache keys
    const input1 = makeInput({
      event: { target_id: "CP-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });
    const input2 = makeInput({
      event: { target_id: "MD-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });

    cache.store(input1, makeResult(["cp-error"]));

    // Should miss because prefix differs
    expect(cache.lookup(input2)).toBeNull();
  });

  it("distinguishes different operation types", () => {
    const input1 = makeInput({
      event: { target_id: "CP-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });
    const input2 = makeInput({
      event: { target_id: "CP-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_BEHAVIOUR", mutation: {} },
    });

    cache.store(input1, makeResult(["struct"]));
    expect(cache.lookup(input2)).toBeNull();
  });

  it("distinguishes presence/absence of perception annotations", () => {
    const input1 = makeInput({
      perception: { modality: "speech", annotations: { syllable_rate: 5.0 } },
    });
    const input2 = makeInput();

    cache.store(input1, makeResult(["with-perception"]));
    expect(cache.lookup(input2)).toBeNull();
  });

  it("invalidation clears all entries", () => {
    const input = makeInput();
    cache.store(input, makeResult(["test"]));
    expect(cache.lookup(input)).not.toBeNull();

    cache.invalidate();
    expect(cache.lookup(input)).toBeNull();
  });

  it("LRU eviction removes least recently used", () => {
    const smallCache = new RegoDecisionCache(3);
    const prefixes = ["CP", "PN", "MD", "TT"];

    // Fill cache with 3 entries
    for (let i = 0; i < 3; i++) {
      const input = makeInput({
        event: { target_id: `${prefixes[i]}-00001`, type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
      });
      smallCache.store(input, makeResult([`entry-${i}`]));
    }

    // Access first entry to make it most recently used
    const first = makeInput({
      event: { target_id: "CP-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });
    smallCache.lookup(first);

    // Add a 4th entry -- should evict the LRU (PN entry)
    const fourth = makeInput({
      event: { target_id: `${prefixes[3]}-00001`, type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });
    smallCache.store(fourth, makeResult(["entry-3"]));

    // CP should still be cached (was accessed recently)
    expect(smallCache.lookup(first)).not.toBeNull();

    // PN should be evicted (was LRU)
    const second = makeInput({
      event: { target_id: "PN-00001", type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });
    expect(smallCache.lookup(second)).toBeNull();

    // TT should be cached
    expect(smallCache.lookup(fourth)).not.toBeNull();
  });

  it("eviction does not affect correctness", () => {
    const smallCache = new RegoDecisionCache(2);
    // Use distinct prefixes so each produces a different cache key
    const prefixes = ["CP", "PN", "MD", "TT", "SH", "OV", "WD", "TB", "CZ", "CN"];

    // Fill and evict
    for (let i = 0; i < 10; i++) {
      const input = makeInput({
        event: { target_id: `${prefixes[i]}-00001`, type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
      });
      smallCache.store(input, makeResult([`result-${i}`]));
    }

    // Cache should have exactly 2 entries (capacity)
    expect(smallCache.stats().size).toBe(2);
    expect(smallCache.stats().evictions).toBeGreaterThan(0);
  });

  it("stats accurately report hits, misses, evictions", () => {
    const input = makeInput();
    const result = makeResult(["test"]);

    // Miss
    cache.lookup(input);
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);

    // Store and hit
    cache.store(input, result);
    cache.lookup(input);
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().misses).toBe(1);

    // Size
    expect(cache.stats().size).toBe(1);
    expect(cache.stats().maxSize).toBe(100);
  });

  it("updating existing key does not increase size", () => {
    const input = makeInput();
    cache.store(input, makeResult(["first"]));
    cache.store(input, makeResult(["second"]));

    expect(cache.stats().size).toBe(1);
    expect(cache.lookup(input)!.structural_deny).toEqual(["second"]);
  });
});
