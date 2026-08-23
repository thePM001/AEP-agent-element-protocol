//! AEP 2.8 Envelope Admit: order-independent wall meet.
//! Evaluation is pure. Apply mutates snapshot state after Admit.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap, HashSet};
mod seq_walls;
mod lattice_yaml;
pub use lattice_yaml::{apply_admit, closed_reasons, load_lattice_yaml, load_lattice_yaml_file, snapshot_from_nodes, EnvelopeError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EnvelopeAction {
    pub action_path: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub trust_tier: u32,
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
    #[serde(default)]
    pub deny_penalize_trust: bool,
    #[serde(default = "default_future")]
    pub max_future_ms: i64,
    #[serde(default)]
    pub last_seq_by_agent: HashMap<String, i64>,
    #[serde(default)]
    pub forecast_require_approval: bool,
    #[serde(default = "default_anom")]
    pub forecast_anomaly_threshold: f64,
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
            deny_penalize_trust: false,
            max_future_ms: 500,
            last_seq_by_agent: HashMap::new(),
            forecast_require_approval: false,
            forecast_anomaly_threshold: 3.0,
            forecast_cached_score: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LatticeNode {
    pub action_path: String,
    #[serde(default)]
    pub parents: Vec<String>,
    #[serde(default = "one")]
    pub trust_floor: u32,
    #[serde(default)]
    pub category: String,
}

fn one() -> u32 { 1 }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WallVerdict {
    pub name: String,
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
    pub penalize_trust: bool,
    pub ledger_allow: bool,
}

pub fn admit(action: &EnvelopeAction, snap: &Snapshot) -> AdmitResult {
    let mut walls = all_walls(action, snap);
    walls.sort_by(|a, b| a.name.cmp(&b.name));
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

pub fn plan_apply(result: &AdmitResult, snap: &Snapshot) -> ApplyPlan {
    if result.allow {
        ApplyPlan {
            increment_rate: true,
            penalize_trust: false,
            ledger_allow: true,
        }
    } else {
        ApplyPlan {
            increment_rate: false,
            penalize_trust: snap.deny_penalize_trust,
            ledger_allow: false,
        }
    }
}

pub fn apply(snap: &mut Snapshot, plan: &ApplyPlan) {
    if plan.increment_rate {
        snap.actions_last_minute = snap.actions_last_minute.saturating_add(1);
        snap.event_rate = snap.event_rate.saturating_add(1);
    }
    if plan.penalize_trust {
        snap.trust_score = snap.trust_score.saturating_sub(10);
    }
}

fn wall(name: &str, family: &str, open: bool, reason: &str) -> WallVerdict {
    WallVerdict {
        name: name.to_string(),
        family: family.to_string(),
        open,
        reason: reason.to_string(),
    }
}

fn all_walls(action: &EnvelopeAction, snap: &Snapshot) -> Vec<WallVerdict> {
    vec![
        wall_dag(action, snap),
        wall_trust(action, snap),
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
        return wall("dag.membership", "dag", true, "no lattice configured");
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
        .filter(|p| !snap.satisfied_actions.contains(*p))
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

fn wall_trust(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    let floor = snap
        .lattice_nodes
        .get(&action.action_path)
        .map(|n| n.trust_floor)
        .unwrap_or(1);
    let tier = if action.agent_id.is_empty() {
        1
    } else {
        action.trust_tier.max(1)
    };
    if tier >= floor {
        wall("trust.floor", "trust", true, "tier meets floor")
    } else {
        wall(
            "trust.floor",
            "trust",
            false,
            &format!("tier {} below floor {}", tier, floor),
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
    if snap.proven_scene_ids.is_empty() || action.scene_id.is_empty() {
        return wall("scene.membership", "scene", true, "no scene bound");
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
        return wall("time.authority", "time", true, "no timestamps");
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
    if snap.allowed_docks.is_empty() || action.dest_dock.is_empty() {
        return wall("channel.dock", "channel", true, "no dock bound");
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
    if critical_actions().contains(action.action_path.as_str()) && action.trust_tier < 5 {
        return wall("rego.restricted", "rego", false, "critical path needs tier 5");
    }
    if snap.event_rate >= snap.event_rate_max {
        return wall("rego.restricted", "rego", false, "event rate closed");
    }
    wall("rego.restricted", "rego", true, "restricted fragment open")
}

fn wall_forbidden_seq(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict {
    for (parent, child) in forbidden_pairs() {
        if action.action_path == child && snap.satisfied_actions.iter().any(|s| s == parent) {
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
    result.closed_walls.iter().map(|w| w.name.clone()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_node(path: &str, parents: &[&str], floor: u32) -> (String, LatticeNode) {
        (
            path.to_string(),
            LatticeNode {
                action_path: path.to_string(),
                parents: parents.iter().map(|s| s.to_string()).collect(),
                trust_floor: floor,
                category: "test".into(),
            },
        )
    }

    fn base_snap() -> Snapshot {
        let mut snap = Snapshot::default();
        snap.lattice_nodes.extend([
            sample_node("root:ping", &[], 1),
            sample_node("action:write", &["root:ping"], 2),
        ]);
        snap.satisfied_actions.insert("root:ping".into());
        snap
    }

    fn act(path: &str, tier: u32) -> EnvelopeAction {
        EnvelopeAction {
            action_path: path.into(),
            agent_id: "agent-a".into(),
            trust_tier: tier,
            payload: serde_json::json!({"ok": true}),
            tool: String::new(),
            dest_dock: String::new(),
            scene_id: String::new(),
            agent_ts_ms: 0,
            sequence_number: 0,
            anomaly_score: 0.0,
        }
    }

    #[test]
    fn allow_when_all_open() {
        let snap = base_snap();
        let r = admit(&act("action:write", 3), &snap);
        assert!(r.allow);
        assert!(r.closed_walls.is_empty());
    }

    #[test]
    fn unknown_path_closes_dag_and_rego() {
        let snap = base_snap();
        let r = admit(&act("bogus:path", 3), &snap);
        assert!(!r.allow);
        let names = closed_names(&r);
        assert!(names.contains("dag.membership"));
        assert!(names.contains("rego.restricted"));
    }

    #[test]
    fn dual_gap_and_trust_both_listed() {
        let mut snap = base_snap();
        snap.lattice_nodes
            .get_mut("action:write")
            .unwrap()
            .trust_floor = 5;
        let mut a = act("action:write", 1);
        a.payload = serde_json::json!({"text": "foo, and bar"});
        let r = admit(&a, &snap);
        assert!(!r.allow);
        let names = closed_names(&r);
        assert!(names.contains("gap.writing"), "gap missing: {:?}", names);
        assert!(names.contains("trust.floor"), "trust missing: {:?}", names);
    }

    #[test]
    fn shuffle_wall_order_same_closed_set() {
        let mut snap = base_snap();
        snap.lattice_nodes
            .get_mut("action:write")
            .unwrap()
            .trust_floor = 5;
        let mut a = act("action:write", 1);
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
        let r = admit(&act("bogus:path", 3), &snap);
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
        let r = admit(&act("action:write", 3), &snap);
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
        let act = act("action:write", 3);
        assert_eq!(closed_names(&admit(&act, &a)), closed_names(&admit(&act, &b)));
        assert_eq!(admit(&act, &a).allow, admit(&act, &b).allow);
    }

    #[test]
    fn missing_parent_closes() {
        let mut snap = base_snap();
        snap.satisfied_actions.clear();
        let r = admit(&act("action:write", 3), &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("dag.parents"));
    }

    #[test]
    fn causal_regression_closes() {
        let mut snap = base_snap();
        snap.last_seq_by_agent.insert("agent-a".into(), 5);
        let mut a = act("action:write", 3);
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
        let mut a = act("action:write", 3);
        a.anomaly_score = 4.0;
        let r = admit(&a, &snap);
        assert!(!r.allow);
        assert!(closed_names(&r).contains("forecast.anomaly"));
    }
}
