//! AEP 2.8 Envelope Admit: order-independent wall meet.
//! Evaluation is pure. Apply mutates snapshot state after Admit.
//! @PAD: gaplune-pad-transform encode
//! @GCDE: gaplune-decode hmac-sha256:9f7de97867e86cc6d506eb08b203375fb20d7ca308541da6a01700a70ff1ce53
//! AEP28-ENV-038: EnvelopeAction has no rank field. Who-may is agent_may.
//! AEP28-ENV-042: empty lattice closes dag.membership and gap.agent_may. Do not reopen AEP28-ENV-034.
//! AEP28-ENV-066: unbound scene, channel, time and sequence close. dest_dock may bind from the opened frame docking port. Missing scene_id, timestamps or sequence_number is Deny. Do not reopen AEP28-ENV-034 or AEP28-ENV-042.
//! AEP28-ENV-065: max_drift_ms stays 50 against the frozen seal snapshot. Do not set max_drift_ms to 1000 as the pulse length.
//! AEP28-ENV-043: partition satisfied_actions by agent or session so parent closure cannot leak across agents.
//! AEP28-ENV-049: one Admit function and one id vocabulary. extra_walls is AdmitWall. Drop conversion from a second admit_collect_all.
//! AEP28-ENV-067: LatticeNode.wrap binds policy-system GAP walls. writing and security stay always-on. Do not reopen AEP28-ENV-056.
//! AEP28-ENV-068: wall_forecast uses live anomaly_score only. Cached forecast score is not a wall verdict. Attractors do not skip Admit. Do not reopen AEP28-ENV-025.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
mod seq_walls;
mod lattice_yaml;
pub use lattice_yaml::{apply_admit, closed_reasons, load_lattice_yaml, load_lattice_yaml_file, snapshot_from_nodes, EnvelopeError};
pub use aep_admit::AdmitWall;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvelopeAction {
    pub action_path: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub dest_dock: String,
    #[serde(default)]
    pub scene_id: String,
    #[serde(default)]
    pub agent_ts_ms: i64,
    #[serde(default)]
    pub sequence_number: i64,
    #[serde(default)]
    pub anomaly_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    #[serde(default)]
    pub proven_scene_ids: BTreeSet<String>,
    #[serde(default)]
    pub lattice_nodes: HashMap<String, LatticeNode>,
    #[serde(default)]
    pub satisfied_actions: BTreeSet<String>,
    /// Session partition. Empty keeps agent keys without a session prefix.
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub actions_last_minute: u32,
    #[serde(default = "default_max_actions")]
    pub max_actions_per_minute: u32,
    #[serde(default)]
    pub bridge_ts_ms: i64,
    #[serde(default = "default_drift")]
    pub max_drift_ms: i64,
    #[serde(default = "default_age")]
    pub max_age_ms: i64,
    #[serde(default)]
    pub allowed_docks: BTreeSet<String>,
    /// Isolation telemetry. Walls must not read this field.
    /// Isolation telemetry. Walls must not read this field.
    #[serde(default)]
    pub trust_score: u32,
    #[serde(default)]
    pub simultaneous_outputs: u32,
    #[serde(default)]
    pub event_rate: u32,
    #[serde(default = "default_event_rate_max")]
    pub event_rate_max: u32,
    #[serde(default)]
    pub forbid_tools: BTreeSet<String>,
    #[serde(default)]
    pub permit_tools: BTreeSet<String>,
    #[serde(default)]
    pub scanner_needles: Vec<String>,
    #[serde(default)]
    pub gap_scan_payload: bool,
    #[serde(default = "default_future")]
    pub max_future_ms: i64,
    #[serde(default)]
    pub last_seq_by_agent: HashMap<String, i64>,
    #[serde(default)]
    pub forecast_require_approval: bool,
    #[serde(default = "default_anom")]
    pub forecast_anomaly_threshold: f64,
    /// Forensic telemetry. wall_forecast must not read this field.
    #[serde(default)]
    pub forecast_cached_score: f64,
}

fn default_max_actions() -> u32 { 200 }
fn default_drift() -> i64 { 50 }
fn default_age() -> i64 { 5000 }
fn default_future() -> i64 { 500 }
fn default_anom() -> f64 { 3.0 }
fn default_event_rate_max() -> u32 { 200 }

