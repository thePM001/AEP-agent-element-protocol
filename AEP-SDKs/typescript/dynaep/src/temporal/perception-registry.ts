// @PAD: /root/dynAEP/sdk/typescript/src/temporal/perception-registry.ts
// ===========================================================================
// @dynaep/core - Perceptual Temporal Registry
// A deterministic registry of human temporal perception thresholds compiled
// from psychoacoustics research, cognitive load theory and attention science.
// Structured identically to AEP registries: each entry has a type, bounds
// and constraint rules.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerceptionBounds {
  min: number;
  max: number;
  comfortable_min: number;
  comfortable_max: number;
  unit: "ms" | "per_second" | "hz" | "ratio" | "count" | "per_minute";
  source: string;
}

export interface PerceptionConstraint {
  name: string;
  condition: string;
  severity: "hard" | "soft";
  message: string;
}

export interface ModalityProfile {
  modality: string;
  bounds: Record<string, PerceptionBounds>;
  constraints: PerceptionConstraint[];
}

export interface TemporalAnnotation {
  [parameter: string]: number | string | boolean;
}

export interface PerceptionViolation {
  parameter: string;
  value: number;
  bound: PerceptionBounds;
  severity: "hard" | "soft";
  message: string;
}

export interface PerceptionValidationResult {
  valid: boolean;
  violations: PerceptionViolation[];
  clamped: TemporalAnnotation;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Built-in Modality Profiles
// ---------------------------------------------------------------------------

function buildSpeechProfile(): ModalityProfile {
  return {
    modality: "speech",
    bounds: {
      turn_gap_ms: {
        min: 150, max: 3000, comfortable_min: 200, comfortable_max: 500, unit: "ms",
        source: "Stivers et al. 2009, cross-linguistic turn-taking",
      },
      syllable_rate: {
        min: 2.0, max: 8.0, comfortable_min: 3.0, comfortable_max: 5.5, unit: "per_second",
        source: "Pellegrino et al. 2011, cross-linguistic speech rate",
      },
      clause_pause_ms: {
        min: 50, max: 2000, comfortable_min: 100, comfortable_max: 600, unit: "ms",
        source: "Goldman-Eisler 1968, pausing and cognitive planning",
      },
      sentence_pause_ms: {
        min: 150, max: 3000, comfortable_min: 250, comfortable_max: 1000, unit: "ms",
        source: "Campione and Veronis 2002, pause distribution in speech",
      },
      topic_shift_pause_ms: {
        min: 500, max: 5000, comfortable_min: 800, comfortable_max: 2500, unit: "ms",
        source: "Swerts 1997, prosodic features of discourse boundaries",
      },
      pitch_range: {
        min: 0.5, max: 2.5, comfortable_min: 0.8, comfortable_max: 1.8, unit: "ratio",
        source: "t'Hart et al. 1990, prosodic perception thresholds",
      },
      emphasis_duration_stretch: {
        min: 1.0, max: 2.0, comfortable_min: 1.1, comfortable_max: 1.5, unit: "ratio",
        source: "Turk and Sawusch 1996, duration cues to emphasis",
      },
      total_utterance_max_ms: {
        min: 500, max: 30000, comfortable_min: 1000, comfortable_max: 15000, unit: "ms",
        source: "working memory constraints on continuous speech processing",
      },
    },
    constraints: [
      { name: "interruption_guard", condition: "turn_gap_ms below 150 ms", severity: "hard", message: "Turn gap below 150 ms perceived as interruption" },
      { name: "intelligibility_ceiling", condition: "syllable_rate above 8.0 per second", severity: "hard", message: "Syllable rate above 8.0 per second unintelligible for most listeners" },
      { name: "comprehension_warning", condition: "syllable_rate above 5.5 per second", severity: "soft", message: "Syllable rate above 5.5 per second reduces comprehension for complex content" },
      { name: "clause_merge_guard", condition: "clause_pause_ms below 50 ms", severity: "hard", message: "Clause pause below 50 ms perceived as no pause (clauses merge)" },
      { name: "topic_boundary_warning", condition: "topic_shift_pause_ms below 500 ms", severity: "soft", message: "Topic shift pause below 500 ms confuses listeners about topic boundary" },
      { name: "monotone_guard", condition: "pitch_range below 0.5", severity: "hard", message: "Pitch range below 0.5 perceived as monotone (loss of prosodic information)" },
      { name: "exaggeration_warning", condition: "emphasis_duration_stretch above 1.5", severity: "soft", message: "Emphasis duration stretch above 1.5 perceived as exaggerated or condescending" },
    ],
  };
}

function buildHapticProfile(): ModalityProfile {
  return {
    modality: "haptic",
    bounds: {
      tap_duration_ms: {
        min: 10, max: 500, comfortable_min: 20, comfortable_max: 200, unit: "ms",
        source: "Gescheider 1997, psychophysics of tactile perception",
      },
      tap_interval_ms: {
        min: 50, max: 5000, comfortable_min: 100, comfortable_max: 1000, unit: "ms",
        source: "van Erp 2002, vibrotactile temporal resolution",
      },
      pattern_element_gap_ms: {
        min: 30, max: 2000, comfortable_min: 50, comfortable_max: 500, unit: "ms",
        source: "Hoggan and Brewster 2006, haptic pattern recognition",
      },
      vibration_frequency_hz: {
        min: 20, max: 500, comfortable_min: 100, comfortable_max: 300, unit: "hz",
        source: "Verrillo 1963, Pacinian corpuscle tuning",
      },
      amplitude_change_rate: {
        min: 0.1, max: 10.0, comfortable_min: 0.5, comfortable_max: 3.0, unit: "ratio",
        source: "amplitude modulation detection thresholds",
      },
    },
    constraints: [
      { name: "imperceptible_tap_guard", condition: "tap_duration_ms below 10 ms", severity: "hard", message: "Tap duration below 10 ms below perceptual threshold (user feels nothing)" },
      { name: "pulse_only_guard", condition: "vibration_frequency_hz below 20 hz", severity: "hard", message: "Vibration frequency below 20 hz perceived as discrete pulses only" },
      { name: "continuous_vibration_warning", condition: "tap_interval_ms below 100 ms", severity: "soft", message: "Tap interval below 100 ms perceived as continuous vibration rather than distinct taps" },
      { name: "attenuation_guard", condition: "vibration_frequency_hz above 500 hz", severity: "hard", message: "Vibration frequency above 500 hz attenuated by skin mechanoreceptors" },
    ],
  };
}

function buildNotificationProfile(): ModalityProfile {
  return {
    modality: "notification",
    bounds: {
      min_interval_ms: {
        min: 1000, max: 86400000, comfortable_min: 30000, comfortable_max: 3600000, unit: "ms",
        source: "Mehrotra et al. 2016, notification overload and attention",
      },
      burst_max_count: {
        min: 1, max: 10, comfortable_min: 1, comfortable_max: 3, unit: "count",
        source: "Pielot et al. 2014, notification batching preferences",
      },
      burst_window_ms: {
        min: 1000, max: 60000, comfortable_min: 5000, comfortable_max: 30000, unit: "ms",
        source: "time window in which consecutive notifications count as a burst",
      },
      habituation_onset: {
        min: 3, max: 50, comfortable_min: 5, comfortable_max: 15, unit: "count",
        source: "Weber et al. 2016, notification habituation curves",
      },
      recovery_interval_ms: {
        min: 60000, max: 86400000, comfortable_min: 300000, comfortable_max: 3600000, unit: "ms",
        source: "minimum silence after habituation onset before notifications regain attention",
      },
    },
    constraints: [
      { name: "spam_guard", condition: "min_interval_ms below 1000 ms", severity: "hard", message: "Interval below 1000 ms constitutes notification spam" },
      { name: "attention_fatigue_warning", condition: "burst_max_count above 3 within burst_window", severity: "soft", message: "Burst count above 3 within burst window triggers attention fatigue" },
      { name: "denial_of_attention_guard", condition: "burst_max_count above 10 within 60 seconds", severity: "hard", message: "Burst count above 10 within 60 seconds constitutes denial-of-attention" },
      { name: "habituation_warning", condition: "exceeding habituation_onset without recovery_interval", severity: "soft", message: "Exceeding habituation onset without recovery interval renders notifications ineffective" },
    ],
  };
}

function buildSensorProfile(): ModalityProfile {
  return {
    modality: "sensor",
    bounds: {
      human_response_latency_ms: {
        min: 150, max: 2000, comfortable_min: 200, comfortable_max: 500, unit: "ms",
        source: "Hick 1952, reaction time baselines",
      },
      display_refresh_alignment_ms: {
        min: 8, max: 100, comfortable_min: 16, comfortable_max: 33, unit: "ms",
        source: "align with 30-60 hz display refresh for perceptual smoothness",
      },
      health_monitoring_interval_ms: {
        min: 1000, max: 3600000, comfortable_min: 5000, comfortable_max: 300000, unit: "ms",
        source: "clinical monitoring standards, balance of vigilance and alarm fatigue",
      },
      environmental_polling_interval_ms: {
        min: 1000, max: 600000, comfortable_min: 10000, comfortable_max: 120000, unit: "ms",
        source: "HVAC, air quality, temperature change rates",
      },
    },
    constraints: [
      { name: "battery_waste_warning", condition: "polling faster than human_response_latency", severity: "soft", message: "Polling faster than human response latency wastes battery with no perceptual benefit" },
      { name: "alarm_fatigue_warning", condition: "health_monitoring_interval below 5000 ms", severity: "soft", message: "Health monitoring interval below 5000 ms risks alarm fatigue in clinical settings" },
      { name: "acute_event_guard", condition: "health_monitoring_interval above 300000 ms", severity: "hard", message: "Health monitoring interval above 300000 ms (5 minutes) risks missing acute events" },
    ],
  };
}

function buildAudioProfile(): ModalityProfile {
  return {
    modality: "audio",
    bounds: {
      tempo_bpm: {
        min: 20, max: 300, comfortable_min: 60, comfortable_max: 180, unit: "per_minute",
        source: "London 2012, hearing in time - perceptual entrainment bounds",
      },
      beat_alignment_tolerance_ms: {
        min: 0, max: 50, comfortable_min: 0, comfortable_max: 20, unit: "ms",
        source: "Friberg and Sundberg 1995, just-noticeable beat displacement",
      },
      fade_duration_ms: {
        min: 10, max: 10000, comfortable_min: 100, comfortable_max: 3000, unit: "ms",
        source: "perceivable fade vs abrupt transition thresholds",
      },
      silence_gap_ms: {
        min: 0, max: 10000, comfortable_min: 50, comfortable_max: 2000, unit: "ms",
        source: "inter-segment silence for perceived track separation",
      },
    },
    constraints: [
      { name: "noise_guard", condition: "tempo_bpm above 300", severity: "hard", message: "Tempo above 300 BPM perceived as noise rather than rhythm" },
      { name: "isolation_guard", condition: "tempo_bpm below 20", severity: "hard", message: "Tempo below 20 BPM perceived as isolated events rather than rhythm" },
      { name: "sloppy_timing_warning", condition: "beat_alignment_tolerance above 20 ms", severity: "soft", message: "Beat alignment tolerance above 20 ms perceived as sloppy timing" },
      { name: "click_artefact_warning", condition: "fade_duration below 100 ms", severity: "soft", message: "Fade duration below 100 ms perceived as a click or pop artefact" },
    ],
  };
}

// ---------------------------------------------------------------------------
// PerceptionRegistry
// ---------------------------------------------------------------------------

export class PerceptionRegistry {
  private modalities: Map<string, ModalityProfile>;

