// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:ad29234bbeaa66ab8cc6fad39f9547d9ee120ad5f33d2c34d0519e8f052b9c07
// AEP28-ENV-024: ActionLattice YAML load in aep-envelope.

use crate::{ApplyPlan, EnvelopeAction, LatticeNode, Snapshot};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

#[derive(Debug)]
pub enum EnvelopeError {
    Yaml(String),
    Cycle(String),
    UnknownParent { id: String, parent: String },
    UnknownChild { id: String, child: String },
    Io(String),
}

impl std::fmt::Display for EnvelopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnvelopeError::Yaml(s) => write!(f, "yaml: {}", s),
            EnvelopeError::Cycle(s) => write!(f, "lattice cycle involving {}", s),
            EnvelopeError::UnknownParent { id, parent } => {
                write!(f, "action {} references unknown parent {}", id, parent)
            }
            EnvelopeError::UnknownChild { id, child } => {
                write!(f, "action {} references unknown child {}", id, child)
            }
            EnvelopeError::Io(s) => write!(f, "io: {}", s),
        }
    }
}

impl std::error::Error for EnvelopeError {}

#[derive(Debug, Deserialize)]
struct YamlLattice {
    #[serde(default)]
    actions: HashMap<String, YamlNode>,
}

#[derive(Debug, Deserialize, Default)]
struct YamlNode {
    #[serde(default)]
    category: String,
    #[serde(default)]
    parents: Vec<String>,
    #[serde(default)]
    children: Vec<String>,
    #[serde(default = "one")]
    trust_floor: u32,
}

fn one() -> u32 {
    1
}

fn mapping_colon(rest: &str) -> Option<usize> {
    if let Some(i) = rest.find(": ") { return Some(i); }
    if let Some(i) = rest.find(":\t") { return Some(i); }
    if rest.ends_with(':') { return Some(rest.len() - 1); }
    rest.find(':')
}