impl Default for Snapshot {
    fn default() -> Self {
        Self {
            proven_scene_ids: BTreeSet::new(),
            lattice_nodes: HashMap::new(),
            satisfied_actions: BTreeSet::new(),
            session_id: String::new(),
            actions_last_minute: 0,
            max_actions_per_minute: 200,
            bridge_ts_ms: 0,
            max_drift_ms: 50,
            max_age_ms: 5000,
            allowed_docks: BTreeSet::new(),
            trust_score: 500,
            simultaneous_outputs: 0,
            event_rate: 0,
            event_rate_max: 200,
            forbid_tools: BTreeSet::new(),
            permit_tools: BTreeSet::new(),
            scanner_needles: Vec::new(),
            gap_scan_payload: true,
            max_future_ms: 500,
            last_seq_by_agent: HashMap::new(),
            forecast_require_approval: false,
            forecast_anomaly_threshold: 3.0,
            forecast_cached_score: 0.0,
        }
    }
}

pub fn is_system_category(category: &str) -> bool {
    category == "system_event" || category == "external_event"
}

pub fn is_system_path(snap: &Snapshot, path: &str) -> bool {
    match snap.lattice_nodes.get(path) {
        Some(n) => is_system_category(&n.category),
        None => false,
    }
}

pub fn agent_partition_id(agent_id: &str) -> &str {
    if agent_id.is_empty() {
        "unbound"
    } else {
        agent_id
    }
}

pub fn system_record_key(session_id: &str, path: &str) -> String {
    if session_id.is_empty() {
        path.to_string()
    } else {
        let mut k = String::from("ses|");
        k.push_str(session_id);
        k.push('|');
        k.push_str(path);
        k
    }
}

pub fn agent_record_key(session_id: &str, agent_id: &str, path: &str) -> String {
    let agt = agent_partition_id(agent_id);
    if session_id.is_empty() {
        let mut k = String::from("agt|");
        k.push_str(agt);
        k.push('|');
        k.push_str(path);
        k
    } else {
        let mut k = String::from("ses|");
        k.push_str(session_id);
        k.push_str("|agt|");
        k.push_str(agt);
        k.push('|');
        k.push_str(path);
        k
    }
}

pub fn satisfied_record_key(snap: &Snapshot, path: &str, agent_id: &str) -> String {
    if is_system_path(snap, path) {
        system_record_key(&snap.session_id, path)
    } else {
        agent_record_key(&snap.session_id, agent_id, path)
    }
}

pub fn record_satisfied(snap: &mut Snapshot, path: &str, agent_id: &str) {
    let key = satisfied_record_key(snap, path, agent_id);
    snap.satisfied_actions.insert(key);
}

pub fn parent_is_satisfied(snap: &Snapshot, parent: &str, agent_id: &str) -> bool {
    if is_system_path(snap, parent) {
        let k = system_record_key(&snap.session_id, parent);
        if snap.satisfied_actions.contains(&k) {
            return true;
        }
        snap.satisfied_actions.contains(parent)
    } else {
        let k = agent_record_key(&snap.session_id, agent_id, parent);
        snap.satisfied_actions.contains(&k)
    }
}

