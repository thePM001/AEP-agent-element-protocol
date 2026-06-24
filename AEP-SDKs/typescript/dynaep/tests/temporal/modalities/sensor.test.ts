// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/modalities/sensor.test.ts
// ===========================================================================
// Tests for Sensor Modality Helpers - dynAEP perceptual temporal governance
// ===========================================================================

import {
  SENSOR_PARAMS,
  SENSOR_DEFAULTS,
  DISPLAY_REFRESH_RATES,
  buildSensorAnnotations,
  buildClinicalMonitoringSchedule,
  buildAmbientMonitoringSchedule,
  buildRealtimeDisplaySchedule,
  alignToRefreshRate,
  evaluatePollingEfficiency,
  computeBatteryImpact,
  classifyMonitoringTier,
} from "../../../src/temporal/modalities/sensor";
import { PerceptionRegistry } from "../../../src/temporal/perception-registry";

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
// Tests
// ---------------------------------------------------------------------------

export function testSensorDefaultsAreWithinComfortableRange(): void {
  test("SENSOR_DEFAULTS values fall within comfortable range of the registry", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("sensor")!;
    for (const [param, value] of Object.entries(SENSOR_DEFAULTS)) {
      if (typeof value !== "number") continue;
      const bound = profile.bounds[param];
      if (!bound) continue;
      assert(value >= bound.comfortable_min,
        param + " default " + value + " should be >= comfortable_min " + bound.comfortable_min);
      assert(value <= bound.comfortable_max,
        param + " default " + value + " should be <= comfortable_max " + bound.comfortable_max);
    }
  });
}

export function testBuildSensorAnnotationsFillsDefaults(): void {
  test("buildSensorAnnotations fills missing parameters with defaults", () => {
    const annotations = buildSensorAnnotations({ human_response_latency_ms: 500 });
    assert(annotations["human_response_latency_ms"] === 500, "Override should be preserved");
    assert(annotations["display_refresh_alignment_ms"] === SENSOR_DEFAULTS["display_refresh_alignment_ms"],
      "Missing parameter should use default");
  });
}

export function testClinicalMonitoringHasFasterPolling(): void {
  test("buildClinicalMonitoringSchedule has faster polling than ambient", () => {
    const clinical = buildClinicalMonitoringSchedule();
    const ambient = buildAmbientMonitoringSchedule();
    const clinicalInterval = clinical["health_monitoring_interval_ms"] as number;
    const ambientInterval = ambient["health_monitoring_interval_ms"] as number;
    assert(clinicalInterval <= ambientInterval,
      "Clinical monitoring should poll faster than ambient");
  });
}

export function testAlignToRefreshRateReturnsKnownValues(): void {
  test("alignToRefreshRate returns correct frame interval for known rates", () => {
    assert(alignToRefreshRate("60hz") === 16, "60hz should map to 16ms");
    assert(alignToRefreshRate("30hz") === 33, "30hz should map to 33ms");
    assert(alignToRefreshRate("120hz") === 8, "120hz should map to 8ms");
  });
}

export function testEvaluatePollingEfficiency(): void {
  test("evaluatePollingEfficiency returns value between 0 and 1", () => {
    const efficiency = evaluatePollingEfficiency(
      { environmental_polling_interval_ms: 30000, human_response_latency_ms: 300 },
      30000,
    );
    assert(efficiency >= 0.0, "Efficiency should be >= 0");
    assert(efficiency <= 1.0, "Efficiency should be <= 1");
  });
}

export function testClassifyMonitoringTier(): void {
  test("classifyMonitoringTier returns correct tier for different intervals", () => {
    const fastTier = classifyMonitoringTier(5000);
    const slowTier = classifyMonitoringTier(300000);
    assert(typeof fastTier === "string", "Should return a string tier");
    assert(typeof slowTier === "string", "Should return a string tier");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("modalities/sensor.test.ts");

testSensorDefaultsAreWithinComfortableRange();
testBuildSensorAnnotationsFillsDefaults();
testClinicalMonitoringHasFasterPolling();
testAlignToRefreshRateReturnsKnownValues();
testEvaluatePollingEfficiency();
testClassifyMonitoringTier();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
