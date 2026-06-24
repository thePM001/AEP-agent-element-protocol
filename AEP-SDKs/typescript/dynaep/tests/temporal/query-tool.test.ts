// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/query-tool.test.ts
// ===========================================================================
// Tests for TemporalQueryTool - dynAEP perceptual temporal governance
// ===========================================================================

import { PerceptionRegistry } from "../../src/temporal/perception-registry";
import { BridgeClock, type ClockConfig } from "../../src/temporal/clock";
import { DynAEPTemporalAuthority, type TemporalAuthorityConfig } from "../../src/temporal/authority";
import { PerceptionEngine, type PerceptionEngineConfig } from "../../src/temporal/perception-engine";
import { TemporalQueryTool, type TemporalQueryInput } from "../../src/temporal/query-tool";

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

function makeQueryTool(): TemporalQueryTool {
  const registry = new PerceptionRegistry();
  const clockConfig: ClockConfig = {
    protocol: "system",
    source: "localhost",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
  };
  const clock = new BridgeClock(clockConfig);
  const authorityConfig: TemporalAuthorityConfig = {
    auditTrailDepth: 500,
    mutationTrackingEnabled: true,
    stalenessBroadcastIntervalMs: 10000,
  };
  const authority = new DynAEPTemporalAuthority(clock, authorityConfig);
  const engineConfig: PerceptionEngineConfig = {
    enableAdaptiveProfiles: true,
    profileLearningRate: 0.15,
    profileErosionHalfLifeMs: 604800000,
    minInteractionsForProfile: 5,
    hardViolationAction: "clamp",
    softViolationAction: "clamp",
    governedEnvelopeMode: "overwrite",
  };
  const engine = new PerceptionEngine(registry, authority, null, engineConfig);
  return new TemporalQueryTool(registry, engine, authority);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testListModalities(): void {
  test("list_modalities returns all five registered modalities", () => {
    const tool = makeQueryTool();
    const result = tool.execute({ operation: "list_modalities" });
    assert(result.success === true, "Should succeed");
    assert(result.error === null, "Should have no error");
    assert(result.modalities !== undefined, "Should have modalities array");
    assert(result.modalities!.length === 5, "Should list 5 modalities");
  });
}

export function testGetModalityBoundsReturnsSpeechProfile(): void {
  test("get_modality_bounds returns speech profile with bounds", () => {
    const tool = makeQueryTool();
    const result = tool.execute({ operation: "get_modality_bounds", modality: "speech" });
    assert(result.success === true, "Should succeed");
    assert(result.modalityProfile !== undefined, "Should have modalityProfile");
    assert(result.modalityProfile !== null, "Speech profile should not be null");
    assert(result.modalityProfile!.modality === "speech", "Profile should be for speech");
  });
}

export function testGetModalityBoundsRequiresModality(): void {
  test("get_modality_bounds fails when modality is missing", () => {
    const tool = makeQueryTool();
    const result = tool.execute({ operation: "get_modality_bounds" });
    assert(result.success === false, "Should fail without modality");
    assert(result.error !== null, "Should have error message");
  });
}

export function testValidateAnnotationsDetectsViolation(): void {
  test("validate_annotations detects violations for exceeded bounds", () => {
    const tool = makeQueryTool();
    const result = tool.execute({
      operation: "validate_annotations",
      modality: "speech",
      annotations: { syllable_rate: 10.0 },
    });
    assert(result.success === true, "Should succeed");
    assert(result.validationResult !== undefined, "Should have validationResult");
    assert(result.validationResult!.violations.length > 0, "Should have violations");
  });
}

export function testGovernPreviewReturnsEnvelope(): void {
  test("govern_preview returns a governed envelope for hypothesized annotations", () => {
    const tool = makeQueryTool();
    const result = tool.execute({
      operation: "govern_preview",
      modality: "speech",
      annotations: { syllable_rate: 10.0 },
    });
    assert(result.success === true, "Should succeed");
    assert(result.governedEnvelope !== undefined, "Should have governedEnvelope");
    assert(result.governedEnvelope!.violations.length > 0, "Should report violations");
  });
}

export function testComfortableRangeReturnsMinMax(): void {
  test("comfortable_range returns min/max for known modality+parameter", () => {
    const tool = makeQueryTool();
    const result = tool.execute({
      operation: "comfortable_range",
      modality: "speech",
      parameter: "syllable_rate",
    });
    assert(result.success === true, "Should succeed");
    assert(result.comfortableRange !== null, "Should have comfortable range");
    assert(result.comfortableRange!.min < result.comfortableRange!.max,
      "min should be less than max");
  });
}

export function testStalenessCheckDetectsStaleTimestamp(): void {
  test("staleness_check correctly identifies stale timestamps", () => {
    const tool = makeQueryTool();
    const oldTime = Date.now() - 120000;  // 2 minutes ago
    const result = tool.execute({
      operation: "staleness_check",
      referenceTimestampMs: oldTime,
      maxAgeMs: 5000,
    });
    assert(result.success === true, "Should succeed");
    assert(result.isStale === true, "2-minute-old timestamp should be stale with 5s threshold");
  });
}

export function testUnknownOperationReturnsError(): void {
  test("Unknown operation returns error result", () => {
    const tool = makeQueryTool();
    const result = tool.execute({ operation: "nonexistent_op" as any });
    assert(result.success === false, "Should fail for unknown operation");
    assert(result.error !== null, "Should have error message");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("query-tool.test.ts");

testListModalities();
testGetModalityBoundsReturnsSpeechProfile();
testGetModalityBoundsRequiresModality();
testValidateAnnotationsDetectsViolation();
testGovernPreviewReturnsEnvelope();
testComfortableRangeReturnsMinMax();
testStalenessCheckDetectsStaleTimestamp();
testUnknownOperationReturnsError();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
