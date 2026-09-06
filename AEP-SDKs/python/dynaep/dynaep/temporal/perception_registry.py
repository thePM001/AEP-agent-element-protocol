# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/perception_registry.py
# ===========================================================================
# dynaep - Perceptual Temporal Registry (Python)
# A deterministic registry of human temporal perception thresholds compiled
# from psychoacoustics research, cognitive load theory and attention science.
# Mirror of the TypeScript PerceptionRegistry with identical bounds.
# ===========================================================================

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class PerceptionBounds:
    min: float
    max: float
    comfortable_min: float
    comfortable_max: float
    unit: str  # "ms" | "per_second" | "hz" | "ratio" | "count" | "per_minute"
    source: str


@dataclass
class PerceptionConstraint:
    name: str
    condition: str
    severity: str  # "hard" | "soft"
    message: str


@dataclass
class ModalityProfile:
    modality: str
    bounds: dict[str, PerceptionBounds]
    constraints: list[PerceptionConstraint]


@dataclass
class PerceptionViolation:
    parameter: str
    value: float
    bound: PerceptionBounds
    severity: str  # "hard" | "soft"
    message: str


@dataclass
class PerceptionValidationResult:
    valid: bool
    violations: list[PerceptionViolation]
    clamped: dict[str, object]
    warnings: list[str]


# ---------------------------------------------------------------------------
# Built-in Modality Profiles
# ---------------------------------------------------------------------------

def _build_speech_profile() -> ModalityProfile:
    return ModalityProfile(
        modality="speech",
        bounds={
            "turn_gap_ms": PerceptionBounds(150, 3000, 200, 500, "ms", "Stivers et al. 2009, cross-linguistic turn-taking"),
            "syllable_rate": PerceptionBounds(2.0, 8.0, 3.0, 5.5, "per_second", "Pellegrino et al. 2011, cross-linguistic speech rate"),
            "clause_pause_ms": PerceptionBounds(50, 2000, 100, 600, "ms", "Goldman-Eisler 1968, pausing and cognitive planning"),
            "sentence_pause_ms": PerceptionBounds(150, 3000, 250, 1000, "ms", "Campione and Veronis 2002, pause distribution in speech"),
            "topic_shift_pause_ms": PerceptionBounds(500, 5000, 800, 2500, "ms", "Swerts 1997, prosodic features of discourse boundaries"),
            "pitch_range": PerceptionBounds(0.5, 2.5, 0.8, 1.8, "ratio", "t'Hart et al. 1990, prosodic perception thresholds"),
            "emphasis_duration_stretch": PerceptionBounds(1.0, 2.0, 1.1, 1.5, "ratio", "Turk and Sawusch 1996, duration cues to emphasis"),
            "total_utterance_max_ms": PerceptionBounds(500, 30000, 1000, 15000, "ms", "working memory constraints on continuous speech processing"),
        },
        constraints=[
            PerceptionConstraint("interruption_guard", "turn_gap_ms below 150 ms", "hard", "Turn gap below 150 ms perceived as interruption"),
            PerceptionConstraint("intelligibility_ceiling", "syllable_rate above 8.0 per second", "hard", "Syllable rate above 8.0 per second unintelligible for most listeners"),
            PerceptionConstraint("comprehension_warning", "syllable_rate above 5.5 per second", "soft", "Syllable rate above 5.5 per second reduces comprehension for complex content"),
            PerceptionConstraint("clause_merge_guard", "clause_pause_ms below 50 ms", "hard", "Clause pause below 50 ms perceived as no pause (clauses merge)"),
            PerceptionConstraint("topic_boundary_warning", "topic_shift_pause_ms below 500 ms", "soft", "Topic shift pause below 500 ms confuses listeners about topic boundary"),
            PerceptionConstraint("monotone_guard", "pitch_range below 0.5", "hard", "Pitch range below 0.5 perceived as monotone (loss of prosodic information)"),
            PerceptionConstraint("exaggeration_warning", "emphasis_duration_stretch above 1.5", "soft", "Emphasis duration stretch above 1.5 perceived as exaggerated or condescending"),
        ],
    )


def _build_haptic_profile() -> ModalityProfile:
    return ModalityProfile(
        modality="haptic",
        bounds={
            "tap_duration_ms": PerceptionBounds(10, 500, 20, 200, "ms", "Gescheider 1997, psychophysics of tactile perception"),
            "tap_interval_ms": PerceptionBounds(50, 5000, 100, 1000, "ms", "van Erp 2002, vibrotactile temporal resolution"),
            "pattern_element_gap_ms": PerceptionBounds(30, 2000, 50, 500, "ms", "Hoggan and Brewster 2006, haptic pattern recognition"),
            "vibration_frequency_hz": PerceptionBounds(20, 500, 100, 300, "hz", "Verrillo 1963, Pacinian corpuscle tuning"),
            "amplitude_change_rate": PerceptionBounds(0.1, 10.0, 0.5, 3.0, "ratio", "amplitude modulation detection thresholds"),
        },
        constraints=[
            PerceptionConstraint("imperceptible_tap_guard", "tap_duration_ms below 10 ms", "hard", "Tap duration below 10 ms below perceptual threshold (user feels nothing)"),
            PerceptionConstraint("pulse_only_guard", "vibration_frequency_hz below 20 hz", "hard", "Vibration frequency below 20 hz perceived as discrete pulses only"),
            PerceptionConstraint("continuous_vibration_warning", "tap_interval_ms below 100 ms", "soft", "Tap interval below 100 ms perceived as continuous vibration rather than distinct taps"),
            PerceptionConstraint("attenuation_guard", "vibration_frequency_hz above 500 hz", "hard", "Vibration frequency above 500 hz attenuated by skin mechanoreceptors"),
        ],
    )


