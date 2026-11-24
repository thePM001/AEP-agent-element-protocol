#!/usr/bin/env node
// @ts-check

/**
 * AEP 2.9 Agent Harness - Temporal Validation Module (dynAEP-TA)
 *
 * Validates timestamps against bridge-authoritative time, enforces causal
 * ordering via sequence numbers and validates perception annotations against
 * built-in modality bounds derived from psychoacoustics research.
 *
 * Exports:
 *   validateTemporalEvent(event, config)
 *   validatePerceptionAnnotation(modality, annotations, config)
 *   clampToPerceptionBounds(modality, annotations)
 *   getPerceptionBounds(modality)
 *
 * Integrates with the existing validation pipeline in aep-validate.js.
 * Temporal validation runs BEFORE structural validation.
 * Perception validation runs between temporal and structural.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} PerceptionBound
 * @property {number} min
 * @property {number} comfortable_min
 * @property {number} comfortable_max
 * @property {number} max
 * @property {string} unit
 * @property {string} source
 */

/** @typedef {Record<string, PerceptionBound>} ModalityBounds */

/**
 * @typedef {object} PerceptionGovernance
 * @property {boolean} enabled
 * @property {string} hard_violation_action
 * @property {string} soft_violation_action
 */

/**
 * @typedef {object} TrustPenalties
 * @property {number} drift_exceeded
 * @property {number} future_timestamp
 * @property {number} stale_event
 * @property {number} causal_regression
 * @property {number} causal_missing_dep
 * @property {number} perception_hard
 * @property {number} perception_soft
 * @property {number} modality_ceiling
 */

/**
 * @typedef {object} TemporalConfig
 * @property {boolean} enabled
 * @property {number} max_drift_ms
 * @property {number} max_staleness_ms
 * @property {number} max_future_ms
 * @property {boolean} causal_ordering_enabled
 * @property {PerceptionGovernance} perception_governance
 * @property {TrustPenalties} trust_penalties
 */

/**
 * @typedef {object} TemporalEvent
 * @property {unknown} bridgeTimeMs Bridge-authoritative timestamp
 * @property {unknown} [agentTimeMs] Agent-reported timestamp (for drift check)
 * @property {unknown} [agentId] Agent identifier for causal tracking
 * @property {unknown} [causalPosition] Monotonic sequence number per agent
 */

/**
 * @typedef {object} Violation
 * @property {string} type
 * @property {string} severity
 * @property {string} message
 * @property {string} [parameter]
 */

/**
 * @typedef {object} TemporalResult
 * @property {boolean} valid
 * @property {Violation[]} violations
 * @property {number} trustDelta
 * @property {number} [bridgeTimeMs]
 */

/**
 * @typedef {object} PerceptionResult
 * @property {boolean} valid
 * @property {Violation[]} violations
 * @property {Record<string, unknown>} clamped
 * @property {number} trustDelta
 * @property {'governed' | 'softClamped' | 'original'} [applied]
 */

// ---------------------------------------------------------------------------
// Perception Bounds Registry (built-in, research-derived)
// ---------------------------------------------------------------------------

