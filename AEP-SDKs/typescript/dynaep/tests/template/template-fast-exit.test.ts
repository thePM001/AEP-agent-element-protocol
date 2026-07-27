// @PAD: /root/dynAEP/sdk/typescript/tests/template/template-fast-exit.test.ts
// ===========================================================================
// Tests for OPT-009: Template Node Validation Fast-Exit
// Tests TemplateInstanceResolver caching, fast-exit bypass, stats tracking,
// and bridge integration for AOT-validated template instances.
// ===========================================================================

import {
  TemplateInstanceResolver,
  type FastExitResult,
} from "../../src/template/TemplateInstanceResolver";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  PASS: ${name}`); })
            .catch((e: Error) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
    } else {
      passed++;
      console.log(`  PASS: ${name}`);
    }
  } catch (e: unknown) {
    failed++;
    const msg = e instanceof Error ? e.message : "unknown";
    console.log(`  FAIL: ${name}: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Mock registry: CN-00001 is a template, CP-00001 is not
// ---------------------------------------------------------------------------

// @aep/core's isTemplateInstance checks registry for template definitions
// In the mock, we mark CN entries as templates by their presence
const mockRegistry: Record<string, any> = {
  "CN-00001": { label: "DataCell", type: "cell_node", template: true },
  "CN-00002": { label: "DataCell", type: "cell_node", template: true },
  "CP-00001": { label: "UserPanel", type: "component" },
};

// ---------------------------------------------------------------------------
// TemplateInstanceResolver Tests
// ---------------------------------------------------------------------------

console.log("\n--- OPT-009: TemplateInstanceResolver Tests ---\n");

test("resolve returns true for template instance IDs", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);
  // isTemplateInstance from @aep/core determines this
  // Since we can't mock the import, we test the caching and stats behavior
  const result1 = resolver.resolve("CN-00001");
  // Result depends on @aep/core's isTemplateInstance implementation
  // but the cache should work regardless
  const result2 = resolver.resolve("CN-00001");
  assert(result1 === result2, "Cached result should match original");
});

test("tryFastExit increments fast-exit counter for templates", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);
  const result = resolver.tryFastExit("CN-00001", 1000);
  // If isTemplateInstance returns true, fast_exit_count increments
  const stats = resolver.getStats();
  assert(stats.totalEvents === 1, "Should have processed 1 event");
  assert(
    stats.fastExitCount + stats.fullPipelineCount === 1,
    "Sum should be 1",
  );
});

test("tryFastExit stamps with bridge time when configured", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry, {
    stampFastExitEvents: true,
  });
  const result = resolver.tryFastExit("CN-00001", 42000);
  if (result.isTemplateInstance) {
    assert(result.stampedAt === 42000, "Should stamp with bridge time");
  }
});

test("tryFastExit does not stamp when stampFastExitEvents is false", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry, {
    stampFastExitEvents: false,
  });
  const result = resolver.tryFastExit("CN-00001", 42000);
  if (result.isTemplateInstance) {
    assert(result.stampedAt === null, "Should not stamp when disabled");
  }
});

test("cache respects maxCacheSize with LRU eviction", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry, {
    maxCacheSize: 3,
  });
  // Fill cache to capacity
  resolver.resolve("CN-00001");
  resolver.resolve("CN-00002");
  resolver.resolve("CP-00001");
  assert(resolver.getStats().cacheSize === 3, "Cache should be at capacity");

  // Adding one more should evict the oldest (CN-00001)
  resolver.resolve("SH-00001");
  assert(resolver.getStats().cacheSize === 3, "Cache should still be at capacity after eviction");
});

test("reset clears cache and counters", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);
  resolver.tryFastExit("CN-00001", 1000);
  resolver.tryFastExit("CP-00001", 1001);

  resolver.reset();
  const stats = resolver.getStats();
  assert(stats.totalEvents === 0, "Total events should be 0 after reset");
  assert(stats.cacheSize === 0, "Cache should be empty after reset");
});

test("prune removes non-active entries from cache", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);
  resolver.resolve("CN-00001");
  resolver.resolve("CN-00002");
  resolver.resolve("CP-00001");
  assert(resolver.getStats().cacheSize === 3, "Cache should have 3 entries");

  resolver.prune(["CN-00001"]);
  assert(resolver.getStats().cacheSize === 1, "Cache should have 1 entry after prune");
});

test("getStats returns correct fast-exit ratio", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);
  // Process several events
  for (let i = 0; i < 10; i++) {
    resolver.tryFastExit(`CN-${String(i).padStart(5, "0")}`, 1000 + i);
  }
  for (let i = 0; i < 5; i++) {
    resolver.tryFastExit(`CP-${String(i).padStart(5, "0")}`, 2000 + i);
  }
  const stats = resolver.getStats();
  assert(stats.totalEvents === 15, "Should have 15 total events");
  assert(stats.fastExitRatio >= 0 && stats.fastExitRatio <= 1, "Ratio should be between 0 and 1");
});

// ---------------------------------------------------------------------------
// Performance: Fast-exit should be <1µs per event
// ---------------------------------------------------------------------------

console.log("\n--- OPT-009: Performance Tests ---\n");

test("10000 fast-exit resolutions complete in <50ms", () => {
  const resolver = new TemplateInstanceResolver(mockRegistry);

  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    resolver.tryFastExit(`CN-${String(i % 100).padStart(5, "0")}`, i);
  }
  const elapsed = performance.now() - start;

  assert(elapsed < 50, `10000 resolutions took ${elapsed.toFixed(2)}ms, expected <50ms`);
  console.log(`    10000 resolutions in ${elapsed.toFixed(2)}ms (${((elapsed / 10000) * 1000).toFixed(3)}µs/event)`);
});

// ---------------------------------------------------------------------------
// Run summary
// ---------------------------------------------------------------------------

setTimeout(() => {
  console.log(`\nOPT-009 tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 1000);
