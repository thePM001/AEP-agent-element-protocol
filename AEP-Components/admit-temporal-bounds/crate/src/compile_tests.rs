#[cfg(test)]
mod tests {
    use super::*;
    use aep_admit::admit_collect_all;
    use aep_admit::AdmitWall;

    fn skew_input() -> TemporalCompileInput {
        let mut t = TemporalCompileInput::with_defaults();
        t.has_agent_time = true;
        t.agent_time_ms = 10_080;
        t.bridge_time_ms = 10_000;
        t.drift_ms = 80;
        t.max_drift_ms = 50;
        t
    }

    #[test]
    fn clock_skew_closes_drift_wall() {
        let admit = admit_collect_all(&compile_temporal_walls(&skew_input()));
        assert_eq!(admit.allow, false);
        assert_eq!(admit.closed.iter().any(|w| w.id == WALL_TEMPORAL_DRIFT), true);
    }

    #[test]
    fn in_bound_clock_opens_skew_wall() {
        let mut t = TemporalCompileInput::with_defaults();
        t.has_agent_time = true;
        t.agent_time_ms = 10_010;
        t.bridge_time_ms = 10_000;
        t.drift_ms = 10;
        t.max_drift_ms = 50;
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, true);
        assert_eq!(compile_temporal_warns(&t).is_empty(), true);
    }

    #[test]
    fn soft_warn_does_not_close_wall() {
        let mut t = TemporalCompileInput::with_defaults();
        t.has_agent_time = true;
        t.drift_ms = 30;
        t.max_drift_ms = 50;
        t.agent_time_ms = 10_030;
        t.bridge_time_ms = 10_000;
        let warns = compile_temporal_warns(&t);
        assert_eq!(warns.is_empty(), false);
        let admit = fold_temporal_into_admit(&t, &[]);
        assert_eq!(admit.allow, true);
        assert_eq!(admit.closed.is_empty(), true);
    }

    #[test]
    fn future_timestamp_closes() {
        let mut t = TemporalCompileInput::with_defaults();
        t.has_agent_time = true;
        t.bridge_time_ms = 1_000;
        t.agent_time_ms = 1_000 + 600;
        t.max_future_ms = 500;
        t.max_drift_ms = 10_000;
        t.max_staleness_ms = 10_000;
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, false);
        assert_eq!(admit.closed.iter().any(|w| w.id == WALL_TEMPORAL_FUTURE), true);
    }

    #[test]
    fn stale_event_closes() {
        let mut t = TemporalCompileInput::with_defaults();
        t.has_agent_time = true;
        t.bridge_time_ms = 20_000;
        t.agent_time_ms = 10_000;
        t.max_staleness_ms = 5_000;
        t.max_drift_ms = 1_000_000;
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, false);
        assert_eq!(admit.closed.iter().any(|w| w.id == WALL_TEMPORAL_STALE), true);
    }

    #[test]
    fn causal_parent_missing_closes() {
        let mut t = TemporalCompileInput::with_defaults();
        t.causal_parents.push(String::from("evt-parent"));
        t.event_id = String::from("evt-child");
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, false);
        let ids: Vec<&str> = admit.closed.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids.contains(&WALL_TEMPORAL_CAUSAL_PARENT), true);
        let parent_id = causal_parent_wall_id("evt-parent");
        assert_eq!(ids.iter().any(|id| *id == parent_id.as_str()), true);
    }

    #[test]
    fn delivered_causal_parent_opens() {
        let mut t = TemporalCompileInput::with_defaults();
        t.causal_parents.push(String::from("evt-parent"));
        t.causal_satisfied.push(String::from("evt-parent"));
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, true);
    }

    #[test]
    fn missing_dependency_type_closes_without_list() {
        let mut t = TemporalCompileInput::with_defaults();
        t.causal_violation_type = String::from("missing_dependency");
        t.event_id = String::from("evt-x");
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, false);
        assert_eq!(admit.closed.iter().any(|w| w.id == WALL_TEMPORAL_CAUSAL_PARENT), true);
    }

    #[test]
    fn fold_keeps_skew_causal_and_constraint_on_one_pass() {
        let mut t = skew_input();
        t.causal_parents.push(String::from("evt-parent"));
        let extra = vec![AdmitWall::close("constraint:required_field:alpha", "alpha required")];
        let result = fold_temporal_into_admit(&t, &extra);
        assert_eq!(result.allow, false);
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids.contains(&WALL_TEMPORAL_DRIFT), true);
        assert_eq!(ids.contains(&WALL_TEMPORAL_CAUSAL_PARENT), true);
        assert_eq!(ids.contains(&"constraint:required_field:alpha"), true);
    }

    #[test]
    fn wall_order_does_not_change_closed_set() {
        let mut t = skew_input();
        t.causal_parents.push(String::from("p1"));
        let extra = vec![AdmitWall::close("constraint:a", "a")];
        let left = fold_temporal_into_admit(&t, &extra);
        let right = fold_temporal_into_admit(&t, &extra);
        assert_eq!(left.closed_set_key(), right.closed_set_key());
    }

    #[test]
    fn no_agent_time_does_not_invent_skew() {
        let t = TemporalCompileInput::with_defaults();
        let admit = admit_collect_all(&compile_temporal_walls(&t));
        assert_eq!(admit.allow, true);
    }
}

