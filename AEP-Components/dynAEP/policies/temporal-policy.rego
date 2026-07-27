package dynaep.temporal

# Reject events with drift exceeding configured threshold
deny_temporal[msg] {
    input.temporal.drift_ms > input.config.timekeeping.max_drift_ms
    msg := sprintf(
        "Temporal drift exceeded: agent drift %v ms exceeds threshold %v ms for event targeting %v",
        [input.temporal.drift_ms, input.config.timekeeping.max_drift_ms, input.event.target_id]
    )
}

# Reject events timestamped in the future
deny_temporal[msg] {
    input.temporal.agent_time_ms > input.temporal.bridge_time_ms + input.config.timekeeping.max_future_ms
    msg := sprintf(
        "Future timestamp detected: agent time %v exceeds bridge time %v + tolerance %v ms",
        [input.temporal.agent_time_ms, input.temporal.bridge_time_ms, input.config.timekeeping.max_future_ms]
    )
}

# Reject stale events
deny_temporal[msg] {
    input.temporal.bridge_time_ms - input.temporal.agent_time_ms > input.config.timekeeping.max_staleness_ms
    msg := sprintf(
        "Stale event: agent time %v is %v ms behind bridge time %v",
        [input.temporal.agent_time_ms,
         input.temporal.bridge_time_ms - input.temporal.agent_time_ms,
         input.temporal.bridge_time_ms]
    )
}

# Reject causal ordering violations when not bufferable
deny_temporal[msg] {
    input.causal.violation_type == "agent_clock_regression"
    msg := sprintf(
        "Causal regression: agent %v sent sequence %v but expected %v",
        [input.causal.agent_id, input.causal.received_sequence, input.causal.expected_sequence]
    )
}

# Escalate anomaly detections above threshold
escalate_temporal[msg] {
    input.forecast.anomaly_score > input.config.forecast.anomaly_threshold
    input.config.forecast.anomaly_action == "require_approval"
    msg := sprintf(
        "Temporal anomaly on %v: score %v exceeds threshold %v, approval required",
        [input.event.target_id, input.forecast.anomaly_score, input.config.forecast.anomaly_threshold]
    )
}

# Warn on high drift (above 50% of threshold but below rejection)
warn_temporal[msg] {
    input.temporal.drift_ms > input.config.timekeeping.max_drift_ms / 2
    input.temporal.drift_ms <= input.config.timekeeping.max_drift_ms
    msg := sprintf(
        "High drift warning: agent drift %v ms approaching threshold %v ms",
        [input.temporal.drift_ms, input.config.timekeeping.max_drift_ms]
    )
}

# Reject duplicate causal sequence numbers
deny_temporal[msg] {
    input.causal.violation_type == "duplicate_sequence"
    msg := sprintf(
        "Duplicate sequence: agent %v sent duplicate sequence %v for event %v",
        [input.causal.agent_id, input.causal.received_sequence, input.causal.event_id]
    )
}

# Warn when reorder buffer is filling up
warn_temporal[msg] {
    input.causal.buffer_fill_ratio > 0.8
    msg := sprintf(
        "Reorder buffer at %v%% capacity (%v/%v events)",
        [input.causal.buffer_fill_ratio * 100,
         input.causal.buffer_size,
         input.causal.buffer_max_size]
    )
}