fn quote_colon_keys(raw: &str) -> String {
    let mut out = String::new();
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        let rest = line.trim_start();
        if let Some(colon) = mapping_colon(rest) {
            let key = rest[..colon].trim();
            if key.contains(':') && !key.starts_with('"') && !key.starts_with('\'') {
                let after = &rest[colon + 1..];
                for _ in 0..indent {
                    out.push(' ');
                }
                out.push('"');
                out.push_str(key);
                out.push('"');
                out.push(':');
                out.push_str(after);
                out.push('\n');
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

pub fn load_lattice_yaml(text: &str) -> Result<HashMap<String, LatticeNode>, EnvelopeError> {
    let quoted = quote_colon_keys(text);
    let parsed: YamlLattice = serde_yaml::from_str(&quoted)
        .map_err(|e| EnvelopeError::Yaml(e.to_string()))?;
    let mut nodes: HashMap<String, LatticeNode> = HashMap::new();
    for (id, n) in parsed.actions {
        nodes.insert(
            id.clone(),
            LatticeNode {
                action_path: id,
                parents: n.parents,
                trust_floor: n.trust_floor,
                category: n.category,
            },
        );
    }
    validate_refs(&nodes)?;
    detect_cycle(&nodes)?;
    Ok(nodes)
}

pub fn load_lattice_yaml_file(path: &Path) -> Result<HashMap<String, LatticeNode>, EnvelopeError> {
    let raw = std::fs::read_to_string(path).map_err(|e| EnvelopeError::Io(e.to_string()))?;
    load_lattice_yaml(&raw)
}

fn validate_refs(nodes: &HashMap<String, LatticeNode>) -> Result<(), EnvelopeError> {
    for (id, node) in nodes {
        for p in &node.parents {
            if !nodes.contains_key(p) {
                return Err(EnvelopeError::UnknownParent {
                    id: id.clone(),
                    parent: p.clone(),
                });
            }
        }
    }
    Ok(())
}

fn detect_cycle(nodes: &HashMap<String, LatticeNode>) -> Result<(), EnvelopeError> {
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    for (id, node) in nodes {
        for p in &node.parents {
            children.entry(p.clone()).or_default().push(id.clone());
        }
    }
    let mut visited: HashSet<String> = HashSet::new();
    let mut stack: HashSet<String> = HashSet::new();
    fn dfs(
        id: &str,
        children: &HashMap<String, Vec<String>>,
        visited: &mut HashSet<String>,
        stack: &mut HashSet<String>,
    ) -> Option<String> {
        if stack.contains(id) {
            return Some(id.to_string());
        }
        if visited.contains(id) {
            return None;
        }
        visited.insert(id.to_string());
        stack.insert(id.to_string());
        if let Some(chs) = children.get(id) {
            for c in chs {
                if let Some(hit) = dfs(c, children, visited, stack) {
                    return Some(hit);
                }
            }
        }
        stack.remove(id);
        None
    }
    for id in nodes.keys() {
        if let Some(hit) = dfs(id, &children, &mut visited, &mut stack) {
            return Err(EnvelopeError::Cycle(hit));
        }
    }
    Ok(())
}

pub fn snapshot_from_nodes(
    nodes: HashMap<String, LatticeNode>,
    satisfied: BTreeSet<String>,
    bridge_ts_ms: i64,
) -> Snapshot {
    let mut snap = Snapshot::default();
    snap.lattice_nodes = nodes;
    snap.satisfied_actions = satisfied;
    snap.bridge_ts_ms = bridge_ts_ms;
    snap
}

pub fn apply_admit(snap: &mut Snapshot, action: &EnvelopeAction, plan: &ApplyPlan) {
    crate::apply(snap, plan);
    if plan.ledger_allow {
        snap.satisfied_actions.insert(action.action_path.clone());
        if !action.agent_id.is_empty() && action.sequence_number > 0 {
            let e = snap
                .last_seq_by_agent
                .entry(action.agent_id.clone())
                .or_insert(0);
            if action.sequence_number > *e {
                *e = action.sequence_number;
            }
        }
    }
}

pub fn closed_reasons(result: &crate::AdmitResult) -> Vec<String> {
    result
        .closed_walls
        .iter()
        .map(|w| {
            if w.reason.is_empty() {
                w.name.clone()
            } else {
                w.reason.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn must(cond: bool) {
        if !cond {
            std::process::abort();
        }
    }

    #[test]
    fn loads_colon_keys() {
        let yaml = "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    trust_floor: 1\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    trust_floor: 2\n";
        let nodes = load_lattice_yaml(yaml).expect("load");
        must(nodes.contains_key("root:ping"));
        must(nodes.contains_key("action:write"));
        must(nodes.get("action:write").unwrap().parents[0] == "root:ping");
        must(nodes.get("action:write").unwrap().trust_floor == 2);
    }

    #[test]
    fn cycle_denies() {
        let yaml = "actions:\n  a:x:\n    parents: [\"b:y\"]\n    children: []\n  b:y:\n    parents: [\"a:x\"]\n    children: []\n";
        must(load_lattice_yaml(yaml).is_err());
    }

    #[test]
    fn apply_admit_records_satisfied() {
        let mut snap = Snapshot::default();
        let action = EnvelopeAction {
            action_path: "root:ping".into(),
            agent_id: "agent-a".into(),
            trust_tier: 1,
            payload: serde_json::json!({"ok": true}),
            tool: String::new(),
            dest_dock: String::new(),
            scene_id: String::new(),
            agent_ts_ms: 0,
            sequence_number: 3,
            anomaly_score: 0.0,
        };
        let plan = ApplyPlan {
            increment_rate: true,
            penalize_trust: false,
            ledger_allow: true,
        };
        apply_admit(&mut snap, &action, &plan);
        must(snap.satisfied_actions.contains("root:ping"));
        must(snap.last_seq_by_agent.get("agent-a") == Some(&3));
        must(snap.actions_last_minute == 1);
    }
}