/** @type {Record<string, ModalityBounds>} */
export const PERCEPTION_BOUNDS = {
    speech: {
        syllable_rate: {
            min: 1.0,
            comfortable_min: 3.0,
            comfortable_max: 5.5,
            max: 8.0,
            unit: 'per_second',
            source: 'Pelli et al. (2006), Liberman (1967) speech perception research',
        },
        turn_gap_ms: {
            min: 150,
            comfortable_min: 200,
            comfortable_max: 800,
            max: 3000,
            unit: 'milliseconds',
            source: 'Stivers et al. (2009) cross-linguistic turn-taking',
        },
        pause_ms: {
            min: 50,
            comfortable_min: 150,
            comfortable_max: 1000,
            max: 3000,
            unit: 'milliseconds',
            source: 'Goldman-Eisler (1968) pause distribution in speech',
        },
        pitch_range_hz: {
            min: 50,
            comfortable_min: 75,
            comfortable_max: 300,
            max: 500,
            unit: 'hertz',
            source: 'Titze (1994) vocal fold physiology',
        },
    },
    haptic: {
        tap_duration_ms: {
            min: 10,
            comfortable_min: 30,
            comfortable_max: 200,
            max: 500,
            unit: 'milliseconds',
            source: 'Gescheider (1997) tactile psychophysics',
        },
        vibration_frequency_hz: {
            min: 20,
            comfortable_min: 50,
            comfortable_max: 300,
            max: 500,
            unit: 'hertz',
            source: 'Verrillo (1992) vibrotactile perception thresholds',
        },
        pattern_interval_ms: {
            min: 50,
            comfortable_min: 100,
            comfortable_max: 500,
            max: 2000,
            unit: 'milliseconds',
            source: 'Brewster & Brown (2004) haptic pattern discrimination',
        },
        intensity: {
            min: 0.0,
            comfortable_min: 0.2,
            comfortable_max: 0.8,
            max: 1.0,
            unit: 'normalized_0_1',
            source: 'ISO 5349-1 vibration exposure limits (normalized)',
        },
    },
    notification: {
        burst_limit_per_minute: {
            min: 0,
            comfortable_min: 0,
            comfortable_max: 3,
            max: 10,
            unit: 'count_per_minute',
            source: 'Iqbal & Horvitz (2010) notification disruption cost',
        },
        display_duration_ms: {
            min: 1000,
            comfortable_min: 3000,
            comfortable_max: 8000,
            max: 30000,
            unit: 'milliseconds',
            source: 'Sahami Shirazi et al. (2014) notification interaction times',
        },
        recovery_interval_ms: {
            min: 5000,
            comfortable_min: 15000,
            comfortable_max: 60000,
            max: 300000,
            unit: 'milliseconds',
            source: 'Mark et al. (2008) interruption recovery cost',
        },
        habituation_threshold: {
            min: 3,
            comfortable_min: 5,
            comfortable_max: 15,
            max: 50,
            unit: 'repetitions_before_ignore',
            source: 'Anderson (2013) notification habituation studies',
        },
    },
    sensor: {
        polling_interval_ms: {
            min: 16,
            comfortable_min: 100,
            comfortable_max: 2000,
            max: 60000,
            unit: 'milliseconds',
            source: 'Card, Moran & Newell (1983) human response time model',
        },
        display_refresh_hz: {
            min: 1,
            comfortable_min: 10,
            comfortable_max: 60,
            max: 144,
            unit: 'hertz',
            source: 'Display refresh rate alignment for sensor visualization',
        },
        human_response_latency_ms: {
            min: 100,
            comfortable_min: 150,
            comfortable_max: 300,
            max: 1000,
            unit: 'milliseconds',
            source: 'Hick (1952) and Hyman (1953) choice reaction time',
        },
    },
    audio: {
        tempo_bpm: {
            min: 20,
            comfortable_min: 60,
            comfortable_max: 180,
            max: 300,
            unit: 'beats_per_minute',
            source: 'London (2012) hearing in time: psychological aspects of musical metre',
        },
        beat_alignment_tolerance_ms: {
            min: 1,
            comfortable_min: 5,
            comfortable_max: 30,
            max: 100,
            unit: 'milliseconds',
            source: 'Repp (2005) sensorimotor synchronization',
        },
        fade_duration_ms: {
            min: 10,
            comfortable_min: 50,
            comfortable_max: 2000,
            max: 10000,
            unit: 'milliseconds',
            source: 'Standard audio engineering fade practices',
        },
        silence_gap_ms: {
            min: 0,
            comfortable_min: 20,
            comfortable_max: 2000,
            max: 10000,
            unit: 'milliseconds',
            source: 'Auditory stream segregation research (Bregman 1990)',
        },
    },
};

/**
 * The bounds of one modality, read only from the registry's own keys so a
 * name such as __proto__ or constructor never resolves.
 * @param {string} modality
 * @returns {ModalityBounds | null}
 */
function boundsOf(modality) {
    return Object.prototype.hasOwnProperty.call(PERCEPTION_BOUNDS, modality) ? (PERCEPTION_BOUNDS[modality] ?? null) : null;
}

/**
 * @param {ModalityBounds} bounds
 * @param {string} param
 * @returns {PerceptionBound | null}
 */