def _build_notification_profile() -> ModalityProfile:
    return ModalityProfile(
        modality="notification",
        bounds={
            "min_interval_ms": PerceptionBounds(1000, 86400000, 30000, 3600000, "ms", "Mehrotra et al. 2016, notification overload and attention"),
            "burst_max_count": PerceptionBounds(1, 10, 1, 3, "count", "Pielot et al. 2014, notification batching preferences"),
            "burst_window_ms": PerceptionBounds(1000, 60000, 5000, 30000, "ms", "time window in which consecutive notifications count as a burst"),
            "habituation_onset": PerceptionBounds(3, 50, 5, 15, "count", "Weber et al. 2016, notification habituation curves"),
            "recovery_interval_ms": PerceptionBounds(60000, 86400000, 300000, 3600000, "ms", "minimum silence after habituation onset before notifications regain attention"),
        },
        constraints=[
            PerceptionConstraint("spam_guard", "min_interval_ms below 1000 ms", "hard", "Interval below 1000 ms constitutes notification spam"),
            PerceptionConstraint("attention_fatigue_warning", "burst_max_count above 3 within burst_window", "soft", "Burst count above 3 within burst window triggers attention fatigue"),
            PerceptionConstraint("denial_of_attention_guard", "burst_max_count above 10 within 60 seconds", "hard", "Burst count above 10 within 60 seconds constitutes denial-of-attention"),
            PerceptionConstraint("habituation_warning", "exceeding habituation_onset without recovery_interval", "soft", "Exceeding habituation onset without recovery interval renders notifications ineffective"),
        ],
    )


def _build_sensor_profile() -> ModalityProfile:
    return ModalityProfile(
        modality="sensor",
        bounds={
            "human_response_latency_ms": PerceptionBounds(150, 2000, 200, 500, "ms", "Hick 1952, reaction time baselines"),
            "display_refresh_alignment_ms": PerceptionBounds(8, 100, 16, 33, "ms", "align with 30-60 hz display refresh for perceptual smoothness"),
            "health_monitoring_interval_ms": PerceptionBounds(1000, 3600000, 5000, 300000, "ms", "clinical monitoring standards, balance of vigilance and alarm fatigue"),
            "environmental_polling_interval_ms": PerceptionBounds(1000, 600000, 10000, 120000, "ms", "HVAC, air quality, temperature change rates"),
        },
        constraints=[
            PerceptionConstraint("battery_waste_warning", "polling faster than human_response_latency", "soft", "Polling faster than human response latency wastes battery with no perceptual benefit"),
            PerceptionConstraint("alarm_fatigue_warning", "health_monitoring_interval below 5000 ms", "soft", "Health monitoring interval below 5000 ms risks alarm fatigue in clinical settings"),
            PerceptionConstraint("acute_event_guard", "health_monitoring_interval above 300000 ms", "hard", "Health monitoring interval above 300000 ms (5 minutes) risks missing acute events"),
        ],
    )


def _build_audio_profile() -> ModalityProfile:
    return ModalityProfile(
        modality="audio",
        bounds={
            "tempo_bpm": PerceptionBounds(20, 300, 60, 180, "per_minute", "London 2012, hearing in time - perceptual entrainment bounds"),
            "beat_alignment_tolerance_ms": PerceptionBounds(0, 50, 0, 20, "ms", "Friberg and Sundberg 1995, just-noticeable beat displacement"),
            "fade_duration_ms": PerceptionBounds(10, 10000, 100, 3000, "ms", "perceivable fade vs abrupt transition thresholds"),
            "silence_gap_ms": PerceptionBounds(0, 10000, 50, 2000, "ms", "inter-segment silence for perceived track separation"),
        },
        constraints=[
            PerceptionConstraint("noise_guard", "tempo_bpm above 300", "hard", "Tempo above 300 BPM perceived as noise rather than rhythm"),
            PerceptionConstraint("isolation_guard", "tempo_bpm below 20", "hard", "Tempo below 20 BPM perceived as isolated events rather than rhythm"),
            PerceptionConstraint("sloppy_timing_warning", "beat_alignment_tolerance above 20 ms", "soft", "Beat alignment tolerance above 20 ms perceived as sloppy timing"),
            PerceptionConstraint("click_artefact_warning", "fade_duration below 100 ms", "soft", "Fade duration below 100 ms perceived as a click or pop artefact"),
        ],
    )


# ---------------------------------------------------------------------------
# PerceptionRegistry
# ---------------------------------------------------------------------------

