// @PAD: /root/dynAEP/sdk/typescript/src/template/TemplateInstanceResolver.ts
// ===========================================================================
// @dynaep/core - Template Instance Resolver
// Resolves whether a target element is an AOT-validated template instance.
// Template instances carry the CN prefix and reference a template that has
// already passed compile-time validation. At runtime, mutations targeting
// template instances can skip the full validation pipeline (temporal,
// causal, forecast, structural) because their invariants were verified
// at compile time.
//
// OPT-009: Template Node Validation Fast-Exit
// ===========================================================================

import { isTemplateInstance } from "@aep/core";
import type { AEPRegistryEntry } from "@aep/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateResolverConfig {
  /** Maximum number of resolved entries cached (LRU eviction). */
  maxCacheSize: number;
  /** Whether to stamp fast-exit events with temporal metadata. */
  stampFastExitEvents: boolean;
}

export interface FastExitResult {
  /** True if the event targets an AOT-validated template instance. */
  isTemplateInstance: boolean;
  /** The template ID the instance derives from, or null. */
  templateId: string | null;
  /** Bridge-authoritative timestamp attached to the fast-exit event. */
  stampedAt: number | null;
}

// ---------------------------------------------------------------------------
// TemplateInstanceResolver
// ---------------------------------------------------------------------------

export class TemplateInstanceResolver {
  private readonly registry: Record<string, AEPRegistryEntry>;
  private readonly config: TemplateResolverConfig;
  private readonly cache: Map<string, boolean>;
  private fastExitCount: number;
  private fullPipelineCount: number;

  constructor(
    registry: Record<string, AEPRegistryEntry>,
    config?: Partial<TemplateResolverConfig>,
  ) {
    this.registry = registry;
    this.config = {
      maxCacheSize: config?.maxCacheSize ?? 10_000,
      stampFastExitEvents: config?.stampFastExitEvents ?? true,
    };
    this.cache = new Map();
    this.fastExitCount = 0;
    this.fullPipelineCount = 0;
  }

  // -------------------------------------------------------------------------
  // Resolution
  // -------------------------------------------------------------------------

  /**
   * Check whether a target element ID is an AOT-validated template instance.
   * Uses a bounded LRU cache for O(1) amortised lookups after the first
   * resolution. The underlying `isTemplateInstance` from `@aep/core` is
   * called only on cache miss.
   *
   * @param targetId - The element identifier to resolve.
   * @returns True if the element is a template instance.
   */
  resolve(targetId: string): boolean {
    // Fast path: cache hit
    const cached = this.cache.get(targetId);
    if (cached !== undefined) {
      return cached;
    }

    // Slow path: delegate to @aep/core
    const result = isTemplateInstance(targetId, this.registry);

    // LRU eviction: remove oldest entry if at capacity
    if (this.cache.size >= this.config.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(targetId, result);
    return result;
  }

  /**
   * Attempt a fast-exit for the given event. If the event targets a
   * template instance, returns a FastExitResult with isTemplateInstance=true
   * and increments the fast-exit counter. Otherwise returns
   * isTemplateInstance=false, incrementing the full-pipeline counter.
   *
   * @param targetId - The element identifier from the event.
   * @param bridgeTimeMs - The current bridge-authoritative time in ms.
   * @returns The fast-exit resolution result.
   */
  tryFastExit(targetId: string, bridgeTimeMs: number): FastExitResult {
    const isTemplate = this.resolve(targetId);

    if (isTemplate) {
      this.fastExitCount++;
      return {
        isTemplateInstance: true,
        templateId: this.findTemplateId(targetId),
        stampedAt: this.config.stampFastExitEvents ? bridgeTimeMs : null,
      };
    }

    this.fullPipelineCount++;
    return {
      isTemplateInstance: false,
      templateId: null,
      stampedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // Template ID Lookup
  // -------------------------------------------------------------------------

  /**
   * Find the template ID that this instance derives from. Template
   * instances use a prefix-based naming convention: the registry contains
   * the template definition under the base prefix, and instances share
   * the same prefix with higher numeric suffixes.
   *
   * @param instanceId - The instance element ID.
   * @returns The template ID if found, or null.
   */
  private findTemplateId(instanceId: string): string | null {
    // Check direct registry entry first
    if (this.registry[instanceId]) {
      return instanceId;
    }

    // Template instances share their prefix with the template definition.
    // Look for the first registry entry with the same prefix.
    const prefix = instanceId.substring(0, 2);
    for (const key of Object.keys(this.registry)) {
      if (key.startsWith(prefix)) {
        return key;
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  /**
   * Return fast-exit statistics for monitoring and benchmarking.
   */
  getStats(): {
    fastExitCount: number;
    fullPipelineCount: number;
    totalEvents: number;
    fastExitRatio: number;
    cacheSize: number;
  } {
    const total = this.fastExitCount + this.fullPipelineCount;
    return {
      fastExitCount: this.fastExitCount,
      fullPipelineCount: this.fullPipelineCount,
      totalEvents: total,
      fastExitRatio: total > 0 ? this.fastExitCount / total : 0,
      cacheSize: this.cache.size,
    };
  }

  /**
   * Reset counters and cache. Used in tests and benchmarks.
   */
  reset(): void {
    this.cache.clear();
    this.fastExitCount = 0;
    this.fullPipelineCount = 0;
  }

  /**
   * Prune cache entries not in the given set of active element IDs.
   */
  prune(activeIds: string[]): void {
    const activeSet = new Set(activeIds);
    for (const key of this.cache.keys()) {
      if (!activeSet.has(key)) {
        this.cache.delete(key);
      }
    }
  }
}
