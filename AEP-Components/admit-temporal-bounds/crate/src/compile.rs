// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:b478d503a6842ab07413e7268f7c2ef74fb5f5e348059a3dcfd911e126da8cd9
// AEP28-ENV-005 compile temporal bounds into Admit walls.

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

pub const WALL_TEMPORAL_DRIFT: &str = "temporal:drift_exceeded";
pub const WALL_TEMPORAL_FUTURE: &str = "temporal:future_timestamp";
pub const WALL_TEMPORAL_STALE: &str = "temporal:stale_event";
pub const WALL_TEMPORAL_CAUSAL_PARENT: &str = "temporal:causal_parent_missing";

pub const DEFAULT_MAX_DRIFT_MS: i64 = 50;
pub const DEFAULT_MAX_FUTURE_MS: i64 = 500;
pub const DEFAULT_MAX_STALENESS_MS: i64 = 5000;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TemporalCompileInput {
    pub has_agent_time: bool,
    pub drift_ms: i64,
    pub agent_time_ms: i64,
    pub bridge_time_ms: i64,
    pub max_drift_ms: i64,
    pub max_future_ms: i64,
    pub max_staleness_ms: i64,
    pub causal_parents: Vec<String>,
    pub causal_satisfied: Vec<String>,
    pub causal_violation_type: String,
    pub agent_id: String,
    pub target_id: String,
    pub event_id: String,
}

impl TemporalCompileInput {
    pub fn with_defaults() -> Self {
        Self {
            max_drift_ms: DEFAULT_MAX_DRIFT_MS,
            max_future_ms: DEFAULT_MAX_FUTURE_MS,
            max_staleness_ms: DEFAULT_MAX_STALENESS_MS,
            ..Self::default()
        }
    }
}

fn emit(id: &str, closed: bool, reason: &str) -> AdmitWall {
    if closed {
        AdmitWall::close(id, reason)
    } else {
        AdmitWall::open(id)
    }
}

fn iabs(v: i64) -> i64 {
    if v < 0 {
        -v
    } else {
        v
    }
}

fn effective_drift(input: &TemporalCompileInput) -> i64 {
    if input.drift_ms != 0 {
        return iabs(input.drift_ms);
    }
    if input.has_agent_time {
        return iabs(input.agent_time_ms - input.bridge_time_ms);
    }
    0
}

pub fn causal_parent_wall_id(parent: &str) -> String {
    let mut id = String::from("temporal:causal_parent:");
    id.push_str(parent);
    id
}

fn bound_or(value: i64, default: i64) -> i64 {
    if value > 0 {
        value
    } else {
        default
    }
}

/// Compile live temporal denies into Admit walls. Clock skew and causal parent missing.
/// Soft warn is not a closed wall.
pub fn compile_temporal_walls(input: &TemporalCompileInput) -> Vec<AdmitWall> {
    let mut walls = Vec::new();
    let max_drift = bound_or(input.max_drift_ms, DEFAULT_MAX_DRIFT_MS);
    let max_future = bound_or(input.max_future_ms, DEFAULT_MAX_FUTURE_MS);
    let max_stale = bound_or(input.max_staleness_ms, DEFAULT_MAX_STALENESS_MS);
    let drift = effective_drift(input);
    let skew_closed = input.has_agent_time && drift > max_drift;
    let mut skew_reason = String::from("Temporal drift exceeded: agent drift ");
    skew_reason.push_str(&drift.to_string());
    skew_reason.push_str(" ms exceeds threshold ");
    skew_reason.push_str(&max_drift.to_string());
    skew_reason.push_str(" ms");
    walls.push(emit(WALL_TEMPORAL_DRIFT, skew_closed, &skew_reason));

    let future_closed = input.has_agent_time
        && input.agent_time_ms > input.bridge_time_ms.saturating_add(max_future);
    let mut future_reason = String::from("Future timestamp detected: agent time ");
    future_reason.push_str(&input.agent_time_ms.to_string());
    future_reason.push_str(" exceeds bridge time ");
    future_reason.push_str(&input.bridge_time_ms.to_string());
    future_reason.push_str(" + tolerance ");
    future_reason.push_str(&max_future.to_string());
    future_reason.push_str(" ms");
    walls.push(emit(WALL_TEMPORAL_FUTURE, future_closed, &future_reason));

    let stale_age = if input.has_agent_time {
        input.bridge_time_ms.saturating_sub(input.agent_time_ms)
    } else {
        0
    };
    let stale_closed = input.has_agent_time && stale_age > max_stale;
    let mut stale_reason = String::from("Stale event: agent time ");
    stale_reason.push_str(&input.agent_time_ms.to_string());
    stale_reason.push_str(" is ");
    stale_reason.push_str(&stale_age.to_string());
    stale_reason.push_str(" ms behind bridge time ");
    stale_reason.push_str(&input.bridge_time_ms.to_string());
    walls.push(emit(WALL_TEMPORAL_STALE, stale_closed, &stale_reason));

    walls.extend(compile_causal_parent_walls(input));
    walls
}