class PerceptionRegistry:
    """
    Deterministic registry of perception-safe temporal bounds for all
    supported output modalities. Provides validation, clamping and
    comfortable range queries.
    """

    def __init__(self) -> None:
        self._modalities: dict[str, ModalityProfile] = {}
        self._modalities["speech"] = _build_speech_profile()
        self._modalities["haptic"] = _build_haptic_profile()
        self._modalities["notification"] = _build_notification_profile()
        self._modalities["sensor"] = _build_sensor_profile()
        self._modalities["audio"] = _build_audio_profile()

    def get_modality(self, modality: str) -> Optional[ModalityProfile]:
        """Return the perception profile for a named modality."""
        return self._modalities.get(modality)

    def list_modalities(self) -> list[str]:
        """Return the list of all registered modality names."""
        return list(self._modalities.keys())

    def validate(self, modality: str, annotation: dict[str, object]) -> PerceptionValidationResult:
        """
        Validate a temporal annotation against the perception bounds
        for the given modality. Returns violations and a clamped copy.
        """
        profile = self._modalities.get(modality)
        if not profile:
            return PerceptionValidationResult(
                valid=False,
                violations=[],
                clamped=dict(annotation),
                warnings=["Unknown modality: " + modality],
            )

        violations: list[PerceptionViolation] = []
        warnings: list[str] = []
        clamped = dict(annotation)

        for param_name, value in annotation.items():
            if not isinstance(value, (int, float)):
                continue

            bound = profile.bounds.get(param_name)
            if not bound:
                continue

            if value < bound.min:
                violations.append(PerceptionViolation(
                    parameter=param_name,
                    value=float(value),
                    bound=bound,
                    severity="hard",
                    message=f"{param_name} value {value} below hard minimum {bound.min} {bound.unit}",
                ))
                clamped[param_name] = bound.min
            elif value > bound.max:
                violations.append(PerceptionViolation(
                    parameter=param_name,
                    value=float(value),
                    bound=bound,
                    severity="hard",
                    message=f"{param_name} value {value} above hard maximum {bound.max} {bound.unit}",
                ))
                clamped[param_name] = bound.max
            elif value < bound.comfortable_min:
                violations.append(PerceptionViolation(
                    parameter=param_name,
                    value=float(value),
                    bound=bound,
                    severity="soft",
                    message=f"{param_name} value {value} below comfortable minimum {bound.comfortable_min} {bound.unit}",
                ))
                clamped[param_name] = bound.comfortable_min
            elif value > bound.comfortable_max:
                violations.append(PerceptionViolation(
                    parameter=param_name,
                    value=float(value),
                    bound=bound,
                    severity="soft",
                    message=f"{param_name} value {value} above comfortable maximum {bound.comfortable_max} {bound.unit}",
                ))
                clamped[param_name] = bound.comfortable_max

        has_hard = any(v.severity == "hard" for v in violations)
        return PerceptionValidationResult(
            valid=not has_hard,
            violations=violations,
            clamped=clamped,
            warnings=warnings,
        )

    def comfortable_range(self, modality: str, parameter: str) -> Optional[tuple[float, float]]:
        """Return the comfortable range (min, max) for a specific parameter."""
        profile = self._modalities.get(modality)
        if not profile:
            return None
        bound = profile.bounds.get(parameter)
        if not bound:
            return None
        return (bound.comfortable_min, bound.comfortable_max)

    def clamp(self, modality: str, parameter: str, value: float) -> float:
        """Clamp a value to the perception-safe bounds for a parameter."""
        profile = self._modalities.get(modality)
        if not profile:
            return value
        bound = profile.bounds.get(parameter)
        if not bound:
            return value
        return max(bound.min, min(bound.max, value))

    def load_overrides(self, overrides: dict[str, dict]) -> None:
        """
        Load custom perception overrides from configuration.
        Overrides merge into existing modality profiles without
        replacing built-in hard bounds that are not specified.
        """
        for modality_name, override_data in overrides.items():
            existing = self._modalities.get(modality_name)
            if not existing:
                continue

            override_bounds = override_data.get("bounds", {})
            for param_name, override_bound in override_bounds.items():
                existing_bound = existing.bounds.get(param_name)
                if not existing_bound or not isinstance(override_bound, dict):
                    continue

                comfortable_min = override_bound.get("comfortable_min", existing_bound.comfortable_min)
                comfortable_max = override_bound.get("comfortable_max", existing_bound.comfortable_max)

                existing.bounds[param_name] = PerceptionBounds(
                    min=existing_bound.min,
                    max=existing_bound.max,
                    comfortable_min=max(comfortable_min, existing_bound.min),
                    comfortable_max=min(comfortable_max, existing_bound.max),
                    unit=existing_bound.unit,
                    source=existing_bound.source,
                )

            override_constraints = override_data.get("constraints", [])
            for constraint_data in override_constraints:
                existing.constraints.append(PerceptionConstraint(
                    name=constraint_data.get("name", "custom"),
                    condition=constraint_data.get("condition", ""),
                    severity=constraint_data.get("severity", "soft"),
                    message=constraint_data.get("message", ""),
                ))
