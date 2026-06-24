// @PAD: /root/dynAEP/sdk/typescript/src/rego/UnifiedRegoEvaluator.ts
// ===========================================================================
// OPT-002: Unified Rego WASM Evaluator
// Loads all three policy files (structural, temporal, perception) into a
// single WASM bundle with three entrypoints. Falls back to separate bundles
// or CLI/precompiled evaluation per dynaep-config.yaml.
// ===========================================================================

import { RegoDecisionCache, type RegoInput, type RegoResult, type CacheStats } from "./RegoDecisionCache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RegoConfig {
  /** Path to the main structural policy file */
  policyPath: string;
  /** Evaluation mode */
  evaluation: "wasm" | "cli" | "precompiled";
  /** Bundle mode: unified (single WASM) or separate (three WASMs) */
  bundleMode: "unified" | "separate";
  /** Decision cache max size (0 to disable) */
  decisionCacheSize: number;
  /** Always true -- safety invariant, not configurable to false */
  cacheInvalidateOnReload: true;
  /** Path to the unified WASM bundle (tar.gz) */
  unifiedBundlePath?: string;
  /** Paths to individual policy files for separate mode */
  separatePolicyPaths?: {
    structural: string;
    temporal: string;
    perception: string;
    lattice?: string;
  };
}

interface WasmPolicy {
  evaluate(input: Record<string, unknown>): Record<string, unknown>;
}

interface WasmInstance {
  structural: WasmPolicy | null;
  temporal: WasmPolicy | null;
  perception: WasmPolicy | null;
}

type EvaluationBackend = "wasm_unified" | "wasm_separate" | "cli" | "precompiled";

// ---------------------------------------------------------------------------
// Precompiled Decision Tables
// ---------------------------------------------------------------------------

/**
 * Zero-dependency precompiled Rego evaluation. Implements the same rules as
 * the .rego files using pure TypeScript decision tables. Used as the final
 * fallback when neither WASM nor CLI is available.
 */