  constructor() {
    this.modalities = new Map();
    this.modalities.set("speech", buildSpeechProfile());
    this.modalities.set("haptic", buildHapticProfile());
    this.modalities.set("notification", buildNotificationProfile());
    this.modalities.set("sensor", buildSensorProfile());
    this.modalities.set("audio", buildAudioProfile());
  }

  /**
   * Return the perception profile for a named modality.
   * Returns null if the modality is not registered.
   */
  getModality(modality: string): ModalityProfile | null {
    const profile = this.modalities.get(modality);
    if (!profile) {
      return null;
    }
    return profile;
  }

  /**
   * Return the list of all registered modality names.
   */
  listModalities(): string[] {
    const names: string[] = [];
    for (const key of this.modalities.keys()) {
      names.push(key);
    }
    return names;
  }

  /**
   * Validate a temporal annotation against the perception bounds
   * for the given modality. Returns violations and a clamped copy.
   */
  validate(modality: string, annotation: TemporalAnnotation): PerceptionValidationResult {
    const profile = this.modalities.get(modality);
    if (!profile) {
      return {
        valid: false,
        violations: [],
        clamped: { ...annotation },
        warnings: ["Unknown modality: " + modality],
      };
    }

    const violations: PerceptionViolation[] = [];
    const warnings: string[] = [];
    const clamped: TemporalAnnotation = { ...annotation };

    for (const [paramName, value] of Object.entries(annotation)) {
      if (typeof value !== "number") {
        continue;
      }

      const bound = profile.bounds[paramName];
      if (!bound) {
        continue;
      }

      // Check hard limits
      if (value < bound.min) {
        violations.push({
          parameter: paramName,
          value,
          bound,
          severity: "hard",
          message: paramName + " value " + String(value) + " below hard minimum " + String(bound.min) + " " + bound.unit,
        });
        clamped[paramName] = bound.min;
      } else if (value > bound.max) {
        violations.push({
          parameter: paramName,
          value,
          bound,
          severity: "hard",
          message: paramName + " value " + String(value) + " above hard maximum " + String(bound.max) + " " + bound.unit,
        });
        clamped[paramName] = bound.max;
      } else if (value < bound.comfortable_min) {
        violations.push({
          parameter: paramName,
          value,
          bound,
          severity: "soft",
          message: paramName + " value " + String(value) + " below comfortable minimum " + String(bound.comfortable_min) + " " + bound.unit,
        });
        clamped[paramName] = bound.comfortable_min;
      } else if (value > bound.comfortable_max) {
        violations.push({
          parameter: paramName,
          value,
          bound,
          severity: "soft",
          message: paramName + " value " + String(value) + " above comfortable maximum " + String(bound.comfortable_max) + " " + bound.unit,
        });
        clamped[paramName] = bound.comfortable_max;
      }
    }

    const hasHardViolation = violations.some((v) => v.severity === "hard");
    const valid = !hasHardViolation;

    return { valid, violations, clamped, warnings };
  }

