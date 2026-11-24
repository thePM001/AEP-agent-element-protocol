// Self-check of the temporal fold on fixed inputs. Soft warn stays warn.

use crate::compile::{
    compile_temporal_warns, fold_temporal_into_admit, TemporalCompileInput,
    WALL_TEMPORAL_CAUSAL_PARENT, WALL_TEMPORAL_DRIFT,
};
use aep_admit::AdmitWall;

/// Fold a skewed event with a missing causal parent and a soft drift event and check the walls.
pub fn run_gate() -> Result<i32, String> {
    let mut skew = TemporalCompileInput::with_defaults();
    skew.has_agent_time = true;
    skew.agent_time_ms = 10_000;
    skew.bridge_time_ms = 9_000;
    skew.drift_ms = 1_000;
    skew.max_drift_ms = 50;
    skew.causal_parents.push(String::from("evt-parent"));
    skew.event_id = String::from("evt-child");
    let extra = vec![AdmitWall::close(
        "constraint:required_field:alpha",
        "alpha required",
    )];
    let admit = fold_temporal_into_admit(&skew, &extra);
    if admit.allow {
        return Err(String::from("expected closed walls"));
    }
    let ids: Vec<&str> = admit.closed.iter().map(|w| w.id.as_str()).collect();
    if !ids.contains(&WALL_TEMPORAL_DRIFT) {
        return Err(String::from("clock skew wall missing"));
    }
    if !ids.contains(&WALL_TEMPORAL_CAUSAL_PARENT) {
        return Err(String::from("causal parent wall missing"));
    }
    let mut soft = TemporalCompileInput::with_defaults();
    soft.has_agent_time = true;
    soft.drift_ms = 30;
    soft.max_drift_ms = 50;
    let warns = compile_temporal_warns(&soft);
    if warns.is_empty() {
        return Err(String::from("soft warn missing"));
    }
    if !fold_temporal_into_admit(&soft, &[]).allow {
        return Err(String::from("soft warn closed a wall"));
    }
    println!(
        "aep-admit-temporal-bounds ok closed={} warns={}",
        admit.closed.len(),
        warns.len()
    );
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_gate_self_check_passes() {
        assert_eq!(run_gate(), Ok(0));
    }
}