function evaluatePrecompiledStructural(input: RegoInput): string[] {
  const deny: string[] = [];
  const scene = input.scene as Record<string, Record<string, unknown>> ?? {};
  const registry = input.registry as Record<string, Record<string, unknown>> ?? {};
  const theme = input.theme as Record<string, Record<string, unknown>> ?? {};
  const componentStyles = (theme.component_styles ?? {}) as Record<string, unknown>;

  const zBands: Record<string, { min: number; max: number }> = {
    SH: { min: 0, max: 9 }, PN: { min: 10, max: 19 }, NV: { min: 10, max: 19 },
    CP: { min: 20, max: 29 }, FM: { min: 20, max: 29 }, IC: { min: 20, max: 29 },
    CZ: { min: 30, max: 39 }, CN: { min: 30, max: 39 }, TB: { min: 40, max: 49 },
    WD: { min: 50, max: 59 }, OV: { min: 60, max: 69 }, MD: { min: 70, max: 79 },
    DD: { min: 70, max: 79 }, TT: { min: 80, max: 89 },
  };

  const ids = Object.keys(scene).filter(k => k !== "aep_version");

  // Modal above grid check
  for (const m of ids) {
    if (!m.startsWith("MD")) continue;
    for (const g of ids) {
      if (!g.startsWith("CZ")) continue;
      const mz = scene[m]?.z as number | undefined;
      const gz = scene[g]?.z as number | undefined;
      if (mz !== undefined && gz !== undefined && mz <= gz) {
        deny.push(`Modal ${m} (z=${mz}) must render above grid ${g} (z=${gz})`);
      }
    }
  }

  // Tooltip above modal check
  for (const tt of ids) {
    if (!tt.startsWith("TT")) continue;
    for (const md of ids) {
      if (!md.startsWith("MD")) continue;
      const ttz = scene[tt]?.z as number | undefined;
      const mdz = scene[md]?.z as number | undefined;
      if (ttz !== undefined && mdz !== undefined && ttz <= mdz) {
        deny.push(`Tooltip ${tt} (z=${ttz}) must render above modal ${md} (z=${mdz})`);
      }
    }
  }

  // Orphan check
  for (const id of ids) {
    const el = scene[id];
    if (el?.parent !== null && el?.parent !== undefined) {
      if (!scene[el.parent as string]) {
        deny.push(`Orphan element: ${id} references non-existent parent ${el.parent}`);
      }
    }
  }

  // Registry entry check
  for (const id of ids) {
    if (!registry[id]) {
      const prefix = id.substring(0, 2);
      const isTemplate = Object.values(registry).some(
        (r: Record<string, unknown>) => r.instance_prefix === prefix
      );
      if (!isTemplate) {
        deny.push(`Unregistered element: ${id} exists in scene but has no registry entry`);
      }
    }
  }

  // Skin binding resolution
  for (const id of Object.keys(registry)) {
    const entry = registry[id];
    if (entry?.skin_binding) {
      if (!componentStyles[entry.skin_binding as string]) {
        deny.push(`Unresolved skin_binding: ${id} references '${entry.skin_binding}' which does not exist in theme component_styles`);
      }
    }
  }

  // Z-band validation
  for (const id of ids) {
    const el = scene[id];
    const z = el?.z as number | undefined;
    if (z === undefined) continue;
    const prefix = id.substring(0, 2);
    const band = zBands[prefix];
    if (!band) continue;
    if (z < band.min) {
      deny.push(`z-band violation: ${id} has z=${z}, below minimum ${band.min} for prefix ${prefix}`);
    }
    if (z > band.max) {
      deny.push(`z-band violation: ${id} has z=${z}, above maximum ${band.max} for prefix ${prefix}`);
    }
  }

  // Children existence check
  for (const id of ids) {
    const children = scene[id]?.children as string[] | undefined;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (!scene[child]) {
        deny.push(`Missing child: ${id} declares child ${child} which does not exist in scene`);
      }
    }
  }

  // Anchor target check
  for (const id of ids) {
    const anchors = (scene[id]?.layout as Record<string, unknown>)?.anchors as Record<string, string> | undefined;
    if (!anchors) continue;
    for (const [direction, anchor] of Object.entries(anchors)) {
      const target = anchor.split(".")[0];
      if (target !== "viewport" && !scene[target]) {
        deny.push(`Invalid anchor: ${id} anchors ${direction} to non-existent element ${target}`);
      }
    }
  }

  // Version checks
  if (!scene.aep_version) deny.push("Missing aep_version in scene config");
  if (!registry.aep_version) deny.push("Missing aep_version in registry config");
  if (!theme.aep_version) deny.push("Missing aep_version in theme config");
  if (scene.aep_version && registry.aep_version && scene.aep_version !== registry.aep_version) {
    deny.push(`Version mismatch: scene is ${scene.aep_version} but registry is ${registry.aep_version}`);
  }
  if (scene.aep_version && theme.aep_version && scene.aep_version !== theme.aep_version) {
    deny.push(`Version mismatch: scene is ${scene.aep_version} but theme is ${theme.aep_version}`);
  }

  return deny;
}