  /**
   * Return the comfortable range for a specific parameter within
   * a modality. Returns null if modality or parameter is not found.
   */
  comfortableRange(modality: string, parameter: string): { min: number; max: number } | null {
    const profile = this.modalities.get(modality);
    if (!profile) {
      return null;
    }
    const bound = profile.bounds[parameter];
    if (!bound) {
      return null;
    }
    return { min: bound.comfortable_min, max: bound.comfortable_max };
  }

  /**
   * Clamp a value to the perception-safe bounds for a parameter.
   * If the modality or parameter is unknown, the value is returned unchanged.
   */
  clamp(modality: string, parameter: string, value: number): number {
    const profile = this.modalities.get(modality);
    if (!profile) {
      return value;
    }
    const bound = profile.bounds[parameter];
    if (!bound) {
      return value;
    }
    const clampedValue = Math.max(bound.min, Math.min(bound.max, value));
    return clampedValue;
  }

  /**
   * Load custom perception overrides from configuration.
   * Overrides merge into existing modality profiles without
   * replacing built-in hard bounds that are not specified.
   */
  loadOverrides(overrides: Record<string, Partial<ModalityProfile>>): void {
    for (const [modalityName, overrideProfile] of Object.entries(overrides)) {
      const existing = this.modalities.get(modalityName);
      if (!existing) {
        continue;
      }

      if (overrideProfile.bounds) {
        for (const [paramName, overrideBound] of Object.entries(overrideProfile.bounds)) {
          const existingBound = existing.bounds[paramName];
          if (existingBound && overrideBound) {
            // Overrides cannot exceed the built-in hard limits
            const mergedBound: PerceptionBounds = {
              min: existingBound.min,
              max: existingBound.max,
              comfortable_min: Math.max(
                overrideBound.comfortable_min ?? existingBound.comfortable_min,
                existingBound.min,
              ),
              comfortable_max: Math.min(
                overrideBound.comfortable_max ?? existingBound.comfortable_max,
                existingBound.max,
              ),
              unit: existingBound.unit,
              source: existingBound.source,
            };
            existing.bounds[paramName] = mergedBound;
          }
        }
      }

      if (overrideProfile.constraints) {
        for (const constraint of overrideProfile.constraints) {
          existing.constraints.push(constraint);
        }
      }
    }
  }
}
