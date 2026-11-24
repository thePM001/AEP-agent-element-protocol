// One live evaluation. live_collect_all is not a second combinator beside aep_envelope::admit.
// Extra_walls is AdmitWall id. Drop extra_walls conversion from a second admit_collect_all.
// The source check in this crate is a conformance check named
// conformance_check_one_live_evaluation_source. It is not a second admit path.
use aep_admit_live_dock::{
    compile_live_walls, compile_live_walls_in_view, LiveDockContext, MemoryView, PureWallTrace,
};
use aep_envelope::{admit_with_extra, dest_dock_from_opened_frame, EnvelopeAction};
use aep_live_entry::{LiveEntry, ProcessOut};
use serde_json::Value;

fn action_from_event(event: &Value, docking_port: &str) -> EnvelopeAction {
    let raw_dock = event
        .get("dest_dock")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    EnvelopeAction {
        action_path: event
            .get("action_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        agent_id: event
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        payload: event
            .get("payload")
            .cloned()
            .unwrap_or(Value::Object(serde_json::Map::new())),
        tool: event
            .get("tool")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        dest_dock: dest_dock_from_opened_frame(raw_dock, docking_port),
        scene_id: event
            .get("target_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        agent_ts_ms: event.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(0),
        sequence_number: event
            .get("_sequenceNumber")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        anomaly_score: event
            .get("anomaly_score")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
    }
}

/// Compile product wall crates onto LiveEntry extra walls in the view of a memory. This
/// is not a combinator. Extra walls keep AdmitWall id. Do not convert from a second
/// admit_collect_all. The answer names the rows of the pure wall family and whether
/// they were stored rows, so the caller can store computed rows after the verdict.
pub fn attach_live_walls_in_view(
    live: &mut LiveEntry,
    event: &Value,
    dock: &LiveDockContext,
    view: &MemoryView<'_>,
) -> PureWallTrace {
    let compiled = compile_live_walls_in_view(live, event, dock, view);
    live.extra_walls = compiled.walls;
    // process_event records this charge in the budget ledger only when Admit allows.
    live.budget_charge = compiled.charge;
    let scene = event
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    live.bind_opened_frame(scene, &dock.docking_port);
    live.opened_agent_id = dock.agent_id.clone();
    compiled.pure
}

/// Compile product wall crates onto LiveEntry extra walls without a memory.
pub fn attach_live_walls(live: &mut LiveEntry, event: &Value, dock: &LiveDockContext) {
    let _ = attach_live_walls_in_view(live, event, dock, &MemoryView::without_memory());
}

/// One Admit function for the opened frame. Wall-crate walls plus envelope walls. One AND.
pub fn admit_opened_frame(
    live: &LiveEntry,
    event: &Value,
    dock: &LiveDockContext,
) -> aep_envelope::AdmitResult {
    let extra = compile_live_walls(live, event, dock);
    let mut action = action_from_event(event, &dock.docking_port);
    // The signer of the opened frame is the agent. The event text does not replace it.
    if !dock.agent_id.is_empty() {
        action.agent_id = dock.agent_id.clone();
    }
    admit_with_extra(&action, &live.snapshot, extra)
}

fn deny_prefix(reasons: &[String]) -> String {
    let mut s = String::from("Admit collect-all walls then Apply");
    if !reasons.is_empty() {
        s.push_str(": ");
        s.push_str(&reasons.join("; "));
    }
    s
}

/// One Admit then Apply. Dock path must not call live_collect_all then process_event Admit.
pub fn admit_then_apply(
    live: &mut LiveEntry,
    event: Value,
    dock: &LiveDockContext,
) -> Result<(), String> {
    attach_live_walls(live, &event, dock);
    match live.process_event(event) {
        ProcessOut::Event(_) => Ok(()),
        ProcessOut::Reject(r) => {
            if r.error.contains("Admit collect-all walls then Apply") {
                Err(r.error)
            } else {
                Err(deny_prefix(&[r.error]))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn yaml() -> &'static str {
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_permission: [\"agent-a\"]\n"
    }

    fn must(cond: bool) {
        if !cond {
            std::process::abort();
        }
    }
    #[test]
    fn ping_one_admit_allows() {
        let mut live = LiveEntry::from_yaml(yaml()).expect("yaml");
        live.set_clock_ms(1000000);
        let event: Value = serde_json::from_str(
            "{\"type\":\"PING\",\"action_path\":\"root:ping\",\"payload\":{\"ok\":true},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":1}",
        )
        .unwrap();
        must(admit_then_apply(&mut live, event, &LiveDockContext::unit_open()).is_ok());
    }

    #[test]
    fn unknown_path_one_admit_denies() {
        let mut live = LiveEntry::from_yaml(yaml()).expect("yaml");
        live.set_clock_ms(1000000);
        let event: Value = serde_json::from_str(
            "{\"type\":\"CUSTOM\",\"action_path\":\"bogus:path\",\"payload\":{\"ok\":true},\"timestamp\":1000000}",
        )
        .unwrap();
        let err =
            admit_then_apply(&mut live, event, &LiveDockContext::unit_open()).expect_err("deny");
        must(err.contains("Admit collect-all walls then Apply"));
    }

    #[test]
    fn missing_capsule_one_admit_denies() {
        let mut live = LiveEntry::from_yaml(yaml()).expect("yaml");
        live.set_clock_ms(1000000);
        let mut dock = LiveDockContext::unit_open();
        dock.has_capsule = false;
        dock.docking_wire = String::from("ping");
        dock.channel_id = String::new();
        let event: Value = serde_json::from_str(
            "{\"type\":\"PING\",\"action_path\":\"root:ping\",\"payload\":{\"ok\":true},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":1}",
        )
        .unwrap();
        let err = admit_then_apply(&mut live, event, &dock).expect_err("deny");
        must(err.contains("Admit collect-all walls then Apply"));
    }
}