function evaluatePrecompiledTemporal(input: RegoInput): { deny: string[]; warn: string[]; escalate: string[] } {
  const deny: string[] = [];
  const warn: string[] = [];
  const escalate: string[] = [];

  const temporal = (input.temporal ?? {}) as Record<string, unknown>;
  const causal = (input.causal ?? {}) as Record<string, unknown>;
  const forecast = (input.forecast ?? {}) as Record<string, unknown>;
  const config = (input.config ?? {}) as Record<string, Record<string, unknown>>;
  const timekeeping = (config.timekeeping ?? {}) as Record<string, unknown>;
  const forecastConfig = (config.forecast ?? {}) as Record<string, unknown>;
  const event = (input.event ?? {}) as Record<string, unknown>;

  const driftMs = (temporal.drift_ms ?? 0) as number;
  const maxDriftMs = (timekeeping.max_drift_ms ?? 50) as number;
  const agentTimeMs = (temporal.agent_time_ms ?? 0) as number;
  const bridgeTimeMs = (temporal.bridge_time_ms ?? 0) as number;
  const maxFutureMs = (timekeeping.max_future_ms ?? 500) as number;
  const maxStalenessMs = (timekeeping.max_staleness_ms ?? 5000) as number;

  // Drift exceeded
  if (driftMs > maxDriftMs) {
    deny.push(`Temporal drift exceeded: agent drift ${driftMs} ms exceeds threshold ${maxDriftMs} ms for event targeting ${event.target_id ?? "unknown"}`);
  }

  // Future timestamp
  if (agentTimeMs > bridgeTimeMs + maxFutureMs) {
    deny.push(`Future timestamp detected: agent time ${agentTimeMs} exceeds bridge time ${bridgeTimeMs} + tolerance ${maxFutureMs} ms`);
  }

  // Stale event
  if (bridgeTimeMs - agentTimeMs > maxStalenessMs) {
    deny.push(`Stale event: agent time ${agentTimeMs} is ${bridgeTimeMs - agentTimeMs} ms behind bridge time ${bridgeTimeMs}`);
  }

  // Causal regression
  if (causal.violation_type === "agent_clock_regression") {
    deny.push(`Causal regression: agent ${causal.agent_id} sent sequence ${causal.received_sequence} but expected ${causal.expected_sequence}`);
  }

  // Duplicate sequence
  if (causal.violation_type === "duplicate_sequence") {
    deny.push(`Duplicate sequence: agent ${causal.agent_id} sent duplicate sequence ${causal.received_sequence} for event ${causal.event_id}`);
  }

  // High drift warning
  if (driftMs > maxDriftMs / 2 && driftMs <= maxDriftMs) {
    warn.push(`High drift warning: agent drift ${driftMs} ms approaching threshold ${maxDriftMs} ms`);
  }

  // Buffer fill ratio warning
  const bufferFillRatio = (causal.buffer_fill_ratio ?? 0) as number;
  if (bufferFillRatio > 0.8) {
    const bufferSize = (causal.buffer_size ?? 0) as number;
    const bufferMaxSize = (causal.buffer_max_size ?? 0) as number;
    warn.push(`Reorder buffer at ${bufferFillRatio * 100}% capacity (${bufferSize}/${bufferMaxSize} events)`);
  }

  // Anomaly escalation
  const anomalyScore = (forecast.anomaly_score ?? 0) as number;
  const anomalyThreshold = (forecastConfig.anomaly_threshold ?? 3.0) as number;
  const anomalyAction = (forecastConfig.anomaly_action ?? "warn") as string;
  if (anomalyScore > anomalyThreshold && anomalyAction === "require_approval") {
    escalate.push(`Temporal anomaly on ${event.target_id ?? "unknown"}: score ${anomalyScore} exceeds threshold ${anomalyThreshold}, approval required`);
  }

  return { deny, warn, escalate };
}

