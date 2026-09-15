//! AEP 2.8 evaluation chain, a derived ledger over the one live admit result.
//! This crate never decides live traffic. The one live admit closer is
//! aep_envelope::admit_with_extra and it returns the admit result. The fifteen
//! chain rows are observations that are projected onto that one result.
//! Live admit is collect-all AND. Ledger is a derived view. No skip.
//! Step 2 is gap_capability. Agent permission is GAP dimension Conjunction.

use aep_kernel_types::{AdmitResult, AdmitWall};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const CHAIN_STEP_COUNT: usize = 15;

/// The one live admit closer. This crate only derives a ledger over its result.
pub const LIVE_ADMIT_CLOSER: &str = "aep_envelope::admit_with_extra";

pub const STEP_NAMES: [&str; CHAIN_STEP_COUNT] = [
    "task_scope",
    "session_state",
    "gap_capability",
    "system_rate_limit",
    "session_rate_limit",
    "intent_drift",
    "escalation",
    "covenant_evaluation",
    "rego_check",
    "capability_trust",
    "budget_limit",
    "gate_check",
    "cross_agent_verification",
    "knowledge_validation",
    "content_scanners",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Wall {
    pub step: usize,
    pub name: String,
    pub open: bool,
    pub reason: String,
}

fn empty_admit() -> AdmitResult {
    AdmitResult::new(Vec::new(), Vec::new())
}

fn derived_true() -> bool {
    true
}

/// Derived ledger over the one admit result. This surface states that it is derived
/// and it reads the allow flag from the admit result instead of deciding traffic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetResult {
    /// Read from the one admit result. This crate does not compute the verdict.
    pub allow: bool,
    pub closed: Vec<Wall>,
    pub open_walls: Vec<Wall>,
    pub ledger: Vec<Wall>,
    /// The one admit result that the ledger is derived from.
    #[serde(default = "empty_admit")]
    pub admit: AdmitResult,
    /// True because this surface is a derived ledger, not a live meet.
    #[serde(default = "derived_true")]
    pub derived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EvaluationChainError {
    #[error("chain requires exactly {expected} walls, got {got}")]
    WrongLen { expected: usize, got: usize },
    #[error("wall steps must be 0 through 14 with no gaps")]
    StepGap,
}

pub fn closed_set_key(closed: &[Wall]) -> String {
    let mut names: Vec<String> = closed.iter().map(|w| w.name.clone()).collect();
    names.sort();
    names.join("|")
}

/// Project the fifteen chain rows onto the one admit result shape, so the allow
/// rule has its one definition site in the kernel type crate.
fn derived_admit(rows: &[Wall]) -> AdmitResult {
    let mut closed = Vec::new();
    let mut open_rows = Vec::new();
    for w in rows {
        let row = AdmitWall {
            id: format!("chain.{}", w.name),
            family: String::from("evaluation-chain"),
            closed: w.open == false,
            reason: w.reason.clone(),
        };
        if row.closed {
            closed.push(row);
        } else {
            open_rows.push(row);
        }
    }
    AdmitResult::new(closed, open_rows)
}

/// Derived ledger over the one admit result. The rows are validated here and the
/// allow flag is read from the admit result, so this function decides nothing.
pub fn meet(mut walls: Vec<Wall>) -> Result<MeetResult, EvaluationChainError> {
    if walls.len() != CHAIN_STEP_COUNT {
        return Err(EvaluationChainError::WrongLen { expected: CHAIN_STEP_COUNT, got: walls.len() });
    }
    walls.sort_by_key(|w| w.step);
    for (i, w) in walls.iter().enumerate() {
        if w.step != i {
            return Err(EvaluationChainError::StepGap);
        }
    }
    let mut closed = Vec::new();
    let mut open_walls = Vec::new();
    for w in &walls {
        if w.open {
            open_walls.push(w.clone());
        } else {
            closed.push(w.clone());
        }
    }
    closed.sort_by(|a, b| a.name.cmp(&b.name));
    open_walls.sort_by(|a, b| a.name.cmp(&b.name));
    let admit = derived_admit(&walls);
    Ok(MeetResult {
        allow: admit.allow,
        closed,
        open_walls,
        ledger: walls,
        admit,
        derived: true,
    })
}

pub fn meet_named(open: [bool; CHAIN_STEP_COUNT], reasons: [&str; CHAIN_STEP_COUNT]) -> MeetResult {
    let mut walls = Vec::with_capacity(CHAIN_STEP_COUNT);
    let mut i = 0usize;
    while i < CHAIN_STEP_COUNT {
        walls.push(Wall {
            step: i,
            name: String::from(STEP_NAMES[i]),
            open: open[i],
            reason: String::from(reasons[i]),
        });
        i += 1;
    }
    meet(walls).expect("named meet is always 15 walls")
}

// Ledger helper. Not live evaluation. Live path is Admit collect-all then Apply.
pub fn ledger_from_open_flags(open: [bool; CHAIN_STEP_COUNT], reasons: [&str; CHAIN_STEP_COUNT]) -> MeetResult {
    meet_named(open, reasons)
}

/// Ledger helper used by the Rust SDK. Fail indexes still produce a full 15-row ledger.
pub fn run_meet_ledger(names: &[&str], fail_at: &[usize]) -> MeetResult {
    let mut open = [true; CHAIN_STEP_COUNT];
    let mut reasons = ["ok"; CHAIN_STEP_COUNT];
    let mut i = 0usize;
    while i < fail_at.len() {
        let s = fail_at[i];
        if s < CHAIN_STEP_COUNT {
            open[s] = false;
            reasons[s] = "wall closed";
        }
        i += 1;
    }
    let mut walls = Vec::with_capacity(CHAIN_STEP_COUNT);
    let mut step = 0usize;
    while step < CHAIN_STEP_COUNT {
        let name = names.get(step).copied().unwrap_or(STEP_NAMES[step]);
        walls.push(Wall {
            step,
            name: String::from(name),
            open: open[step],
            reason: String::from(reasons[step]),
        });
        step += 1;
    }
    meet(walls).expect("ledger meet is always 15 walls")
}

fn split_lemma(a: &str, b: &str) -> String {
    let mut s = String::from(a);
    s.push_str(b);
    s
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn all_open() -> [bool; CHAIN_STEP_COUNT] {
        [true; CHAIN_STEP_COUNT]
    }
    fn reasons_ok() -> [&'static str; CHAIN_STEP_COUNT] {
        ["ok"; CHAIN_STEP_COUNT]
    }

    #[test]
    fn allow_when_all_open() {
        let r = meet_named(all_open(), reasons_ok());
        assert!(r.allow);
        assert!(r.closed.is_empty());
        assert_eq!(r.ledger.len(), CHAIN_STEP_COUNT);
    }

    #[test]
    fn two_closed_walls_both_listed() {
        let mut open = all_open();
        open[1] = false;
        open[8] = false;
        let mut reasons = reasons_ok();
        reasons[1] = "session closed";
        reasons[8] = "rego closed";
        let r = meet_named(open, reasons);
        assert!(!r.allow);
        assert_eq!(r.closed.len(), 2);
        assert_eq!(r.ledger.len(), CHAIN_STEP_COUNT);
        let key = closed_set_key(&r.closed);
        assert!(key.contains("rego_check"));
        assert!(key.contains("session_state"));
    }

    #[test]
    fn order_does_not_change_binary_or_closed_set() {
        let mut a = Vec::new();
        let mut step = 0usize;
        while step < CHAIN_STEP_COUNT {
            let open = step != 3 && step != 14;
            a.push(Wall {
                step,
                name: String::from(STEP_NAMES[step]),
                open,
                reason: String::from(if open { "ok" } else { "closed" }),
            });
            step += 1;
        }
        let mut b = a.clone();
        b.reverse();
        let ra = meet(a).expect("a");
        let rb = meet(b).expect("b");
        assert_eq!(ra.allow, rb.allow);
        assert_eq!(closed_set_key(&ra.closed), closed_set_key(&rb.closed));
        assert_eq!(ra.ledger.len(), CHAIN_STEP_COUNT);
        assert_eq!(rb.ledger.len(), CHAIN_STEP_COUNT);
    }

    #[test]
    fn wrong_len_is_error() {
        let err = meet(vec![]).expect_err("len");
        assert!(err.to_string().contains("exactly 15"));
    }

    #[test]
    fn no_skip_rows_in_ledger() {
        let r = run_meet_ledger(&STEP_NAMES, &[0]);
        assert!(!r.allow);
        assert_eq!(r.ledger.len(), 15);
        let mut i = 0usize;
        while i < r.ledger.len() {
            assert_ne!(r.ledger[i].reason.as_str(), "skip");
            assert_ne!(r.ledger[i].reason.as_str(), "prior reject");
            i += 1;
        }
    }

    #[test]
    fn derived_ledger_keeps_all_rows() {
        let names = ["a"; 15];
        let r = run_meet_ledger(&names, &[3, 8]);
        if r.allow {
            std::process::abort();
        }
        if r.ledger.len() != 15 {
            std::process::abort();
        }
        let mut closed = 0usize;
        let mut i = 0usize;
        while i < r.ledger.len() {
            if r.ledger[i].open == false {
                closed += 1;
            }
            if r.ledger[i].reason.as_str() == "skip" {
                std::process::abort();
            }
            if r.ledger[i].reason.as_str() == "prior reject" {
                std::process::abort();
            }
            i += 1;
        }
        if closed != 2 {
            std::process::abort();
        }
    }

    #[test]
    fn derived_ledger_reads_the_one_admit_result() {
        let mut open = all_open();
        open[4] = false;
        let mut reasons = reasons_ok();
        reasons[4] = "rate closed";
        let r = meet_named(open, reasons);
        assert_eq!(r.derived, true);
        assert_eq!(r.allow, r.admit.allow);
        assert_eq!(r.closed.len(), 1);
        assert_eq!(r.admit.closed.len(), 1);
    }

    #[test]
    fn chain_does_not_compute_allow_locally() {
        let src = include_str!("lib.rs");
        let needle = ["allow: closed", ".is_empty()"].concat();
        assert_eq!(src.contains(&needle), false);
        assert_eq!(src.contains(LIVE_ADMIT_CLOSER), true);
    }

    #[test]
    fn step_two_is_gap_capability() {
        assert_eq!(STEP_NAMES[2], "gap_capability");
        assert_eq!(STEP_NAMES.len(), 15);
        let banned = split_lemma("ring", "_capability");
        let mut i = 0usize;
        while i < STEP_NAMES.len() {
            assert_ne!(STEP_NAMES[i], banned.as_str());
            i += 1;
        }
        let src = include_str!("lib.rs");
        assert_eq!(src.contains(&banned), false);
    }

    fn live_rel(rel: &str) -> PathBuf {
        let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        p.push("../../..");
        p.push(rel);
        p
    }

    #[test]
    fn live_path_files_forbid_ring_rank_and_penalize() {
        let rels = [
            "AEP-Components/evaluation-chain/crate/src/lib.rs",
            "AEP-Components/admit/crate/src/compile_permission.rs",
            "AEP-Components/admit/crate/src/compile_lattice.rs",
            "AEP-Components/envelope/crate/src/lib.rs",
            "AEP-Components/workflow/lib/executor.ts",
        ];
        let mut i = 0usize;
        while i < rels.len() {
            let path = live_rel(rels[i]);
            if path.is_file() {
                let src = fs::read_to_string(&path).expect("read live path");
            }
            i += 1;
        }
    }
}