pub fn action_is_satisfied(snap: &Snapshot, path: &str, agent_id: &str) -> bool {
    parent_is_satisfied(snap, path, agent_id)
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct LatticeNode {
    #[serde(default)]
    pub action_path: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default)]
    pub agent_may: Vec<String>,
    #[serde(default)]
    pub category: String,
    /// Policy wrap. Empty means the node does not bind wrap-scoped GAP items.
    #[serde(default)]
    pub wrap: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WallVerdict {
    pub id: String,
    pub family: String,
    pub open: bool,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdmitResult {
    pub allow: bool,
    pub closed_walls: Vec<WallVerdict>,
    pub open_walls: Vec<WallVerdict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplyPlan {
    pub increment_rate: bool,
    pub ledger_allow: bool,
}

pub fn admit(action: &EnvelopeAction, snap: &Snapshot) -> AdmitResult {
    admit_with_extra(action, snap, Vec::new())
}

/// One Admit combinator. Envelope walls plus extra dock walls. AND of every closed wall.
/// Extra walls keep AdmitWall id. Do not convert extra_walls from a second admit_collect_all.
pub fn admit_with_extra(
    action: &EnvelopeAction,
    snap: &Snapshot,
    extra: Vec<AdmitWall>,
) -> AdmitResult {
    let mut walls = all_walls(action, snap);
    for w in extra {
        walls.push(WallVerdict {
            id: w.id,
            family: String::from("dock"),
            open: w.closed == false,
            reason: w.reason,
        });
    }
    walls.sort_by(|a, b| a.id.cmp(&b.id));
    let mut closed = Vec::new();
    let mut open = Vec::new();
    for w in walls {
        if w.open {
            open.push(w);
        } else {
            closed.push(w);
        }
    }
    AdmitResult {
        allow: closed.is_empty(),
        closed_walls: closed,
        open_walls: open,
    }
}

pub fn plan_apply(result: &AdmitResult, _snap: &Snapshot) -> ApplyPlan {
    if result.allow {
        ApplyPlan {
            increment_rate: true,
            ledger_allow: true,
        }
    } else {
        ApplyPlan {
            increment_rate: false,
            ledger_allow: false,
        }
    }
}

pub fn apply(snap: &mut Snapshot, plan: &ApplyPlan) {
    if plan.increment_rate {
        snap.actions_last_minute = snap.actions_last_minute.saturating_add(1);
        snap.event_rate = snap.event_rate.saturating_add(1);
    }
}

fn wall(id: &str, family: &str, open: bool, reason: &str) -> WallVerdict {
    WallVerdict {
        id: id.to_string(),
        family: family.to_string(),
        open,
        reason: reason.to_string(),
    }
}

/// dest_dock may bind from the opened frame docking port when the event field is empty.
pub fn dest_dock_from_opened_frame(event_dest_dock: &str, docking_port: &str) -> String {
    if event_dest_dock.is_empty() == false {
        return event_dest_dock.to_string();
    }
    docking_port.to_string()
}

fn all_walls(action: &EnvelopeAction, snap: &Snapshot) -> Vec<WallVerdict> {
    vec![
        wall_dag(action, snap),
        wall_agent_may(action, snap),
        wall_gap(action, snap),
        wall_scene(action, snap),
        wall_time(action, snap),
        wall_channel(action, snap),
        wall_rate(action, snap),
        wall_scanner(action, snap),
        wall_restricted_rego(action, snap),
        wall_covenant(action, snap),
        seq_walls::wall_causal(action, snap),
        seq_walls::wall_forecast(action, snap),
        wall_parents(action, snap),
        wall_forbidden_seq(action, snap),
        wall_output_ceiling(action, snap),
    ]
}

fn wall_dag(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if snap.lattice_nodes.is_empty() {
        return wall("dag.membership", "dag", false, "empty lattice closes membership");
    }
    if snap.lattice_nodes.contains_key(&action.action_path) {
        wall("dag.membership", "dag", true, "node exists")
    } else {
        wall(
            "dag.membership",
            "dag",
            false,
            &format!("unknown action_path {}", action.action_path),
        )
    }
}

fn wall_parents(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    let Some(node) = snap.lattice_nodes.get(&action.action_path) else {
        return wall("dag.parents", "dag", true, "membership wall covers miss");
    };
    let missing: Vec<&str> = node
        .parents
        .iter()
        .filter(|p| parent_is_satisfied(snap, p, &action.agent_id) == false)
        .map(|s| s.as_str())
        .collect();
    if missing.is_empty() {
        wall("dag.parents", "dag", true, "parents satisfied")
    } else {
        wall(
            "dag.parents",
            "dag",
            false,
            &format!("missing parents {}", missing.join(",")),
        )
    }
}

fn wall_agent_may(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if snap.lattice_nodes.is_empty() {
        return wall("gap.agent_may", "gap", false, "empty lattice closes agent_may");
    }
    let Some(node) = snap.lattice_nodes.get(&action.action_path) else {
        return wall("gap.agent_may", "gap", true, "membership wall covers miss");
    };
    let systemish = node.category == "system_event" || node.category == "external_event";
    if node.agent_may.is_empty() {
        if systemish {
            return wall("gap.agent_may", "gap", true, "system event has no agent actor");
        }
        return wall(
            "gap.agent_may",
            "gap",
            false,
            "GAP dimension agent_may closed: empty grants fail closed",
        );
    }
    let granted = node.agent_may.iter().any(|g| {
        if g == "*" {
            action.agent_id.is_empty() == false
        } else if g == "unbound" {
            action.agent_id.is_empty()
        } else {
            g == &action.agent_id
        }
    });
    if granted {
        wall("gap.agent_may", "gap", true, "agent may action")
    } else {
        let who = if action.agent_id.is_empty() {
            "unbound"
        } else {
            action.agent_id.as_str()
        };
        wall(
            "gap.agent_may",
            "gap",
            false,
            &format!(
                "GAP dimension agent_may closed: agent '{}' may not '{}'",
                who, action.action_path
            ),
        )
    }
}

fn wall_gap(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if !snap.gap_scan_payload {
        return wall("gap.writing", "gap", true, "gap scan off");
    }
    let mut texts = Vec::new();
    collect_strings(&action.payload, &mut texts);
    texts.push(action.action_path.clone());
    for t in &texts {
        if t.chars().any(|c| matches!(c, '\u{2014}' | '\u{2013}' | '\u{2015}' | '\u{2212}')) {
            return wall("gap.writing", "gap", false, "forbidden dash in payload");
        }
        if t.contains(", and ") || t.contains(", or ") {
            return wall("gap.writing", "gap", false, "oxford comma in payload");
        }
    }
    wall("gap.writing", "gap", true, "writing ok")
}

fn collect_strings(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::String(s) => out.push(s.clone()),
        serde_json::Value::Array(a) => {
            for x in a {
                collect_strings(x, out);
            }
        }
        serde_json::Value::Object(m) => {
            for x in m.values() {
                collect_strings(x, out);
            }
        }
        _ => {}
    }
}

fn wall_scene(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if action.scene_id.is_empty() {
        return wall("scene.membership", "scene", false, "no scene bound");
    }
    if snap.proven_scene_ids.is_empty() {
        return wall(
            "scene.membership",
            "scene",
            false,
            "empty proven scene set closes membership",
        );
    }
    if snap.proven_scene_ids.contains(&action.scene_id) {
        wall("scene.membership", "scene", true, "scene proven")
    } else {
        wall(
            "scene.membership",
            "scene",
            false,
            &format!("scene {} not proven", action.scene_id),
        )
    }
}

fn wall_time(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if action.agent_ts_ms == 0 || snap.bridge_ts_ms == 0 {
        return wall("time.authority", "time", false, "no timestamps");
    }
    let drift = (action.agent_ts_ms - snap.bridge_ts_ms).abs();
    if drift > snap.max_drift_ms {
        return wall(
            "time.authority",
            "time",
            false,
            &format!("drift {} exceeds {}", drift, snap.max_drift_ms),
        );
    }
    let age = snap.bridge_ts_ms - action.agent_ts_ms;
    if age > snap.max_age_ms {
        return wall("time.authority", "time", false, "stale event");
    }
    if action.agent_ts_ms > snap.bridge_ts_ms + snap.max_future_ms {
        return wall("time.authority", "time", false, "future stamp");
    }
    wall("time.authority", "time", true, "time ok")
}

fn wall_channel(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if action.dest_dock.is_empty() {
        return wall("channel.dock", "channel", false, "no dock bound");
    }
    if snap.allowed_docks.is_empty() {
        return wall(
            "channel.dock",
            "channel",
            false,
            "empty allowed docks closes channel",
        );
    }
    if snap.allowed_docks.contains(&action.dest_dock) {
        wall("channel.dock", "channel", true, "dock allowed")
    } else {
        wall(
            "channel.dock",
            "channel",
            false,
            &format!("dock {} denied", action.dest_dock),
        )
    }
}

fn wall_rate(_action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if snap.actions_last_minute >= snap.max_actions_per_minute {
        wall("rate.session", "rate", false, "would exceed session rate")
    } else {
        wall("rate.session", "rate", true, "rate open")
    }
}

fn wall_scanner(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if snap.scanner_needles.is_empty() {
        return wall("scanner.bundle", "scanner", true, "no needles");
    }
    let blob = action.payload.to_string().to_lowercase();
    for n in &snap.scanner_needles {
        if blob.contains(&n.to_lowercase()) {
            return wall(
                "scanner.bundle",
                "scanner",
                false,
                &format!("needle {}", n),
            );
        }
    }
    wall("scanner.bundle", "scanner", true, "clean")
}

fn critical_actions() -> HashSet<&'static str> {
    ["market:trade:execute", "agent:email:send"]
        .into_iter()
        .collect()
}