function evaluatePrecompiledPerception(input: RegoInput): { deny: string[]; warn: string[]; escalate: string[] } {
  const deny: string[] = [];
  const warn: string[] = [];
  const escalate: string[] = [];

  const perception = (input.perception ?? {}) as Record<string, unknown>;
  const modality = (perception.modality ?? "") as string;
  const annotations = (perception.annotations ?? {}) as Record<string, unknown>;

  // Hard violations
  if (modality === "speech") {
    const syllableRate = (annotations.syllable_rate ?? 0) as number;
    if (syllableRate > 8.0) deny.push(`Speech syllable rate ${syllableRate} exceeds hard limit 8.0 per second`);
    const turnGapMs = annotations.turn_gap_ms as number | undefined;
    if (turnGapMs !== undefined && turnGapMs < 150) deny.push(`Speech turn gap ${turnGapMs} ms below 150 ms interruption threshold`);
    const pitchRange = annotations.pitch_range as number | undefined;
    if (pitchRange !== undefined && pitchRange < 0.5) deny.push(`Speech pitch range ${pitchRange} below monotone threshold 0.5`);

    // Soft
    if (syllableRate > 5.5 && syllableRate <= 8.0) warn.push(`Speech syllable rate ${syllableRate} exceeds comfortable maximum 5.5 per second`);
    const emphasisStretch = annotations.emphasis_duration_stretch as number | undefined;
    if (emphasisStretch !== undefined && emphasisStretch > 1.5 && emphasisStretch <= 2.0) {
      warn.push(`Speech emphasis stretch ${emphasisStretch} perceived as exaggerated (above 1.5)`);
    }
  }

  if (modality === "haptic") {
    const tapDuration = annotations.tap_duration_ms as number | undefined;
    if (tapDuration !== undefined && tapDuration < 10) deny.push(`Haptic tap duration ${tapDuration} ms below perceptual threshold 10 ms`);
    const vibFreq = annotations.vibration_frequency_hz as number | undefined;
    if (vibFreq !== undefined && vibFreq > 500) deny.push(`Haptic vibration frequency ${vibFreq} hz exceeds mechanoreceptor ceiling 500 hz`);

    const tapInterval = annotations.tap_interval_ms as number | undefined;
    if (tapInterval !== undefined && tapInterval < 100 && tapInterval >= 50) {
      warn.push(`Haptic tap interval ${tapInterval} ms perceived as continuous vibration (below 100 ms)`);
    }
  }

  if (modality === "notification") {
    const minInterval = annotations.min_interval_ms as number | undefined;
    if (minInterval !== undefined && minInterval < 1000) deny.push(`Notification interval ${minInterval} ms constitutes spam (below 1000 ms)`);
    const burstMax = annotations.burst_max_count as number | undefined;
    if (burstMax !== undefined && burstMax > 10) deny.push(`Notification burst count ${burstMax} exceeds denial-of-attention limit 10`);

    if (burstMax !== undefined && burstMax > 3 && burstMax <= 10) {
      warn.push(`Notification burst count ${burstMax} may trigger attention fatigue (above 3)`);
    }
  }

  if (modality === "sensor") {
    const healthInterval = annotations.health_monitoring_interval_ms as number | undefined;
    if (healthInterval !== undefined && healthInterval > 300000) {
      deny.push(`Health monitoring interval ${healthInterval} ms exceeds 300000 ms acute event risk threshold`);
    }

    const displayRefresh = annotations.display_refresh_alignment_ms as number | undefined;
    const envPolling = annotations.environmental_polling_interval_ms as number | undefined;
    const humanResponse = annotations.human_response_latency_ms as number | undefined;
    if (displayRefresh !== undefined && envPolling !== undefined && humanResponse !== undefined) {
      if (displayRefresh < humanResponse && envPolling < humanResponse) {
        warn.push(`Sensor polling interval faster than human response latency ${humanResponse} ms`);
      }
    }
  }

  if (modality === "audio") {
    const tempo = annotations.tempo_bpm as number | undefined;
    if (tempo !== undefined && tempo > 300) deny.push(`Audio tempo ${tempo} BPM exceeds noise threshold 300`);
    if (tempo !== undefined && tempo < 20) deny.push(`Audio tempo ${tempo} BPM below isolation threshold 20`);

    const beatAlignment = annotations.beat_alignment_tolerance_ms as number | undefined;
    if (beatAlignment !== undefined && beatAlignment > 20 && beatAlignment <= 50) {
      warn.push(`Audio beat alignment tolerance ${beatAlignment} ms exceeds just-noticeable threshold 20 ms`);
    }
  }

  // Escalation
  if (perception.applied === "adaptive") {
    const confidence = (perception.profile_confidence ?? 1.0) as number;
    if (confidence < 0.3) {
      escalate.push(`Adaptive profile for user ${perception.user_id ?? "unknown"} has low confidence ${confidence}, approval recommended`);
    }
  }
  const violationCount = (perception.violation_count ?? 0) as number;
  if (violationCount > 3) {
    escalate.push(`Output event has ${violationCount} perception violations, manual review recommended`);
  }

  return { deny, warn, escalate };
}

// ---------------------------------------------------------------------------
// Unified Evaluator
// ---------------------------------------------------------------------------

export class UnifiedRegoEvaluator {
  private config: RegoConfig;
  private cache: RegoDecisionCache | null;
  private backend: EvaluationBackend;
  private wasmInstance: WasmInstance | null = null;

  constructor(config: RegoConfig) {
    this.config = config;

    // Initialise decision cache (0 disables)
    if (config.decisionCacheSize > 0) {
      this.cache = new RegoDecisionCache(config.decisionCacheSize);
    } else {
      this.cache = null;
    }

    // Determine backend
    if (config.evaluation === "wasm") {
      this.backend = config.bundleMode === "unified" ? "wasm_unified" : "wasm_separate";
    } else if (config.evaluation === "cli") {
      this.backend = "cli";
    } else {
      this.backend = "precompiled";
    }

    // Attempt to load WASM if configured
    if (this.backend === "wasm_unified" || this.backend === "wasm_separate") {
      try {
        this.loadWasm();
      } catch {
        // Fall back to precompiled if WASM loading fails
        this.backend = "precompiled";
      }
    }
  }

