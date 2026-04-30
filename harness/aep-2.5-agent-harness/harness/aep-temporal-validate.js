#!/usr/bin/env node

/**
 * AEP 2.5 Agent Harness -- Temporal Validation Module (dynAEP-TA)
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

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Perception Bounds Registry (built-in, research-derived)
// ---------------------------------------------------------------------------

const PERCEPTION_BOUNDS = {
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

// ---------------------------------------------------------------------------
// Default Temporal Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TEMPORAL_CONFIG = {
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

const causalState = {
    agentSequences: {},
    lastBridgeTimeMs: 0,
};

function resetCausalState() {
    causalState.agentSequences = {};
    causalState.lastBridgeTimeMs = 0;
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
 * @param {object} event - The temporal event to validate
 * @param {number} event.bridgeTimeMs - Bridge-authoritative timestamp
 * @param {number} [event.agentTimeMs] - Agent-reported timestamp (for drift check)
 * @param {string} [event.agentId] - Agent identifier for causal tracking
 * @param {number} [event.causalPosition] - Monotonic sequence number per agent
 * @param {object} [config] - Temporal configuration overrides
 * @returns {object} Validation result with violations array and trust delta
 */
function validateTemporalEvent(event, config) {
    const cfg = Object.assign({}, DEFAULT_TEMPORAL_CONFIG, config || {});
    const violations = [];
    let trustDelta = 0;

    if (!cfg.enabled) {
        return { valid: true, violations: [], trustDelta: 0 };
    }

    const nowMs = Date.now();
    const bridgeTimeMs = event.bridgeTimeMs;

    if (typeof bridgeTimeMs !== 'number' || bridgeTimeMs <= 0) {
        violations.push({
            type: 'missing_bridge_time',
            severity: 'CRITICAL',
            message: 'Event has no valid bridgeTimeMs',
        });
        return { valid: false, violations, trustDelta: cfg.trust_penalties.stale_event };
    }

    // Check 1: Drift between agent time and bridge time
    if (typeof event.agentTimeMs === 'number') {
        const driftMs = Math.abs(event.agentTimeMs - bridgeTimeMs);
        if (driftMs > cfg.max_drift_ms) {
            violations.push({
                type: 'drift_exceeded',
                severity: 'HIGH',
                driftMs: driftMs,
                maxDriftMs: cfg.max_drift_ms,
                message: `Agent-bridge drift ${driftMs}ms exceeds threshold ${cfg.max_drift_ms}ms`,
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
            futureByMs: futureGap,
            maxFutureMs: cfg.max_future_ms,
            message: `Event is ${futureGap}ms in the future (max ${cfg.max_future_ms}ms)`,
        });
        trustDelta += cfg.trust_penalties.future_timestamp;
    }

    // Check 3: Staleness (event too old)
    const ageMs = nowMs - bridgeTimeMs;
    if (ageMs > cfg.max_staleness_ms && bridgeTimeMs < nowMs) {
        violations.push({
            type: 'stale_event',
            severity: 'MEDIUM',
            ageMs: ageMs,
            maxStalenessMs: cfg.max_staleness_ms,
            message: `Event is ${ageMs}ms old (max ${cfg.max_staleness_ms}ms)`,
        });
        trustDelta += cfg.trust_penalties.stale_event;
    }

    // Check 4: Causal ordering
    if (cfg.causal_ordering_enabled && event.agentId && typeof event.causalPosition === 'number') {
        const agentId = event.agentId;
        const lastPosition = causalState.agentSequences[agentId];

        if (typeof lastPosition === 'number') {
            if (event.causalPosition <= lastPosition) {
                violations.push({
                    type: 'causal_regression',
                    severity: 'CRITICAL',
                    agentId: agentId,
                    currentPosition: event.causalPosition,
                    lastPosition: lastPosition,
                    message: `Causal regression: position ${event.causalPosition} <= last ${lastPosition} for agent ${agentId}`,
                });
                trustDelta += cfg.trust_penalties.causal_regression;
            }
        }

        // Update tracking (even on violation, to prevent cascading false positives)
        if (typeof lastPosition !== 'number' || event.causalPosition > lastPosition) {
            causalState.agentSequences[agentId] = event.causalPosition;
        }
    }

    // Check bridge time monotonicity
    if (bridgeTimeMs < causalState.lastBridgeTimeMs && causalState.lastBridgeTimeMs > 0) {
        violations.push({
            type: 'bridge_time_regression',
            severity: 'HIGH',
            currentMs: bridgeTimeMs,
            lastMs: causalState.lastBridgeTimeMs,
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
        violations: violations,
        trustDelta: trustDelta,
        bridgeTimeMs: bridgeTimeMs,
    };
}

// ---------------------------------------------------------------------------
// Perception Annotation Validation
// ---------------------------------------------------------------------------

/**
 * Validates perception annotations against modality bounds.
 *
 * @param {string} modality - One of: speech, haptic, notification, sensor, audio
 * @param {object} annotations - Key-value pairs of parameter names to values
 * @param {object} [config] - Perception governance config overrides
 * @returns {object} Validation result with violations, clamped values and trust delta
 */
function validatePerceptionAnnotation(modality, annotations, config) {
    const cfg = Object.assign(
        {},
        DEFAULT_TEMPORAL_CONFIG.perception_governance,
        config || {}
    );
    const violations = [];
    let trustDelta = 0;

    if (!cfg.enabled) {
        return { valid: true, violations: [], clamped: annotations, trustDelta: 0 };
    }

    const bounds = PERCEPTION_BOUNDS[modality];
    if (!bounds) {
        return {
            valid: false,
            violations: [{
                type: 'unknown_modality',
                severity: 'HIGH',
                message: `Unknown modality "${modality}". Valid: ${Object.keys(PERCEPTION_BOUNDS).join(', ')}`,
            }],
            clamped: annotations,
            trustDelta: -5,
        };
    }

    const clamped = Object.assign({}, annotations);

    for (const [param, value] of Object.entries(annotations)) {
        const bound = bounds[param];
        if (!bound) {
            // Unknown parameter for this modality -- skip, do not flag
            continue;
        }

        if (typeof value !== 'number') {
            violations.push({
                parameter: param,
                type: 'invalid_type',
                severity: 'HIGH',
                message: `Parameter "${param}" must be a number, got ${typeof value}`,
            });
            continue;
        }

        // Check hard bounds (absolute human perception limits)
        if (value < bound.min) {
            violations.push({
                parameter: param,
                type: 'hard_violation',
                severity: 'CRITICAL',
                value: value,
                bound_min: bound.min,
                message: `${param} = ${value} below hard minimum ${bound.min} ${bound.unit}`,
            });
            clamped[param] = bound.min;
            trustDelta += DEFAULT_TEMPORAL_CONFIG.trust_penalties.perception_hard;
        } else if (value > bound.max) {
            violations.push({
                parameter: param,
                type: 'hard_violation',
                severity: 'CRITICAL',
                value: value,
                bound_max: bound.max,
                message: `${param} = ${value} exceeds hard maximum ${bound.max} ${bound.unit}`,
            });
            clamped[param] = bound.max;
            trustDelta += DEFAULT_TEMPORAL_CONFIG.trust_penalties.perception_hard;
        }
        // Check soft bounds (comfortable range)
        else if (value < bound.comfortable_min) {
            violations.push({
                parameter: param,
                type: 'soft_violation',
                severity: 'MEDIUM',
                value: value,
                comfortable_min: bound.comfortable_min,
                message: `${param} = ${value} below comfortable minimum ${bound.comfortable_min} ${bound.unit}`,
            });
            if (cfg.soft_violation_action === 'clamp') {
                clamped[param] = bound.comfortable_min;
            }
            trustDelta += DEFAULT_TEMPORAL_CONFIG.trust_penalties.perception_soft;
        } else if (value > bound.comfortable_max) {
            violations.push({
                parameter: param,
                type: 'soft_violation',
                severity: 'MEDIUM',
                value: value,
                comfortable_max: bound.comfortable_max,
                message: `${param} = ${value} exceeds comfortable maximum ${bound.comfortable_max} ${bound.unit}`,
            });
            if (cfg.soft_violation_action === 'clamp') {
                clamped[param] = bound.comfortable_max;
            }
            trustDelta += DEFAULT_TEMPORAL_CONFIG.trust_penalties.perception_soft;
        }
    }

    // Reward for clean validation
    if (violations.length === 0) {
        trustDelta = 1;
    }

    const hasHard = violations.some(v => v.type === 'hard_violation');

    return {
        valid: violations.length === 0,
        violations: violations,
        clamped: clamped,
        trustDelta: trustDelta,
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
 * @param {object} annotations - Key-value pairs of parameter names to values
 * @returns {object} Clamped annotations (original keys preserved, values adjusted)
 */
function clampToPerceptionBounds(modality, annotations) {
    const bounds = PERCEPTION_BOUNDS[modality];
    if (!bounds) {
        return Object.assign({}, annotations);
    }

    const clamped = Object.assign({}, annotations);

    for (const [param, value] of Object.entries(annotations)) {
        const bound = bounds[param];
        if (!bound || typeof value !== 'number') continue;

        // Clamp to hard bounds first
        let result = value;
        if (result < bound.min) {
            result = bound.min;
        } else if (result > bound.max) {
            result = bound.max;
        }

        // Then clamp to comfortable bounds
        if (result < bound.comfortable_min) {
            result = bound.comfortable_min;
        } else if (result > bound.comfortable_max) {
            result = bound.comfortable_max;
        }

        clamped[param] = result;
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
 * @returns {object|null} Bounds object with parameter names as keys, or null if unknown
 */
function getPerceptionBounds(modality) {
    const bounds = PERCEPTION_BOUNDS[modality];
    if (!bounds) return null;

    // Return a deep copy to prevent mutation
    const copy = {};
    for (const [param, bound] of Object.entries(bounds)) {
        copy[param] = Object.assign({}, bound);
    }
    return copy;
}

/**
 * Lists all registered modalities.
 *
 * @returns {string[]} Array of modality names
 */
function listModalities() {
    return Object.keys(PERCEPTION_BOUNDS);
}

/**
 * Returns the comfortable range for a specific parameter within a modality.
 *
 * @param {string} modality - Modality name
 * @param {string} parameter - Parameter name within the modality
 * @returns {object|null} { min, max, unit } or null if not found
 */
function comfortableRange(modality, parameter) {
    const bounds = PERCEPTION_BOUNDS[modality];
    if (!bounds) return null;
    const bound = bounds[parameter];
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

/**
 * Loads temporal authority configuration from dynaep-config.yaml or returns defaults.
 *
 * @param {string} configDir - Directory containing dynaep-config.yaml
 * @returns {object} Merged temporal configuration
 */
function loadTemporalConfig(configDir) {
    const configPath = path.join(configDir, 'dynaep-config.yaml');
    if (!fs.existsSync(configPath)) {
        return Object.assign({}, DEFAULT_TEMPORAL_CONFIG);
    }

    try {
        const content = fs.readFileSync(configPath, 'utf8');
        const parsed = parseSimpleYaml(content);

        // Extract temporal_authority section
        const ta = parsed.temporal_authority || {};
        const pg = ta.perception_governance || {};

        return {
            enabled: ta.enabled !== false,
            max_drift_ms: ta.max_drift_ms || DEFAULT_TEMPORAL_CONFIG.max_drift_ms,
            max_staleness_ms: ta.max_staleness_ms || DEFAULT_TEMPORAL_CONFIG.max_staleness_ms,
            max_future_ms: ta.max_future_ms || DEFAULT_TEMPORAL_CONFIG.max_future_ms,
            causal_ordering_enabled: ta.causal_ordering !== false,
            perception_governance: {
                enabled: pg.enabled !== false,
                hard_violation_action: pg.hard_violation_action || 'clamp',
                soft_violation_action: pg.soft_violation_action || 'clamp',
            },
            trust_penalties: Object.assign(
                {},
                DEFAULT_TEMPORAL_CONFIG.trust_penalties,
                ta.trust_penalties || {}
            ),
        };
    } catch (e) {
        return Object.assign({}, DEFAULT_TEMPORAL_CONFIG);
    }
}

/**
 * Minimal YAML parser for flat and one-level-nested key-value pairs.
 * Handles the subset of YAML used in dynaep-config.yaml without external deps.
 *
 * @param {string} content - YAML string
 * @returns {object} Parsed object (flat or one-level nested)
 */
function parseSimpleYaml(content) {
    const result = {};
    const lines = content.split('\n');
    let currentSection = null;
    let currentSubSection = null;

    for (const rawLine of lines) {
        // Skip comments and empty lines
        const commentIdx = rawLine.indexOf('#');
        const line = commentIdx >= 0 ? rawLine.substring(0, commentIdx) : rawLine;
        if (line.trim().length === 0) continue;

        const indent = line.length - line.trimStart().length;
        const trimmed = line.trim();

        // Check for key: value or key: (section header)
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx < 0) continue;

        const key = trimmed.substring(0, colonIdx).trim();
        const val = trimmed.substring(colonIdx + 1).trim();

        if (indent === 0) {
            // Top-level key
            if (val.length === 0) {
                currentSection = key;
                currentSubSection = null;
                if (!result[key]) result[key] = {};
            } else {
                result[key] = parseYamlValue(val);
                currentSection = null;
                currentSubSection = null;
            }
        } else if (indent <= 4 && currentSection) {
            if (val.length === 0) {
                currentSubSection = key;
                if (!result[currentSection][key]) result[currentSection][key] = {};
            } else {
                if (currentSubSection && typeof result[currentSection][currentSubSection] === 'object') {
                    result[currentSection][currentSubSection][key] = parseYamlValue(val);
                } else {
                    result[currentSection][key] = parseYamlValue(val);
                }
            }
        } else if (indent > 4 && currentSection && currentSubSection) {
            if (typeof result[currentSection][currentSubSection] === 'object') {
                result[currentSection][currentSubSection][key] = parseYamlValue(val);
            }
        }
    }

    return result;
}

/**
 * Parses a single YAML value string into the appropriate JS type.
 */
function parseYamlValue(val) {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null' || val === '~') return null;
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.substring(1, val.length - 1);
    }
    // Try number
    const num = Number(val);
    if (!isNaN(num) && val.length > 0) return num;
    return val;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    validateTemporalEvent,
    validatePerceptionAnnotation,
    clampToPerceptionBounds,
    getPerceptionBounds,
    listModalities,
    comfortableRange,
    loadTemporalConfig,
    resetCausalState,
    PERCEPTION_BOUNDS,
    DEFAULT_TEMPORAL_CONFIG,
};