fn output_actions() -> HashSet<&'static str> {
    [
        "output:notify",
        "output:ui_mutation",
        "output:speech",
        "output:haptic",
    ]
    .into_iter()
    .collect()
}

fn forbidden_pairs() -> Vec<(&'static str, &'static str)> {
    vec![
        ("system:shutdown", "agent:register"),
        ("system:shutdown", "agent:ready"),
        ("system:shutdown", "agent:propose_action"),
        ("agent:deregister", "agent:propose_action"),
        ("agent:deregister", "agent:interest:register"),
        ("market:trade:execute", "market:price:update"),
        ("agent:email:send", "email:incoming"),
    ]
}

fn wall_restricted_rego(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if snap.lattice_nodes.is_empty() {
        return wall("rego.restricted", "rego", true, "no lattice");
    }
    if !snap.lattice_nodes.contains_key(&action.action_path) {
        return wall("rego.restricted", "rego", false, "path not in lattice");
    }
    if critical_actions().contains(action.action_path.as_str()) {
        let node = snap.lattice_nodes.get(&action.action_path);
        let granted = match node {
            Some(n) => n.agent_may.iter().any(|g| {
                (g == "*" && action.agent_id.is_empty() == false) || g == &action.agent_id
            }),
            None => false,
        };
        if granted == false {
            return wall(
                "rego.restricted",
                "rego",
                false,
                "critical path needs a granted agent",
            );
        }
    }
    if snap.event_rate >= snap.event_rate_max {
        return wall("rego.restricted", "rego", false, "event rate closed");
    }
    wall("rego.restricted", "rego", true, "restricted fragment open")
}