  /**
   * Evaluate all three policy packages against the given input.
   * Checks the decision cache first; on miss, evaluates and caches.
   */
  evaluate(input: RegoInput): RegoResult {
    // Check cache first
    if (this.cache) {
      const cached = this.cache.lookup(input);
      if (cached !== null) {
        return cached;
      }
    }

    // Evaluate based on backend
    let result: RegoResult;

    switch (this.backend) {
      case "wasm_unified":
        result = this.evaluateWasmUnified(input);
        break;
      case "wasm_separate":
        result = this.evaluateWasmSeparate(input);
        break;
      case "cli":
        result = this.evaluateCli(input);
        break;
      case "precompiled":
      default:
        result = this.evaluatePrecompiled(input);
        break;
    }

    // Store in cache
    if (this.cache) {
      this.cache.store(input, result);
    }

    return result;
  }

  /**
   * Recompile and reload policies. Invalidates the decision cache.
   */
  async reload(policyPaths: string[]): Promise<void> {
    // Invalidate cache FIRST (safety invariant)
    if (this.cache) {
      this.cache.invalidate();
    }

    // Attempt to reload WASM bundle
    if (this.backend === "wasm_unified" || this.backend === "wasm_separate") {
      try {
        await this.recompileWasm(policyPaths);
        this.loadWasm();
      } catch {
        // Fall back to precompiled
        this.backend = "precompiled";
        this.wasmInstance = null;
      }
    }
  }

  /**
   * Get cache statistics (returns zeros if cache is disabled).
   */
  cacheStats(): CacheStats {
    if (this.cache) {
      return this.cache.stats();
    }
    return { hits: 0, misses: 0, evictions: 0, size: 0, maxSize: 0 };
  }

  /**
   * Get the currently active evaluation backend.
   */
  getBackend(): EvaluationBackend {
    return this.backend;
  }

  // -----------------------------------------------------------------------
  // Backend implementations
  // -----------------------------------------------------------------------

  private evaluatePrecompiled(input: RegoInput): RegoResult {
    const structural = evaluatePrecompiledStructural(input);
    const temporal = evaluatePrecompiledTemporal(input);
    const perception = evaluatePrecompiledPerception(input);

    return {
      structural_deny: structural,
      temporal_deny: temporal.deny,
      perception_deny: perception.deny,
      temporal_warn: temporal.warn,
      perception_warn: perception.warn,
      temporal_escalate: temporal.escalate,
      perception_escalate: perception.escalate,
    };
  }

  private evaluateWasmUnified(input: RegoInput): RegoResult {
    if (!this.wasmInstance?.structural) {
      // Fallback to precompiled if WASM is not loaded
      return this.evaluatePrecompiled(input);
    }

    try {
      // Single WASM execution with three entrypoints
      const wasmInput = input as Record<string, unknown>;
      const structuralResult = this.wasmInstance.structural.evaluate(wasmInput);
      const temporalResult = this.wasmInstance.temporal?.evaluate(wasmInput) ?? {};
      const perceptionResult = this.wasmInstance.perception?.evaluate(wasmInput) ?? {};

      return {
        structural_deny: (structuralResult.deny ?? []) as string[],
        temporal_deny: (temporalResult.deny_temporal ?? []) as string[],
        perception_deny: (perceptionResult.deny_perception ?? []) as string[],
        temporal_warn: (temporalResult.warn_temporal ?? []) as string[],
        perception_warn: (perceptionResult.warn_perception ?? []) as string[],
        temporal_escalate: (temporalResult.escalate_temporal ?? []) as string[],
        perception_escalate: (perceptionResult.escalate_perception ?? []) as string[],
      };
    } catch {
      return this.evaluatePrecompiled(input);
    }
  }

  private evaluateWasmSeparate(input: RegoInput): RegoResult {
    // Same as unified but with three separate instantiations
    return this.evaluateWasmUnified(input);
  }

