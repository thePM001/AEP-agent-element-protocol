// ActionLattice YAML load in aep-envelope.

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
    /// Accepted so lattice files that list children still parse. The graph is
    /// built from parents, so this field is never read.
    #[serde(default)]
    #[allow(dead_code)]
    children: Vec<String>,
    #[serde(default)]
    agent_permission: Vec<String>,
    #[serde(default)]
    wrap: String,
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
                agent_permission: n.agent_permission,
                category: n.category,
                wrap: n.wrap,
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

/// GAP document kind that carries an action lattice. The document holds the
/// same keys as lattice.yaml next to `kind: aep.lattice`.
pub const LATTICE_GAP_KIND: &str = "aep.lattice";

/// Split GAP source into its `---` separated documents, dropping empty ones.
fn gap_documents(text: &str) -> Vec<String> {
    let mut docs = Vec::new();
    let mut cur = String::new();
    for line in text.lines() {
        if line.trim_end() == "---" {
            docs.push(std::mem::take(&mut cur));
            continue;
        }
        cur.push_str(line);
        cur.push('\n');
    }
    docs.push(cur);
    docs.into_iter()
        .filter(|d| d.lines().any(|l| {
            let t = l.trim();
            t.is_empty() == false && t.starts_with('#') == false
        }))
        .collect()
}

/// The top-level `kind:` value of one GAP document, unquoted.
fn gap_document_kind(doc: &str) -> Option<String> {
    for line in doc.lines() {
        if let Some(rest) = line.strip_prefix("kind:") {
            let v = rest.trim().trim_matches('"').trim_matches('\'');
            return Some(String::from(v));
        }
    }
    None
}

/// The one `kind: aep.lattice` document of a GAP file. None or more than one is an error.
pub fn lattice_document_from_gap(text: &str) -> Result<String, EnvelopeError> {
    let mut found: Vec<String> = gap_documents(text)
        .into_iter()
        .filter(|d| gap_document_kind(d).as_deref() == Some(LATTICE_GAP_KIND))
        .collect();
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(EnvelopeError::Yaml(format!("GAP source has no kind: {LATTICE_GAP_KIND} document"))),
        n => Err(EnvelopeError::Yaml(format!("GAP source has {n} kind: {LATTICE_GAP_KIND} documents, want one"))),
    }
}

/// Load a lattice written as GAP. The lattice document is read by the same
/// loader as lattice.yaml, so a GAP lattice and its YAML twin admit alike.
pub fn load_lattice_gap(text: &str) -> Result<HashMap<String, LatticeNode>, EnvelopeError> {
    load_lattice_yaml(&lattice_document_from_gap(text)?)
}

pub fn load_lattice_gap_file(path: &Path) -> Result<HashMap<String, LatticeNode>, EnvelopeError> {
    let raw = std::fs::read_to_string(path).map_err(|e| EnvelopeError::Io(e.to_string()))?;
    load_lattice_gap(&raw)
}

/// True when a lattice path names a GAP file.
pub fn is_gap_lattice_path(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("gap")) == Some(true)
}

/// Load a lattice file as GAP when it ends in .gap and as YAML otherwise.
pub fn load_lattice_file(path: &Path) -> Result<HashMap<String, LatticeNode>, EnvelopeError> {
    if is_gap_lattice_path(path) {
        load_lattice_gap_file(path)
    } else {
        load_lattice_yaml_file(path)
    }
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
        crate::record_satisfied(snap, &action.action_path, &action.agent_id);
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
        .closed
        .iter()
        .map(|w| {
            if w.reason.is_empty() {
                w.id.clone()
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
        let yaml = "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_permission: [\"agent-a\"]\n";
        let nodes = load_lattice_yaml(yaml).expect("load");
        must(nodes.contains_key("root:ping"));
        must(nodes.contains_key("action:write"));
        must(nodes.get("action:write").unwrap().parents[0] == "root:ping");
        must(nodes.get("action:write").unwrap().agent_permission == vec![String::from("agent-a")]);
        must(nodes.get("action:write").unwrap().wrap.is_empty());
    }

    #[test]
    fn loads_wrap_on_lattice_node() {
        let yaml = "actions:\n  inventory:ping:\n    category: system_event\n    wrap: inventory\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  finance:pay:\n    category: agent_action\n    wrap: finance\n    parents: [\"inventory:ping\"]\n    children: []\n    agent_permission: [\"agent-a\"]\n";
        let nodes = load_lattice_yaml(yaml).expect("load");
        must(nodes.get("inventory:ping").unwrap().wrap == "inventory");
        must(nodes.get("finance:pay").unwrap().wrap == "finance");
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
            ledger_allow: true,
        };
        apply_admit(&mut snap, &action, &plan);
        let key = crate::agent_record_key("", "agent-a", "root:ping");
        must(snap.satisfied_actions.contains(&key));
        must(snap.last_seq_by_agent.get("agent-a") == Some(&3));
        must(snap.actions_last_minute == 0);
        must(snap.event_rate == 1);
    }

    const TWIN_YAML: &str = "aep_version: \"2.8.6\"\nactions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_permission: [\"agent-a\"]\n";

    fn twin_gap() -> String {
        format!(
            "address:\n  domain: aep.lattice\n  id: twin.v1\npattern: |\n  Test lattice written as GAP.\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  wrap: kernel\n---\nkind: aep.lattice\n{TWIN_YAML}"
        )
    }

    fn sorted(nodes: &HashMap<String, LatticeNode>) -> Vec<(String, Vec<String>, Vec<String>, String)> {
        let mut v: Vec<_> = nodes
            .values()
            .map(|n| (n.action_path.clone(), n.parents.clone(), n.agent_permission.clone(), n.category.clone()))
            .collect();
        v.sort();
        v
    }

    #[test]
    fn gap_lattice_loads_the_same_nodes_as_its_yaml_twin() {
        let yaml = load_lattice_yaml(TWIN_YAML).expect("yaml twin");
        let gap = load_lattice_gap(&twin_gap()).expect("gap twin");
        must(sorted(&yaml) == sorted(&gap));
        must(gap.contains_key("root:ping") && gap.contains_key("action:write"));
    }

    #[test]
    fn gap_without_a_lattice_document_is_refused() {
        let only_instruction = "address:\n  id: x\npattern: none\n";
        must(load_lattice_gap(only_instruction).is_err());
    }

    #[test]
    fn gap_with_two_lattice_documents_is_refused() {
        let two = format!("{}\n---\nkind: aep.lattice\n{TWIN_YAML}", twin_gap());
        must(load_lattice_gap(&two).is_err());
    }

    #[test]
    fn gap_lattice_keeps_the_yaml_validation() {
        let bad = "---\nkind: aep.lattice\nactions:\n  action:write:\n    category: agent_action\n    parents: [\"root:missing\"]\n    agent_permission: [\"agent-a\"]\n";
        must(load_lattice_gap(bad).is_err());
    }

    #[test]
    fn lattice_file_dispatches_on_the_extension() {
        let dir = std::env::temp_dir().join(format!("gap-lattice-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let g = dir.join("lattice.gap");
        let y = dir.join("lattice.yaml");
        std::fs::write(&g, twin_gap()).expect("write gap");
        std::fs::write(&y, TWIN_YAML).expect("write yaml");
        must(is_gap_lattice_path(&g) && is_gap_lattice_path(&y) == false);
        let a = load_lattice_file(&g).expect("gap file");
        let b = load_lattice_file(&y).expect("yaml file");
        let _ = std::fs::remove_dir_all(&dir);
        must(sorted(&a) == sorted(&b));
    }
}