fn compile_causal_parent_walls(input: &TemporalCompileInput) -> Vec<AdmitWall> {
    let mut walls = Vec::new();
    let vtype = input.causal_violation_type.trim().to_ascii_lowercase();
    let typed_missing = vtype == "missing_dependency";
    if input.causal_parents.is_empty() {
        let mut reason = String::new();
        if typed_missing {
            reason = String::from("Causal parent missing");
            if input.event_id.is_empty() == false {
                reason.push_str(" for event ");
                reason.push_str(&input.event_id);
            }
        }
        walls.push(emit(WALL_TEMPORAL_CAUSAL_PARENT, typed_missing, &reason));
        return walls;
    }
    let mut missing: Vec<String> = Vec::new();
    for parent in &input.causal_parents {
        let ok = input.causal_satisfied.iter().any(|s| s == parent);
        let id = causal_parent_wall_id(parent);
        if ok {
            walls.push(emit(&id, false, ""));
        } else {
            let mut reason = String::from("Causal parent '");
            reason.push_str(parent);
            reason.push_str("' has not been delivered");
            if input.event_id.is_empty() == false {
                reason.push_str(" for event ");
                reason.push_str(&input.event_id);
            }
            walls.push(emit(&id, true, &reason));
            missing.push(parent.clone());
        }
    }
    if missing.is_empty() && typed_missing == false {
        walls.push(emit(WALL_TEMPORAL_CAUSAL_PARENT, false, ""));
    } else {
        let mut reason = String::from("Causal parent missing");
        if missing.is_empty() == false {
            reason.push_str(": ");
            reason.push_str(&missing.join(", "));
        }
        walls.push(emit(WALL_TEMPORAL_CAUSAL_PARENT, true, &reason));
    }
    walls
}

/// Soft temporal warns. High drift below reject stays warn. Never a closed Admit wall.
pub fn compile_temporal_warns(input: &TemporalCompileInput) -> Vec<String> {
    let mut warns = Vec::new();
    if input.has_agent_time == false {
        return warns;
    }
    let max_drift = bound_or(input.max_drift_ms, DEFAULT_MAX_DRIFT_MS);
    let drift = effective_drift(input);
    let half = max_drift / 2;
    if drift > half && drift <= max_drift {
        let mut w = String::from("High drift warning: agent drift ");
        w.push_str(&drift.to_string());
        w.push_str(" ms approaching threshold ");
        w.push_str(&max_drift.to_string());
        w.push_str(" ms");
        warns.push(w);
    }
    warns
}

/// Fold temporal walls plus extras into one collect-all pass. Warns are not walls.
pub fn fold_temporal_into_admit(
    temporal: &TemporalCompileInput,
    extra: &[AdmitWall],
) -> AdmitResult {
    let mut walls = compile_temporal_walls(temporal);
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

include!("compile_tests.rs");