function boundOf(bounds, param) {
    return Object.prototype.hasOwnProperty.call(bounds, param) ? (bounds[param] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Default Temporal Configuration
// ---------------------------------------------------------------------------

/** @type {TemporalConfig} */
export const DEFAULT_TEMPORAL_CONFIG = {
    enabled: true,
    max_drift_ms: 50,
    max_staleness_ms: 30000,
    max_future_ms: 1000,
    causal_ordering_enabled: true,
    perception_governance: {
        enabled: true,
        hard_violation_action: 'clamp',
        soft_violation_action: 'clamp',
    },
    trust_penalties: {
        drift_exceeded: -10,
        future_timestamp: -15,
        stale_event: -5,
        causal_regression: -20,
        causal_missing_dep: -10,
        perception_hard: -15,
        perception_soft: -5,
        modality_ceiling: -20,
    },
};

// ---------------------------------------------------------------------------
// Causal Ordering State
// ---------------------------------------------------------------------------

/** @type {{ agentSequences: Map<string, number>, lastBridgeTimeMs: number }} */
const causalState = {
    agentSequences: new Map(),
    lastBridgeTimeMs: 0,
};

export function resetCausalState() {
    causalState.agentSequences = new Map();
    causalState.lastBridgeTimeMs = 0;
}

/**
 * A finite number, or undefined for anything else.
 * @param {unknown} v
 * @returns {number | undefined}
 */
function finite(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Merge a partial configuration over the defaults. Nested objects merge too,
 * so a caller that sets one trust penalty keeps the others.
 * @param {Partial<TemporalConfig> | null | undefined} config
 * @returns {TemporalConfig}
 */
function mergeConfig(config) {
    const c = config ?? {};
    return {
        ...DEFAULT_TEMPORAL_CONFIG,
        ...c,
        perception_governance: { ...DEFAULT_TEMPORAL_CONFIG.perception_governance, ...(c.perception_governance ?? {}) },
        trust_penalties: { ...DEFAULT_TEMPORAL_CONFIG.trust_penalties, ...(c.trust_penalties ?? {}) },
    };
}

// ---------------------------------------------------------------------------
// Temporal Event Validation
// ---------------------------------------------------------------------------

/**
 * Validates a temporal event against bridge-authoritative time.
 *
 * Checks:
 *   1. Drift between agent time and bridge time does not exceed threshold
 *   2. Event is not stamped in the future (beyond tolerance)
 *   3. Event is not stale (older than max staleness)
 *   4. Causal ordering is maintained (sequence numbers increase per agent)
 *
 * @param {TemporalEvent} event - The temporal event to validate
 * @param {Partial<TemporalConfig> | null} [config] - Temporal configuration overrides
 * @returns {TemporalResult} Validation result with violations array and trust delta
 */
export function validateTemporalEvent(event, config) {
    const cfg = mergeConfig(config);
    /** @type {Violation[]} */
    const violations = [];
    let trustDelta = 0;

    if (!cfg.enabled) {
        return { valid: true, violations: [], trustDelta: 0 };
    }

    const nowMs = Date.now();
    const bridgeTimeMs = finite(event.bridgeTimeMs);

    if (bridgeTimeMs === undefined || bridgeTimeMs <= 0) {
        violations.push({
            type: 'missing_bridge_time',
            severity: 'CRITICAL',
            message: 'Event has no valid bridgeTimeMs',
        });
        return { valid: false, violations, trustDelta: cfg.trust_penalties.stale_event };
    }

    // Check 1: Drift between agent time and bridge time. An agent time that is
    // present and not a finite number is a violation of its own.
    if (event.agentTimeMs !== undefined) {
        const agentTimeMs = finite(event.agentTimeMs);
        const driftMs = agentTimeMs === undefined ? Infinity : Math.abs(agentTimeMs - bridgeTimeMs);
        if (driftMs > cfg.max_drift_ms) {
            violations.push({
                type: 'drift_exceeded',
                severity: 'HIGH',
                message: agentTimeMs === undefined
                    ? 'Agent time is not a finite number'
                    : `Agent-bridge drift ${driftMs}ms exceeds threshold ${cfg.max_drift_ms}ms`,
            });
            trustDelta += cfg.trust_penalties.drift_exceeded;
        }
    }

    // Check 2: Future timestamp (event stamped ahead of current bridge time)
    const futureGap = bridgeTimeMs - nowMs;
    if (futureGap > cfg.max_future_ms) {
        violations.push({
            type: 'future_timestamp',
            severity: 'CRITICAL',
            message: `Event is ${futureGap}ms in the future (max ${cfg.max_future_ms}ms)`,
        });
        trustDelta += cfg.trust_penalties.future_timestamp;
    }

    // Check 3: Staleness (event too old)
    const ageMs = nowMs - bridgeTimeMs;
    if (ageMs > cfg.max_staleness_ms) {
        violations.push({
            type: 'stale_event',
            severity: 'MEDIUM',
            message: `Event is ${ageMs}ms old (max ${cfg.max_staleness_ms}ms)`,
        });
        trustDelta += cfg.trust_penalties.stale_event;
    }

    // Check 4: Causal ordering
    const causalPosition = finite(event.causalPosition);
    if (cfg.causal_ordering_enabled && typeof event.agentId === 'string' && event.agentId !== '' && causalPosition !== undefined) {
        const agentId = event.agentId;
        const lastPosition = causalState.agentSequences.get(agentId);

        if (lastPosition !== undefined && causalPosition <= lastPosition) {
            violations.push({
                type: 'causal_regression',
                severity: 'CRITICAL',
                message: `Causal regression: position ${causalPosition} <= last ${lastPosition} for agent ${agentId}`,
            });
            trustDelta += cfg.trust_penalties.causal_regression;
        }

        // Update tracking (even on violation, to prevent cascading false positives)
        if (lastPosition === undefined || causalPosition > lastPosition) {
            causalState.agentSequences.set(agentId, causalPosition);
        }
    }

    // Check bridge time monotonicity
    if (bridgeTimeMs < causalState.lastBridgeTimeMs && causalState.lastBridgeTimeMs > 0) {
        violations.push({
            type: 'bridge_time_regression',
            severity: 'HIGH',
            message: `Bridge time went backwards: ${bridgeTimeMs} < ${causalState.lastBridgeTimeMs}`,
        });
        trustDelta += cfg.trust_penalties.causal_regression;
    } else if (bridgeTimeMs > causalState.lastBridgeTimeMs) {
        causalState.lastBridgeTimeMs = bridgeTimeMs;
    }

    // Reward for successful validation
    if (violations.length === 0) {
        trustDelta = 1;
    }

    return {
        valid: violations.length === 0,
        violations,
        trustDelta,
        bridgeTimeMs,
    };
}

// ---------------------------------------------------------------------------
// Perception Annotation Validation
// ---------------------------------------------------------------------------

/**
 * Validates perception annotations against modality bounds.
 *
 * @param {string} modality - One of: speech, haptic, notification, sensor, audio
 * @param {Record<string, unknown>} annotations - Key-value pairs of parameter names to values
 * @param {Partial<PerceptionGovernance> | null} [config] - Perception governance config overrides
 * @returns {PerceptionResult} Validation result with violations, clamped values and trust delta
 */
export function validatePerceptionAnnotation(modality, annotations, config) {
    const cfg = { ...DEFAULT_TEMPORAL_CONFIG.perception_governance, ...(config ?? {}) };
    /** @type {Violation[]} */
    const violations = [];
    let trustDelta = 0;

    if (!cfg.enabled) {
        return { valid: true, violations: [], clamped: annotations, trustDelta: 0 };
    }

    const bounds = boundsOf(modality);
    if (!bounds) {
        return {
            valid: false,
            violations: [{
                type: 'unknown_modality',
                severity: 'HIGH',
                message: `Unknown modality "${modality}". Valid: ${listModalities().join(', ')}`,
            }],
            clamped: annotations,
            trustDelta: -5,
        };
    }

    /** @type {Record<string, unknown>} */
    const clamped = { ...annotations };
    const penalties = DEFAULT_TEMPORAL_CONFIG.trust_penalties;

    for (const [param, value] of Object.entries(annotations)) {
        const bound = boundOf(bounds, param);
        if (!bound) {
            // Unknown parameter for this modality - skip, do not flag
            continue;
        }

        if (typeof value !== 'number' || !Number.isFinite(value)) {
            violations.push({
                parameter: param,
                type: 'invalid_type',
                severity: 'HIGH',
                message: `Parameter "${param}" must be a finite number, got ${typeof value === 'number' ? String(value) : typeof value}`,
            });
            continue;
        }

        if (value < bound.min) {
            violations.push({
                parameter: param,
                type: 'hard_violation',
                severity: 'CRITICAL',
                message: `${param} = ${value} below hard minimum ${bound.min} ${bound.unit}`,
            });
            clamped[param] = bound.min;
            trustDelta += penalties.perception_hard;
        } else if (value > bound.max) {
            violations.push({
                parameter: param,
                type: 'hard_violation',
                severity: 'CRITICAL',
                message: `${param} = ${value} exceeds hard maximum ${bound.max} ${bound.unit}`,
            });
            clamped[param] = bound.max;
            trustDelta += penalties.perception_hard;
        } else if (value < bound.comfortable_min) {
            violations.push({
                parameter: param,
                type: 'soft_violation',
                severity: 'MEDIUM',
                message: `${param} = ${value} below comfortable minimum ${bound.comfortable_min} ${bound.unit}`,
            });
            if (cfg.soft_violation_action === 'clamp') {
                clamped[param] = bound.comfortable_min;
            }
            trustDelta += penalties.perception_soft;
        } else if (value > bound.comfortable_max) {
            violations.push({
                parameter: param,
                type: 'soft_violation',
                severity: 'MEDIUM',
                message: `${param} = ${value} exceeds comfortable maximum ${bound.comfortable_max} ${bound.unit}`,
            });
            if (cfg.soft_violation_action === 'clamp') {
                clamped[param] = bound.comfortable_max;
            }
            trustDelta += penalties.perception_soft;
        }
    }

    // Reward for clean validation
    if (violations.length === 0) {
        trustDelta = 1;
    }

    const hasHard = violations.some(v => v.type === 'hard_violation');

    return {
        valid: violations.length === 0,
        violations,
        clamped,
        trustDelta,
        applied: hasHard ? 'governed' : (violations.length > 0 ? 'softClamped' : 'original'),
    };
}

// ---------------------------------------------------------------------------
// Clamp to Perception Bounds
// ---------------------------------------------------------------------------

/**
 * Clamps annotation values to the valid perception bounds for a modality.
 * Hard bounds are enforced unconditionally. Comfortable bounds are used
 * for values within the hard range but outside the comfortable range.
 *
 * @param {string} modality - One of: speech, haptic, notification, sensor, audio
 * @param {Record<string, unknown>} annotations - Key-value pairs of parameter names to values
 * @returns {Record<string, unknown>} Clamped annotations (original keys preserved, values adjusted)
 */
export function clampToPerceptionBounds(modality, annotations) {
    const bounds = boundsOf(modality);
    /** @type {Record<string, unknown>} */
    const clamped = { ...annotations };
    if (!bounds) return clamped;

    for (const [param, value] of Object.entries(annotations)) {
        const bound = boundOf(bounds, param);
        if (!bound || typeof value !== 'number' || !Number.isFinite(value)) continue;
        // The comfortable range lies inside the hard range, so clamping to it
        // also enforces the hard bounds.
        clamped[param] = Math.min(bound.comfortable_max, Math.max(bound.comfortable_min, value));
    }

    return clamped;
}

// ---------------------------------------------------------------------------
// Get Perception Bounds
// ---------------------------------------------------------------------------

/**
 * Returns the perception bounds for a given modality.
 *
 * @param {string} modality - One of: speech, haptic, notification, sensor, audio
 * @returns {ModalityBounds | null} Bounds object with parameter names as keys, or null if unknown
 */
export function getPerceptionBounds(modality) {
    const bounds = boundsOf(modality);
    if (!bounds) return null;

    // Return a deep copy to prevent mutation
    /** @type {ModalityBounds} */
    const copy = {};
    for (const [param, bound] of Object.entries(bounds)) {
        copy[param] = { ...bound };
    }
    return copy;
}

/**
 * Lists all registered modalities.
 *
 * @returns {string[]} Array of modality names
 */
export function listModalities() {
    return Object.keys(PERCEPTION_BOUNDS);
}

/**
 * Returns the comfortable range for a specific parameter within a modality.
 *
 * @param {string} modality - Modality name
 * @param {string} parameter - Parameter name within the modality
 * @returns {{ min: number, max: number, unit: string } | null} The range or null if not found
 */
export function comfortableRange(modality, parameter) {
    const bounds = boundsOf(modality);
    if (!bounds) return null;
    const bound = boundOf(bounds, parameter);
    if (!bound) return null;
    return {
        min: bound.comfortable_min,
        max: bound.comfortable_max,
        unit: bound.unit,
    };
}

// ---------------------------------------------------------------------------
// Configuration Loader
// ---------------------------------------------------------------------------

/** @typedef {string | number | boolean | null} YamlScalar */
/** @typedef {{ [key: string]: YamlScalar | YamlMap }} YamlMap */

/**
 * A map with no prototype, so a key such as __proto__ stays an ordinary key.
 * @returns {YamlMap}
 */
function emptyMap() {
    /** @type {YamlMap} */
    const map = {};
    Object.setPrototypeOf(map, null);
    return map;
}

/**
 * @param {YamlScalar | YamlMap | undefined} v
 * @returns {YamlMap}
 */
function asMap(v) {
    return v !== null && typeof v === 'object' ? v : {};
}

/**
 * A positive finite number from the config, or the fallback.
 * @param {YamlScalar | YamlMap | undefined} v
 * @param {number} fallback
 */
function positive(v, fallback) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Loads temporal authority configuration from dynaep-config.yaml or returns defaults.
 *
 * @param {string} configDir - Directory containing dynaep-config.yaml
 * @returns {TemporalConfig} Merged temporal configuration
 */
export function loadTemporalConfig(configDir) {
    const configPath = path.join(configDir, 'dynaep-config.yaml');
    if (!fs.existsSync(configPath)) {
        return mergeConfig(null);
    }

    let content;
    try {
        content = fs.readFileSync(configPath, 'utf8');
    } catch {
        return mergeConfig(null);
    }

    const parsed = parseSimpleYaml(content);
    const ta = asMap(parsed.temporal_authority);
    const pg = asMap(ta.perception_governance);
    const tp = asMap(ta.trust_penalties);

    /** @type {TrustPenalties} */
    const trust = { ...DEFAULT_TEMPORAL_CONFIG.trust_penalties };
    for (const key of /** @type {(keyof TrustPenalties)[]} */ (Object.keys(trust))) {
        const v = tp[key];
        if (typeof v === 'number' && Number.isFinite(v)) trust[key] = v;
    }

    return {
        enabled: ta.enabled !== false,
        max_drift_ms: positive(ta.max_drift_ms, DEFAULT_TEMPORAL_CONFIG.max_drift_ms),
        max_staleness_ms: positive(ta.max_staleness_ms, DEFAULT_TEMPORAL_CONFIG.max_staleness_ms),
        max_future_ms: positive(ta.max_future_ms, DEFAULT_TEMPORAL_CONFIG.max_future_ms),
        causal_ordering_enabled: ta.causal_ordering !== false,
        perception_governance: {
            enabled: pg.enabled !== false,
            hard_violation_action: typeof pg.hard_violation_action === 'string' ? pg.hard_violation_action : 'clamp',
            soft_violation_action: typeof pg.soft_violation_action === 'string' ? pg.soft_violation_action : 'clamp',
        },
        trust_penalties: trust,
    };
}

/**
 * Minimal YAML parser for flat and one-level-nested key-value pairs.
 * Handles the subset of YAML used in dynaep-config.yaml without external deps.
 * Keys are stored on objects without a prototype, so a key such as __proto__
 * stays an ordinary key.
 *
 * @param {string} content - YAML string
 * @returns {YamlMap} Parsed object (flat or one-level nested)
 */
export function parseSimpleYaml(content) {
    const result = emptyMap();
    /** @type {YamlMap | null} */
    let section = null;
    /** @type {YamlMap | null} */
    let subSection = null;
    let subIndent = 0;

    for (const rawLine of content.split('\n')) {
        const commentIdx = rawLine.indexOf('#');
        const line = (commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine).replace(/\r$/, '');
        if (line.trim().length === 0) continue;

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx < 0) continue;

        const key = trimmed.substring(0, colonIdx).trim();
        const val = trimmed.substring(colonIdx + 1).trim();

        if (indent === 0) {
            if (val.length === 0) {
                const fresh = emptyMap();
                result[key] = fresh;
                section = fresh;
                subSection = null;
            } else {
                result[key] = parseYamlValue(val);
                section = null;
                subSection = null;
            }
        } else if (section) {
            // A key indented deeper than the header of the open sub section
            // belongs to it. Any other key belongs to the section.
            if (subSection && indent > subIndent) {
                subSection[key] = parseYamlValue(val);
            } else if (val.length === 0) {
                const fresh = emptyMap();
                section[key] = fresh;
                subSection = fresh;
                subIndent = indent;
            } else {
                section[key] = parseYamlValue(val);
                subSection = null;
            }
        }
    }

    return result;
}

/**
 * Parses a single YAML value string into the appropriate JS type.
 * @param {string} val
 * @returns {YamlScalar}
 */
export function parseYamlValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
        return val.substring(1, val.length - 1);
    }
    const num = Number(val);
    if (val.length > 0 && Number.isFinite(num)) return num;
    return val;
}
