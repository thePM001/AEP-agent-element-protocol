//! The EDE lifecycle wall.
//!
//! The verbs of the enforced draft environment are lattice nodes of
//! registries/aep-lattice.yaml: ede.seed, ede.refresh, ede.scan, ede.verify,
//! ede.promote and ede.expire, with promote under scan and verify. Every draft environment
//! asks this wall before each verb. The draft environment hands in the facts of its
//! signed draft record (the state, the satisfied lifecycle nodes and the times of the
//! seed, the scan and the CI seal) with the age bounds of its operator. The wall is one
//! collect-all pass with default deny like every Admit of AEP.

use crate::{wall, AdmitResult, AdmitWall, LatticeNode};
use std::collections::{BTreeSet, HashMap};

/// The verbs of the lifecycle, each one a node ede.<verb>.
pub const VERBS: &[&str] = &["seed", "refresh", "scan", "verify", "promote", "expire"];

/// The states a draft record can name. none stands for a draft that does not exist yet.
pub const STATES: &[&str] = &[
    "none",
    "seeded",
    "admitted",
    "written",
    "scanned",
    "promoting",
    "promoted",
    "expired",
];

/// The facts of one verb on one draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdeRequest {
    pub verb: String,
    pub state: String,
    pub satisfied: BTreeSet<String>,
    /// Unix seconds of the clock of the draft environment.
    pub now: u64,
    /// Unix seconds of the seed, of the scan and of the CI seal; 0 when there is none.
    pub seeded: u64,
    pub scanned: u64,
    pub sealed: u64,
    /// The age bounds of the operator, in seconds. 0 closes the wall: a bound must be set.
    pub draft_max: u64,
    pub scan_max: u64,
    pub seal_max: u64,
}

/// The node of a verb.
pub fn node_of(verb: &str) -> String {
    format!("ede.{}", verb)
}

fn closed(id: &str, family: &str, reason: &str) -> AdmitWall {
    wall(id, family, false, reason)
}

fn open(id: &str, family: &str, reason: &str) -> AdmitWall {
    wall(id, family, true, reason)
}

fn wall_membership(nodes: &HashMap<String, LatticeNode>, req: &EdeRequest) -> AdmitWall {
    if !VERBS.contains(&req.verb.as_str()) {
        return closed(
            "dag.membership",
            "dag",
            &format!("unknown verb {}", req.verb),
        );
    }
    if nodes.contains_key(&node_of(&req.verb)) {
        open("dag.membership", "dag", "node exists")
    } else {
        closed(
            "dag.membership",
            "dag",
            &format!("the lattice has no node {}", node_of(&req.verb)),
        )
    }
}

fn wall_parents(nodes: &HashMap<String, LatticeNode>, req: &EdeRequest) -> AdmitWall {
    let node = match nodes.get(&node_of(&req.verb)) {
        Some(n) => n,
        None => return open("dag.parents", "dag", "membership wall covers miss"),
    };
    let missing: Vec<&str> = node
        .parents
        .iter()
        .filter(|p| !req.satisfied.contains(*p))
        .map(|s| s.as_str())
        .collect();
    if missing.is_empty() {
        open("dag.parents", "dag", "parents satisfied")
    } else {
        closed(
            "dag.parents",
            "dag",
            &format!("missing parents {}", missing.join(",")),
        )
    }
}

fn wall_state(req: &EdeRequest) -> AdmitWall {
    let s = req.state.as_str();
    if !STATES.contains(&s) {
        return closed("ede.state", "ede", &format!("unknown state {}", s));
    }
    if s == "promoted" || s == "expired" {
        return closed(
            "ede.state",
            "ede",
            &format!("no verb leaves the state {}", s),
        );
    }
    if s == "none" && req.verb != "seed" {
        return closed("ede.state", "ede", "the draft does not exist");
    }
    if s != "none" && req.verb == "seed" {
        return closed("ede.state", "ede", "a seed makes a new draft");
    }
    open("ede.state", "ede", "state admits the verb")
}

fn wall_time(req: &EdeRequest) -> AdmitWall {
    if req.now == 0 {
        return closed("time.authority", "time", "no clock");
    }
    if req.seeded > req.now || req.scanned > req.now || req.sealed > req.now {
        return closed(
            "time.authority",
            "time",
            "a time of the record lies after now",
        );
    }
    open("time.authority", "time", "time ok")
}

