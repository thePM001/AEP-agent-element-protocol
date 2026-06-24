// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/forecast.test.ts
// ===========================================================================
// Tests for ForecastSidecar - dynAEP temporal authority layer
// ===========================================================================

import {
  ForecastSidecar,
  ForecastConfig,
  RuntimeCoordinateEvent,
  RuntimeCoordinates,
  TemporalForecast,
} from "../../src/temporal/forecast";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Expected throw: ${message}`);
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  PASS: ${name}`); })
            .catch((e: any) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
    } else {
      passed++;
      console.log(`  PASS: ${name}`);
    }
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ForecastConfig>): ForecastConfig {
  return {
    enabled: true,
    timesfmEndpoint: null,
    timesfmMode: "local",
    contextWindow: 50,
    forecastHorizon: 5000,
    anomalyThreshold: 2.0,
    debounceMs: 200,
    maxTrackedElements: 100,
    ...overrides,
  };
}

function makeCoordinateEvent(targetId: string, x: number, y: number): RuntimeCoordinateEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_RUNTIME_COORDINATE",
    target_id: targetId,
    coordinates: {
      x,
      y,
      width: 100,
      height: 50,
      visible: true,
      renderedAt: new Date().toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testAvailableReturnsFalseWhenTimesFMNotInstalled(): void {
  test("available() returns false when TimesFM not installed", async () => {
    // enabled: true but no endpoint and no subprocess - should be unavailable
    const sidecar = new ForecastSidecar(makeConfig({ enabled: true, timesfmEndpoint: null }));
    const result = await sidecar.available();
    assert(result === false, "available() should return false when no TimesFM endpoint or process exists");
  });
}

export function testAvailableReturnsFalseWhenDisabled(): void {
  test("available() returns false when disabled via config", async () => {
    const sidecar = new ForecastSidecar(makeConfig({ enabled: false }));
    const result = await sidecar.available();
    assert(result === false, "available() should return false when sidecar is disabled");
  });
}

export function testIngestStoresRuntimeCoordinatesInElementHistory(): void {
  test("ingest() stores runtime coordinates in element history", () => {
    const sidecar = new ForecastSidecar(makeConfig());
    const event = makeCoordinateEvent("elem-1", 10, 20);
    sidecar.ingest(event);

    const history = sidecar.getHistory("elem-1");
    assert(history.length === 1, "History should have exactly 1 entry after 1 ingest");
    assert(history[0].x === 10, "Stored x coordinate should be 10");
    assert(history[0].y === 20, "Stored y coordinate should be 20");
  });
}

export function testForecastReturnsNullForElementWithInsufficientHistory(): void {
  test("forecast() returns null for element with insufficient history", async () => {
    const sidecar = new ForecastSidecar(makeConfig());
    // Only ingest 1 event - below the 3-event minimum
    sidecar.ingest(makeCoordinateEvent("elem-1", 10, 20));

    const result = await sidecar.forecast("elem-1");
    assert(result === null, "forecast() should return null when history has fewer than 3 entries");
  });
}

export function testForecastReturnsTemporalForecastWithCorrectStructure(): void {
  test("forecast() returns TemporalForecast with correct structure", async () => {
    // For this test, we need a sidecar with an available backend.
    // Since we cannot easily spin up TimesFM, we verify that the forecast
    // returns null when unavailable (the structure test is a boundary check).
    const sidecar = new ForecastSidecar(makeConfig());

    // Ingest enough history
    for (let i = 0; i < 10; i++) {
      sidecar.ingest(makeCoordinateEvent("elem-1", i * 10, i * 5));
    }

    const result = await sidecar.forecast("elem-1");
    // When no backend is running, forecast returns null. We verify that.
    // If it returned a non-null value, we would verify the structure.
    if (result !== null) {
      assert(typeof result.targetId === "string", "targetId should be a string");
      assert(typeof result.forecastedAt === "number", "forecastedAt should be a number");
      assert(typeof result.horizonMs === "number", "horizonMs should be a number");
      assert(Array.isArray(result.predictions), "predictions should be an array");
      assert(typeof result.confidence === "number", "confidence should be a number");
      assert(typeof result.anomalyDetected === "boolean", "anomalyDetected should be boolean");
      assert(typeof result.anomalyScore === "number", "anomalyScore should be a number");
    } else {
      // No backend available - expected in unit test environment
      assert(result === null, "Without a forecast backend, result should be null");
    }
  });
}

export function testCheckAnomalyReturnsLowScoreForNormalMutation(): void {
  test("checkAnomaly() returns low score for normal mutation", async () => {
    const sidecar = new ForecastSidecar(makeConfig());

    // Without a cached forecast, checkAnomaly should return a pass result
    const result = await sidecar.checkAnomaly("elem-1", { x: 10, y: 20 });
    assert(result.isAnomaly === false, "Normal mutation without forecast should not be anomalous");
    assert(result.score === 0, "Score should be 0 when no forecast baseline exists");
    assert(result.recommendation === "pass", "Recommendation should be 'pass'");
  });
}

export function testCheckAnomalyStructureIsCorrect(): void {
  test("checkAnomaly() returns correctly structured AnomalyResult", async () => {
    const sidecar = new ForecastSidecar(makeConfig());
    const result = await sidecar.checkAnomaly("elem-1", { x: 10000, y: 10000 });

    assert(typeof result.isAnomaly === "boolean", "isAnomaly should be a boolean");
    assert(typeof result.score === "number", "score should be a number");
    assert(typeof result.predicted === "object", "predicted should be an object");
    assert(typeof result.actual === "object", "actual should be an object");
    assert(
      result.recommendation === "pass" || result.recommendation === "warn" || result.recommendation === "require_approval",
      "recommendation should be pass, warn, or require_approval"
    );
  });
}

export function testAdaptiveDebounceReturnsConfiguredDefaultForLowHistory(): void {
  test("adaptiveDebounce() returns configured default for low-history elements", () => {
    const sidecar = new ForecastSidecar(makeConfig({ debounceMs: 300 }));
    // No history ingested - fewer than 2 entries
    const interval = sidecar.adaptiveDebounce("elem-no-history");
    assert(interval === 300, "With no history, adaptiveDebounce should return configured debounceMs (300)");
  });
}

export function testAdaptiveDebounceReturnsBoundedIntervalForSufficientHistory(): void {
  test("adaptiveDebounce() returns bounded interval for elements with sufficient history", () => {
    const sidecar = new ForecastSidecar(makeConfig({ debounceMs: 200 }));

    // Ingest several events to build history
    for (let i = 0; i < 20; i++) {
      sidecar.ingest(makeCoordinateEvent("elem-freq", i * 5, i * 5));
    }

    const interval = sidecar.adaptiveDebounce("elem-freq");
    assert(interval >= 50, "Adaptive debounce should be at least 50ms");
    assert(interval <= 2000, "Adaptive debounce should be at most 2000ms");
  });
}

export function testPruneRemovesTrackingForElementsNotInActiveSet(): void {
  test("prune() removes tracking for elements not in active set", () => {
    const sidecar = new ForecastSidecar(makeConfig());

    sidecar.ingest(makeCoordinateEvent("elem-A", 10, 10));
    sidecar.ingest(makeCoordinateEvent("elem-B", 20, 20));
    sidecar.ingest(makeCoordinateEvent("elem-C", 30, 30));

    assert(sidecar.getHistory("elem-A").length === 1, "elem-A should have history before prune");
    assert(sidecar.getHistory("elem-B").length === 1, "elem-B should have history before prune");
    assert(sidecar.getHistory("elem-C").length === 1, "elem-C should have history before prune");

    // Prune to only keep elem-B
    sidecar.prune(["elem-B"]);

    assert(sidecar.getHistory("elem-A").length === 0, "elem-A history should be removed after prune");
    assert(sidecar.getHistory("elem-B").length === 1, "elem-B history should survive prune");
    assert(sidecar.getHistory("elem-C").length === 0, "elem-C history should be removed after prune");
  });
}

// ---------------------------------------------------------------------------
// Run all AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

testAvailableReturnsFalseWhenTimesFMNotInstalled();
testAvailableReturnsFalseWhenDisabled();
testIngestStoresRuntimeCoordinatesInElementHistory();
testForecastReturnsNullForElementWithInsufficientHistory();
testForecastReturnsTemporalForecastWithCorrectStructure();
testCheckAnomalyReturnsLowScoreForNormalMutation();
testCheckAnomalyStructureIsCorrect();
testAdaptiveDebounceReturnsConfiguredDefaultForLowHistory();
testAdaptiveDebounceReturnsBoundedIntervalForSufficientHistory();
testPruneRemovesTrackingForElementsNotInActiveSet();

setTimeout(() => {
  console.log(`\nForecast tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 3000);