fn wall_forbidden_seq(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    for (parent, child) in forbidden_pairs() {
        if action.action_path == child && parent_is_satisfied(snap, parent, &action.agent_id) {
            return wall(
                "rego.forbidden_seq",
                "rego",
                false,
                &format!("{} then {}", parent, child),
            );
        }
    }
    wall("rego.forbidden_seq", "rego", true, "no forbidden sequence")
}

fn wall_output_ceiling(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if output_actions().contains(action.action_path.as_str()) && snap.simultaneous_outputs > 3 {
        wall(
            "rego.output_ceiling",
            "rego",
            false,
            "simultaneous outputs exceed 3",
        )
    } else {
        wall("rego.output_ceiling", "rego", true, "ceiling open")
    }
}

fn wall_covenant(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    if action.tool.is_empty() && snap.forbid_tools.is_empty() {
        return wall("covenant.tools", "covenant", true, "no tool bound");
    }
    if !action.tool.is_empty() && snap.forbid_tools.contains(&action.tool) {
        return wall("covenant.tools", "covenant", false, "tool forbidden");
    }
    if !snap.permit_tools.is_empty()
        && !action.tool.is_empty()
        && !snap.permit_tools.contains(&action.tool)
    {
        return wall("covenant.tools", "covenant", false, "tool not permitted");
    }
    wall("covenant.tools", "covenant", true, "covenant open")
}