fn wall_bounds(req: &EdeRequest) -> AdmitWall {
    if req.draft_max == 0 || req.scan_max == 0 || req.seal_max == 0 {
        return closed("ede.bounds", "ede", "every age bound must be set");
    }
    open("ede.bounds", "ede", "bounds set")
}

fn wall_draft_age(req: &EdeRequest) -> AdmitWall {
    let bound = matches!(req.verb.as_str(), "refresh" | "scan" | "verify" | "promote");
    if bound && req.seeded > 0 && req.now.saturating_sub(req.seeded) > req.draft_max {
        return closed(
            "ede.draft_age",
            "ede",
            &format!(
                "the draft is {} s old and its bound is {} s: seed a new draft",
                req.now.saturating_sub(req.seeded),
                req.draft_max
            ),
        );
    }
    open("ede.draft_age", "ede", "draft inside its bound")
}

fn wall_scan_age(req: &EdeRequest) -> AdmitWall {
    if req.verb != "promote" {
        return open("ede.scan_age", "ede", "only promote reads the scan");
    }
    if req.scanned == 0 {
        return closed("ede.scan_age", "ede", "promote needs a scan");
    }
    if req.now.saturating_sub(req.scanned) > req.scan_max {
        return closed(
            "ede.scan_age",
            "ede",
            &format!(
                "the scan is {} s old and its bound is {} s: scan again",
                req.now.saturating_sub(req.scanned),
                req.scan_max
            ),
        );
    }
    open("ede.scan_age", "ede", "scan inside its bound")
}

fn wall_seal_age(req: &EdeRequest) -> AdmitWall {
    if req.verb != "promote" || req.sealed == 0 {
        return open("ede.seal_age", "ede", "no CI seal to bound");
    }
    if req.now.saturating_sub(req.sealed) > req.seal_max {
        return closed(
            "ede.seal_age",
            "ede",
            &format!(
                "the CI seal is {} s old and its bound is {} s: verify again",
                req.now.saturating_sub(req.sealed),
                req.seal_max
            ),
        );
    }
    open("ede.seal_age", "ede", "seal inside its bound")
}

/// The EDE wall: every wall collected, then AND.
pub fn ede_wall(nodes: &HashMap<String, LatticeNode>, req: &EdeRequest) -> AdmitResult {
    let mut walls = vec![
        wall_membership(nodes, req),
        wall_parents(nodes, req),
        wall_state(req),
        wall_time(req),
        wall_bounds(req),
        wall_draft_age(req),
        wall_scan_age(req),
        wall_seal_age(req),
    ];
    walls.sort_by(|a, b| a.id.cmp(&b.id));
    AdmitResult::from_walls(&walls)
}

