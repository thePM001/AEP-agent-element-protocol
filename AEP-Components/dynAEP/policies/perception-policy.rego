package dynaep.perception

# ===========================================================================
# Perception Governance Policy
# Enforces temporal perception bounds via OPA. Complements the
# static registry validation with policy-level rules that can
# be evaluated server-side before events reach the bridge.
# ===========================================================================

# ---------------------------------------------------------------------------
# Hard Violations: Block the event entirely
# ---------------------------------------------------------------------------

# Reject speech with syllable rate exceeding hard limit
deny_perception[msg] {
    input.perception.modality == "speech"
    input.perception.annotations.syllable_rate > 8.0
    msg := sprintf(
        "Speech syllable rate %v exceeds hard limit 8.0 per second",
        [input.perception.annotations.syllable_rate]
    )
}

# Reject speech with turn gap below interruption threshold
deny_perception[msg] {
    input.perception.modality == "speech"
    input.perception.annotations.turn_gap_ms < 150
    msg := sprintf(
        "Speech turn gap %v ms below 150 ms interruption threshold",
        [input.perception.annotations.turn_gap_ms]
    )
}

# Reject haptic with imperceptible tap duration
deny_perception[msg] {
    input.perception.modality == "haptic"
    input.perception.annotations.tap_duration_ms < 10
    msg := sprintf(
        "Haptic tap duration %v ms below perceptual threshold 10 ms",
        [input.perception.annotations.tap_duration_ms]
    )
}

# Reject haptic vibration outside mechanoreceptor range
deny_perception[msg] {
    input.perception.modality == "haptic"
    input.perception.annotations.vibration_frequency_hz > 500
    msg := sprintf(
        "Haptic vibration frequency %v hz exceeds mechanoreceptor ceiling 500 hz",
        [input.perception.annotations.vibration_frequency_hz]
    )
}

# Reject notification spam (interval below 1 second)
deny_perception[msg] {
    input.perception.modality == "notification"
    input.perception.annotations.min_interval_ms < 1000
    msg := sprintf(
        "Notification interval %v ms constitutes spam (below 1000 ms)",
        [input.perception.annotations.min_interval_ms]
    )
}

# Reject denial-of-attention notification bursts
deny_perception[msg] {
    input.perception.modality == "notification"
    input.perception.annotations.burst_max_count > 10
    msg := sprintf(
        "Notification burst count %v exceeds denial-of-attention limit 10",
        [input.perception.annotations.burst_max_count]
    )
}

# Reject sensor health monitoring above acute event risk threshold
deny_perception[msg] {
    input.perception.modality == "sensor"
    input.perception.annotations.health_monitoring_interval_ms > 300000
    msg := sprintf(
        "Health monitoring interval %v ms exceeds 300000 ms acute event risk threshold",
        [input.perception.annotations.health_monitoring_interval_ms]
    )
}

# Reject audio tempo above noise threshold
deny_perception[msg] {
    input.perception.modality == "audio"
    input.perception.annotations.tempo_bpm > 300
    msg := sprintf(
        "Audio tempo %v BPM exceeds noise threshold 300",
        [input.perception.annotations.tempo_bpm]
    )
}

# Reject audio tempo below isolation threshold
deny_perception[msg] {
    input.perception.modality == "audio"
    input.perception.annotations.tempo_bpm < 20
    msg := sprintf(
        "Audio tempo %v BPM below isolation threshold 20",
        [input.perception.annotations.tempo_bpm]
    )
}

# Reject speech with monotone pitch range
deny_perception[msg] {
    input.perception.modality == "speech"
    input.perception.annotations.pitch_range < 0.5
    msg := sprintf(
        "Speech pitch range %v below monotone threshold 0.5",
        [input.perception.annotations.pitch_range]
    )
}

# ---------------------------------------------------------------------------
# Soft Violations: Warn but allow with clamping
# ---------------------------------------------------------------------------

# Warn on speech rate above comfortable maximum
warn_perception[msg] {
    input.perception.modality == "speech"
    input.perception.annotations.syllable_rate > 5.5
    input.perception.annotations.syllable_rate <= 8.0
    msg := sprintf(
        "Speech syllable rate %v exceeds comfortable maximum 5.5 per second",
        [input.perception.annotations.syllable_rate]
    )
}

# Warn on haptic tap interval perceived as continuous vibration
warn_perception[msg] {
    input.perception.modality == "haptic"
    input.perception.annotations.tap_interval_ms < 100
    input.perception.annotations.tap_interval_ms >= 50
    msg := sprintf(
        "Haptic tap interval %v ms perceived as continuous vibration (below 100 ms)",
        [input.perception.annotations.tap_interval_ms]
    )
}

# Warn on notification attention fatigue
warn_perception[msg] {
    input.perception.modality == "notification"
    input.perception.annotations.burst_max_count > 3
    input.perception.annotations.burst_max_count <= 10
    msg := sprintf(
        "Notification burst count %v may trigger attention fatigue (above 3)",
        [input.perception.annotations.burst_max_count]
    )
}

# Warn on sensor polling faster than human response latency
warn_perception[msg] {
    input.perception.modality == "sensor"
    input.perception.annotations.display_refresh_alignment_ms < input.perception.annotations.human_response_latency_ms
    input.perception.annotations.environmental_polling_interval_ms < input.perception.annotations.human_response_latency_ms
    msg := sprintf(
        "Sensor polling interval faster than human response latency %v ms",
        [input.perception.annotations.human_response_latency_ms]
    )
}

# Warn on audio beat alignment exceeding just-noticeable threshold
warn_perception[msg] {
    input.perception.modality == "audio"
    input.perception.annotations.beat_alignment_tolerance_ms > 20
    input.perception.annotations.beat_alignment_tolerance_ms <= 50
    msg := sprintf(
        "Audio beat alignment tolerance %v ms exceeds just-noticeable threshold 20 ms",
        [input.perception.annotations.beat_alignment_tolerance_ms]
    )
}

# Warn on speech emphasis perceived as exaggerated
warn_perception[msg] {
    input.perception.modality == "speech"
    input.perception.annotations.emphasis_duration_stretch > 1.5
    input.perception.annotations.emphasis_duration_stretch <= 2.0
    msg := sprintf(
        "Speech emphasis stretch %v perceived as exaggerated (above 1.5)",
        [input.perception.annotations.emphasis_duration_stretch]
    )
}

# ---------------------------------------------------------------------------
# Escalation: Require human approval for edge cases
# ---------------------------------------------------------------------------

# Escalate when adaptive profile adjustments are near comfortable limits
escalate_perception[msg] {
    input.perception.applied == "adaptive"
    input.perception.profile_confidence < 0.3
    msg := sprintf(
        "Adaptive profile for user %v has low confidence %v, approval recommended",
        [input.perception.user_id, input.perception.profile_confidence]
    )
}

# Escalate when governed annotations differ significantly from original
escalate_perception[msg] {
    input.perception.violation_count > 3
    msg := sprintf(
        "Output event has %v perception violations, manual review recommended",
        [input.perception.violation_count]
    )
}