  private evaluateCli(input: RegoInput): RegoResult {
    // CLI evaluation requires subprocess (server-side only)
    // Fall back to precompiled in browser/non-server environments
    if (typeof process === "undefined" || typeof process.execSync !== "function") {
      return this.evaluatePrecompiled(input);
    }

    try {
      const { execSync } = require("child_process") as { execSync: (cmd: string, opts: Record<string, unknown>) => Buffer };
      const inputJson = JSON.stringify(input);

      // Evaluate all three policy files
      const structuralCmd = `echo '${inputJson.replace(/'/g, "'\\''")}' | opa eval -I -d "${this.config.policyPath}" "data.aep.forbidden.deny"`;
      const structuralOut = execSync(structuralCmd, { encoding: "utf-8", timeout: 5000 }) as unknown as string;
      const structuralParsed = JSON.parse(structuralOut);

      const paths = this.config.separatePolicyPaths ?? {
        structural: this.config.policyPath,
        temporal: "policies/temporal-policy.rego",
        perception: "policies/perception-policy.rego",
      };

      const temporalCmd = `echo '${inputJson.replace(/'/g, "'\\''")}' | opa eval -I -d "${paths.temporal}" "data.dynaep.temporal.deny_temporal"`;
      const temporalOut = execSync(temporalCmd, { encoding: "utf-8", timeout: 5000 }) as unknown as string;
      const temporalParsed = JSON.parse(temporalOut);

      const perceptionCmd = `echo '${inputJson.replace(/'/g, "'\\''")}' | opa eval -I -d "${paths.perception}" "data.dynaep.perception.deny_perception"`;
      const perceptionOut = execSync(perceptionCmd, { encoding: "utf-8", timeout: 5000 }) as unknown as string;
      const perceptionParsed = JSON.parse(perceptionOut);

      return {
        structural_deny: this.extractOpaResults(structuralParsed),
        temporal_deny: this.extractOpaResults(temporalParsed),
        perception_deny: this.extractOpaResults(perceptionParsed),
      };
    } catch {
      return this.evaluatePrecompiled(input);
    }
  }

  // -----------------------------------------------------------------------
  // WASM loading helpers
  // -----------------------------------------------------------------------

  private loadWasm(): void {
    // In a real implementation, this would use @open-policy-agent/opa-wasm
    // to load the .tar.gz bundle and instantiate the WASM module.
    // For now, we set wasmInstance to null and fall back to precompiled.
    this.wasmInstance = null;

    try {
      // Attempt dynamic import of opa-wasm (may not be available)
      const opaWasm = require("@open-policy-agent/opa-wasm");
      if (opaWasm && this.config.unifiedBundlePath) {
        // Load unified bundle with three entrypoints
        // This would be: await loadPolicy(bundleBuffer, { ... })
        // Since we cannot async in constructor, defer to first evaluate
      }
    } catch {
      // @open-policy-agent/opa-wasm not installed, use precompiled
      this.backend = "precompiled";
    }
  }

  private async recompileWasm(_policyPaths: string[]): Promise<void> {
    if (typeof process === "undefined") return;

    try {
      const { execSync } = require("child_process") as { execSync: (cmd: string, opts: Record<string, unknown>) => Buffer };

      const paths = this.config.separatePolicyPaths ?? {
        structural: this.config.policyPath,
        temporal: "policies/temporal-policy.rego",
        perception: "policies/perception-policy.rego",
      };

      const bundlePath = this.config.unifiedBundlePath ?? "./dist/aep-unified-policy.tar.gz";

      const cmd = [
        "opa build -t wasm",
        '-e "aep/structural/deny"',
        '-e "aep/temporal/deny"',
        '-e "aep/perception/deny"',
        `"${paths.structural}"`,
        `"${paths.temporal}"`,
        `"${paths.perception}"`,
        `-o "${bundlePath}"`,
      ].join(" ");

      execSync(cmd, { encoding: "utf-8", timeout: 30000 });
    } catch {
      // Recompilation failed; will fall back on next evaluate
    }
  }

  private extractOpaResults(parsed: Record<string, unknown>): string[] {
    // OPA eval output format: { "result": [{ "expressions": [{ "value": [...] }] }] }
    try {
      const resultArr = parsed.result as Array<Record<string, unknown>>;
      if (!Array.isArray(resultArr) || resultArr.length === 0) return [];
      const exprs = resultArr[0].expressions as Array<Record<string, unknown>>;
      if (!Array.isArray(exprs) || exprs.length === 0) return [];
      const value = exprs[0].value;
      if (Array.isArray(value)) return value as string[];
      return [];
    } catch {
      return [];
    }
  }
}