/// The answer of the command line: one verdict line and one line per wall.
pub fn render(result: &AdmitResult) -> String {
    let mut s = format!("verdict: {}\n", if result.allow { "allow" } else { "deny" });
    for w in result.closed.iter().chain(result.open.iter()) {
        s.push_str(&format!(
            "wall: {} {} {}\n",
            w.id,
            if w.closed { "closed" } else { "open" },
            w.reason
        ));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::load_lattice_yaml;

    fn lattice() -> HashMap<String, LatticeNode> {
        let text = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../registries/aep-lattice.yaml"
        ))
        .unwrap_or_default();
        load_lattice_yaml(&text).unwrap_or_default()
    }

    fn req(verb: &str, state: &str, sat: &[&str]) -> EdeRequest {
        EdeRequest {
            verb: verb.into(),
            state: state.into(),
            satisfied: sat.iter().map(|s| s.to_string()).collect(),
            now: 10_000,
            seeded: 9_000,
            scanned: 9_500,
            sealed: 9_600,
            draft_max: 5_000,
            scan_max: 1_000,
            seal_max: 1_000,
        }
    }

    fn closed_ids(r: &AdmitResult) -> Vec<String> {
        let mut ids: Vec<String> = r.closed.iter().map(|w| w.id.clone()).collect();
        ids.sort();
        ids
    }

    #[test]
    fn the_shipped_lattice_holds_the_lifecycle() {
        let nodes = lattice();
        for v in VERBS {
            assert!(nodes.contains_key(&node_of(v)), "{}", v);
        }
        let mut promote = nodes[&node_of("promote")].parents.clone();
        promote.sort();
        assert_eq!(
            promote,
            vec!["ede.scan".to_string(), "ede.verify".to_string()]
        );
    }

    #[test]
    fn promote_needs_scan_and_verify() {
        let nodes = lattice();
        let mut seed = req("seed", "none", &[]);
        seed.seeded = 0;
        seed.scanned = 0;
        seed.sealed = 0;
        assert!(ede_wall(&nodes, &seed).allow);
        assert!(ede_wall(&nodes, &req("scan", "seeded", &["ede.seed"])).allow);
        let r = ede_wall(
            &nodes,
            &req("promote", "scanned", &["ede.seed", "ede.scan"]),
        );
        assert!(!r.allow);
        assert_eq!(closed_ids(&r), vec!["dag.parents"]);
        assert!(
            ede_wall(
                &nodes,
                &req(
                    "promote",
                    "scanned",
                    &["ede.seed", "ede.scan", "ede.verify"]
                )
            )
            .allow
        );
        let mut before = req("promote", "seeded", &["ede.seed", "ede.verify"]);
        before.scanned = 0;
        let r = ede_wall(&nodes, &before);
        assert_eq!(
            closed_ids(&r),
            vec!["dag.parents", "ede.scan_age"],
            "an EDE promote before its scan"
        );
    }

    #[test]
    fn age_bounds_close_the_verbs_they_govern() {
        let nodes = lattice();
        let all = ["ede.seed", "ede.scan", "ede.verify"];
        let mut old_scan = req("promote", "scanned", &all);
        old_scan.scanned = 8_000;
        assert_eq!(
            closed_ids(&ede_wall(&nodes, &old_scan)),
            vec!["ede.scan_age"]
        );
        let mut old_seal = req("promote", "scanned", &all);
        old_seal.sealed = 8_000;
        assert_eq!(
            closed_ids(&ede_wall(&nodes, &old_seal)),
            vec!["ede.seal_age"]
        );
        let mut old_draft = req("scan", "seeded", &all);
        old_draft.seeded = 1_000;
        assert_eq!(
            closed_ids(&ede_wall(&nodes, &old_draft)),
            vec!["ede.draft_age"]
        );
        // Expire remains open for an old draft, so the sweep can end it.
        let mut expire = req("expire", "seeded", &["ede.seed"]);
        expire.seeded = 1_000;
        assert!(ede_wall(&nodes, &expire).allow);
        let mut unbounded = req("scan", "seeded", &["ede.seed"]);
        unbounded.draft_max = 0;
        assert_eq!(
            closed_ids(&ede_wall(&nodes, &unbounded)),
            vec!["ede.bounds", "ede.draft_age"]
        );
    }

    #[test]
    fn terminal_states_unknown_verbs_and_a_missing_lattice_close_the_wall() {
        let nodes = lattice();
        let all = ["ede.seed", "ede.scan", "ede.verify", "ede.promote"];
        for s in ["promoted", "expired"] {
            for v in VERBS {
                assert!(!ede_wall(&nodes, &req(v, s, &all)).allow, "{} on {}", v, s);
            }
        }
        assert!(!ede_wall(&nodes, &req("scan", "none", &[])).allow);
        assert!(!ede_wall(&nodes, &req("seed", "seeded", &["ede.seed"])).allow);
        assert!(!ede_wall(&nodes, &req("push", "seeded", &["ede.seed"])).allow);
        assert!(!ede_wall(&nodes, &req("scan", "bogus", &["ede.seed"])).allow);
        assert!(!ede_wall(&HashMap::new(), &req("scan", "seeded", &["ede.seed"])).allow);
        let mut future = req("scan", "seeded", &["ede.seed"]);
        future.seeded = 20_000;
        assert_eq!(
            closed_ids(&ede_wall(&nodes, &future)),
            vec!["time.authority"]
        );
        let rendered = render(&ede_wall(&nodes, &req("scan", "promoted", &all)));
        assert!(
            rendered.starts_with("verdict: deny\n")
                && rendered.contains("wall: ede.state closed no verb leaves the state promoted"),
            "{}",
            rendered
        );
    }
}