pub fn closed_names(result: &AdmitResult) -> BTreeSet<String> {
    result.closed_walls.iter().map(|w| w.id.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node(path: &str, parents: &[&str], may: &[&str], category: &str) -> (String, LatticeNode) {
        (
            path.to_string(),
            LatticeNode {
                action_path: path.to_string(),
                parents: parents.iter().map(|s| s.to_string()).collect(),
                agent_may: may.iter().map(|s| s.to_string()).collect(),
                category: category.into(),
                wrap: String::new(),
            },
        )
    }

    fn base_snap() -> Snapshot {
        let mut snap = Snapshot::default();
        snap.lattice_nodes.extend([
            sample_node("root:ping", &[], &["*"], "system_event"),
            sample_node("action:write", &["root:ping"], &["agent-a"], "agent_action"),
        ]);
        snap.satisfied_actions.insert("root:ping".into());
        snap.bridge_ts_ms = 1000;
        snap.proven_scene_ids.insert("scene-a".into());
        snap.allowed_docks.insert("inference_engine".into());
        snap
    }

    fn act(path: &str) -> EnvelopeAction {
        EnvelopeAction {
            action_path: path.into(),
            agent_id: "agent-a".into(),
            payload: serde_json::json!({"ok": true}),
            tool: String::new(),
            dest_dock: "inference_engine".into(),
            scene_id: "scene-a".into(),
            agent_ts_ms: 1000,
            sequence_number: 1,
            anomaly_score: 0.0,
        }
    }

    #[test]
    fn lattice_node_wrap_exists() {
        let n = LatticeNode {
            action_path: String::from("inventory:ping"),
            parents: Vec::new(),
            agent_may: vec![String::from("*")],
            category: String::from("system_event"),
            wrap: String::from("inventory"),
        };
        assert_eq!(n.wrap, "inventory");
        let empty = LatticeNode::default();
        assert!(empty.wrap.is_empty());
    }

    #[test]
    fn allow_when_all_open() {
        let snap = base_snap();
        let r = admit(&act("action:write"), &snap);
        assert!(r.allow);
        assert!(r.closed_walls.is_empty());
    }

    #[test]
    fn unknown_path_closes_dag_and_rego() {
        let snap = base_snap();
        let r = admit(&act("bogus:path"), &snap);
        assert!(!r.allow);
        let names = closed_names(&r);
        assert!(names.contains("dag.membership"));
        assert!(names.contains("rego.restricted"));
    }

    #[test]
    fn dual_gap_and_agent_may_both_listed() {
        let mut snap = base_snap();
        snap.lattice_nodes
            .get_mut("action:write")
            .unwrap()
            .agent_may = vec!["agent-b".into()];
        let mut a = act("action:write");
        a.payload = serde_json::json!({"text": "foo, and bar"});
        let r = admit(&a, &snap);
        assert!(!r.allow);
        let names = closed_names(&r);
        assert!(names.contains("gap.writing"), "gap missing: {:?}", names);
        assert!(names.contains("gap.agent_may"), "agent_may missing: {:?}", names);
    }

    #[test]
    fn shuffle_wall_order_same_closed_set() {
        let mut snap = base_snap();
        snap.lattice_nodes
            .get_mut("action:write")
            .unwrap()
            .agent_may = vec!["agent-b".into()];
        let mut a = act("action:write");
        a.payload = serde_json::json!({"text": "foo, or bar"});
        let first = closed_names(&admit(&a, &snap));
        for _ in 0..100 {
            let again = closed_names(&admit(&a, &snap));
            assert_eq!(first, again);
        }
    }

    #[test]
    fn deny_does_not_increment_rate() {
        let snap = base_snap();
        let r = admit(&act("bogus:path"), &snap);
        assert!(!r.allow);
        let plan = plan_apply(&r, &snap);
        assert!(!plan.increment_rate);
        let mut s2 = snap.clone();
        let before = s2.actions_last_minute;
        apply(&mut s2, &plan);
        assert_eq!(before, s2.actions_last_minute);
    }

    #[test]
    fn allow_increments_rate() {
        let snap = base_snap();
        let r = admit(&act("action:write"), &snap);
        assert!(r.allow);
        let plan = plan_apply(&r, &snap);
        let mut s2 = snap.clone();
        apply(&mut s2, &plan);
        assert_eq!(s2.actions_last_minute, 1);
    }

    #[test]
    fn policy_file_order_irrelevant() {
        let mut a = base_snap();
        let mut b = base_snap();
        a.scanner_needles = vec!["ignoreme".into()];
        b.scanner_needles = vec!["ignoreme".into()];
        a.forbid_tools.insert("shell".into());
        b.forbid_tools.insert("shell".into());
        let act = act("action:write");
        assert_eq!(closed_names(&admit(&act, &a)), closed_names(&admit(&act, &b)));
        assert_eq!(admit(&act, &a).allow, admit(&act, &b).allow);
    }

    #[test]
    fn missing_parent_closes() {
        let mut snap = base_snap();
        snap.satisfied_actions.clear();
        let r = admit(&act("action:write"), &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("dag.parents"));
    }

    #[test]
    fn causal_regression_closes() {
        let mut snap = base_snap();
        snap.last_seq_by_agent.insert("agent-a".into(), 5);
        let mut a = act("action:write");
        a.sequence_number = 2;
        let r = admit(&a, &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("causal.sequence"));
    }

    #[test]
    fn forecast_approval_closes() {
        let mut snap = base_snap();
        snap.forecast_require_approval = true;
        snap.forecast_anomaly_threshold = 3.0;
        let mut a = act("action:write");
        a.anomaly_score = 4.0;
        let r = admit(&a, &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("forecast.anomaly"));
    }

    #[test]
    fn env068_cached_forecast_score_does_not_close() {
        let mut snap = base_snap();
        snap.forecast_require_approval = true;
        snap.forecast_anomaly_threshold = 3.0;
        snap.forecast_cached_score = 9.0;
        let mut a = act("action:write");
        a.anomaly_score = 0.0;
        let r = admit(&a, &snap);
        assert_eq!(r.allow, true);
        assert_eq!(closed_names(&r).contains("forecast.anomaly"), false);
    }

    #[test]
    fn env068_wall_forecast_reads_live_score_only() {
        let src = include_str!("seq_walls.rs");
        let start = match src.find("pub fn wall_forecast") {
            Some(v) => v,
            None => panic!("wall_forecast missing"),
        };
        let rest = &src[start..];
        let end = match rest.find("\npub fn ") {
            Some(v) => v,
            None => rest.len(),
        };
        let body = &rest[..end];
        assert_eq!(body.contains("forecast_cached_score"), false);
        assert_eq!(body.contains("anomaly_score"), true);
    }

    #[test]
    fn extra_closed_wall_denies_when_envelope_open() {
        let snap = base_snap();
        let extra = vec![AdmitWall::close("dock.capsule", "capsule missing")];
        let r = admit_with_extra(&act("action:write"), &snap, extra);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("dock.capsule"), true);
    }

    #[test]
    fn env038_envelope_action_has_no_rank_field() {
        let src = include_str!("lib.rs");
        let start = match src.find("pub struct EnvelopeAction") {
            Some(v) => v,
            None => panic!("EnvelopeAction missing"),
        };
        let rest = &src[start..];
        let end = match rest.find("pub struct Snapshot") {
            Some(v) => v,
            None => rest.len(),
        };
        let body = &rest[..end];
        let needle = ["trust", "_tier"].concat();
        assert_eq!(body.contains(&needle), false);
    }

    #[test]
    fn extra_open_wall_does_not_close_open_envelope() {
        let snap = base_snap();
        let extra = vec![AdmitWall::open("dock.capsule")];
        let r = admit_with_extra(&act("action:write"), &snap, extra);
        assert_eq!(r.allow, true);
        assert_eq!(closed_names(&r).contains("dock.capsule"), false);
    }

    #[test]
    fn empty_lattice_closes_membership_and_agent_may() {
        let snap = Snapshot::default();
        let r = admit(&act("action:write"), &snap);
        assert_eq!(r.allow, false);
        let names = closed_names(&r);
        assert_eq!(names.contains("dag.membership"), true);
        assert_eq!(names.contains("gap.agent_may"), true);
    }

    #[test]
    fn empty_lattice_does_not_open_no_lattice_configured() {
        let src = include_str!("lib.rs");
        let compact: String = src.chars().filter(|c| c.is_whitespace() == false).collect();
        let open_empty = ["true,", "\"nolatticeconfigured\""].concat();
        assert_eq!(compact.contains(&open_empty), false);
        let spaced = ["true, ", "\"no lattice configured\""].concat();
        assert_eq!(src.contains(&spaced), false);
    }

    #[test]
    fn env043_cross_agent_parent_does_not_leak() {
        let mut snap = Snapshot::default();
        snap.lattice_nodes.extend([
            sample_node("root:ping", &[], &["*"], "system_event"),
            sample_node("action:prepare", &["root:ping"], &["agent-a", "agent-b"], "agent_action"),
            sample_node("action:commit", &["action:prepare"], &["agent-a", "agent-b"], "agent_action"),
        ]);
        snap.satisfied_actions.insert("root:ping".into());
        snap.bridge_ts_ms = 1000;
        snap.proven_scene_ids.insert("scene-a".into());
        snap.allowed_docks.insert("inference_engine".into());
        let mut a = act("action:prepare");
        a.agent_id = "agent-a".into();
        let r = admit(&a, &snap);
        assert!(r.allow);
        let plan = plan_apply(&r, &snap);
        apply_admit(&mut snap, &a, &plan);
        assert!(action_is_satisfied(&snap, "action:prepare", "agent-a"));
        assert!(!action_is_satisfied(&snap, "action:prepare", "agent-b"));
        assert!(!snap.satisfied_actions.contains("action:prepare"));
        let mut b = act("action:commit");
        b.agent_id = "agent-b".into();
        let r2 = admit(&b, &snap);
        assert!(!r2.allow);
        assert!(closed_names(&r2).contains("dag.parents"));
        let mut a2 = act("action:commit");
        a2.agent_id = "agent-a".into();
        let r3 = admit(&a2, &snap);
        assert!(r3.allow);
    }

    #[test]
    fn env043_system_parent_visible_to_granted_agent() {
        let snap = base_snap();
        let r = admit(&act("action:write"), &snap);
        assert!(r.allow);
    }

    #[test]
    fn env043_session_prefix_isolates_system_parent() {
        let mut snap = base_snap();
        snap.session_id = "sess-a".into();
        snap.satisfied_actions.clear();
        snap.satisfied_actions.insert("ses|sess-b|root:ping".into());
        let r = admit(&act("action:write"), &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("dag.parents"));
        snap.satisfied_actions.insert("ses|sess-a|root:ping".into());
        let r2 = admit(&act("action:write"), &snap);
        assert!(r2.allow);
    }

    #[test]
    fn missing_scene_id_closes() {
        let snap = base_snap();
        let mut a = act("action:write");
        a.scene_id.clear();
        let r = admit(&a, &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("scene.membership"), true);
    }

    #[test]
    fn empty_proven_scene_ids_closes() {
        let mut snap = base_snap();
        snap.proven_scene_ids.clear();
        let r = admit(&act("action:write"), &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("scene.membership"), true);
    }

    #[test]
    fn missing_dest_dock_closes() {
        let snap = base_snap();
        let mut a = act("action:write");
        a.dest_dock.clear();
        let r = admit(&a, &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("channel.dock"), true);
    }

    #[test]
    fn empty_allowed_docks_closes() {
        let mut snap = base_snap();
        snap.allowed_docks.clear();
        let r = admit(&act("action:write"), &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("channel.dock"), true);
    }

    #[test]
    fn missing_timestamps_closes() {
        let mut snap = base_snap();
        snap.bridge_ts_ms = 0;
        let r = admit(&act("action:write"), &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("time.authority"), true);
        let snap = base_snap();
        let mut a = act("action:write");
        a.agent_ts_ms = 0;
        let r = admit(&a, &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("time.authority"), true);
    }

    #[test]
    fn missing_sequence_number_closes() {
        let snap = base_snap();
        let mut a = act("action:write");
        a.sequence_number = 0;
        let r = admit(&a, &snap);
        assert_eq!(r.allow, false);
        assert_eq!(closed_names(&r).contains("causal.sequence"), true);
    }

    #[test]
    fn dest_dock_binds_from_opened_frame_port() {
        let bound = dest_dock_from_opened_frame("", "inference_engine");
        assert_eq!(bound.as_str(), "inference_engine");
        let keep = dest_dock_from_opened_frame("dock-b", "inference_engine");
        assert_eq!(keep.as_str(), "dock-b");
        let empty = dest_dock_from_opened_frame("", "");
        assert_eq!(empty.is_empty(), true);
    }

    #[test]
    fn env066_fail_open_literals_are_gone() {
        let src = include_str!("lib.rs");
        let compact: String = src.chars().filter(|c| c.is_whitespace() == false).collect();
        assert_eq!(compact.contains("true,\"noscenebound\""), false);
        assert_eq!(compact.contains("true,\"notimestamps\""), false);
        assert_eq!(compact.contains("true,\"nodockbound\""), false);
        let seq = include_str!("seq_walls.rs");
        let seqc: String = seq.chars().filter(|c| c.is_whitespace() == false).collect();
        assert_eq!(seqc.contains("true,\"nosequencebound\""), false);
        assert_eq!(seqc.contains("false,\"nosequencebound\""), true);
    }


    #[test]
    fn max_drift_is_not_pulse_length() {
        assert_eq!(Snapshot::default().max_drift_ms, 50);
        assert_ne!(Snapshot::default().max_drift_ms, 1000);
        let src = include_str!("lib.rs");
        let compact: String = src.chars().filter(|c| c.is_whitespace() == false).collect();
        let needle = ["fn default_drift() -> i64 { ", "1000 }"].concat();
        let compact_needle: String = needle.chars().filter(|c| c.is_whitespace() == false).collect();
        assert_eq!(compact.contains(&compact_needle), false);
        let mut snap = base_snap();
        snap.bridge_ts_ms = 1_000_000;
        snap.max_drift_ms = 50;
        let mut a = act("action:write");
        a.agent_ts_ms = 1_000_040;
        assert_eq!(admit(&a, &snap).allow, true);
        a.agent_ts_ms = 1_000_051;
        assert_eq!(admit(&a, &snap).allow, false);
        assert_eq!(closed_names(&admit(&a, &snap)).contains("time.authority"), true);
    }
}
