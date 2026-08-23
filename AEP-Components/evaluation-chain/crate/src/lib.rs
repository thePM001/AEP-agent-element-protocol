//! AEP 2.8 evaluation chain as a meet of 15 walls.
//! Live admit is collect-all AND. Ledger is a derived view. No skip.
//! @PAD: aep28-eval-chain-rust-meet-v1
//! @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c

use serde::{Deserialize, Serialize};

pub const CHAIN_STEP_COUNT: usize = 15;

pub const STEP_NAMES: [&str; CHAIN_STEP_COUNT] = [
    "task_scope",
    "session_state",
    "ring_capability",
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeetResult {
    pub allow: bool,
    pub closed: Vec<Wall>,
    pub open_walls: Vec<Wall>,
    pub ledger: Vec<Wall>,
}

pub fn closed_set_key(closed: &[Wall]) -> String {
    let mut names: Vec<String> = closed.iter().map(|w| w.name.clone()).collect();
    names.sort();
    names.join("|")
}

pub fn meet(mut walls: Vec<Wall>) -> Result<MeetResult, String> {
    if walls.len() != CHAIN_STEP_COUNT {
        return Err(format!(
            "chain requires exactly {} walls, got {}",
            CHAIN_STEP_COUNT,
            walls.len()
        ));
    }
    walls.sort_by_key(|w| w.step);
    for (i, w) in walls.iter().enumerate() {
        if w.step != i {
            return Err(String::from("wall steps must be 0 through 14 with no gaps"));
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
    Ok(MeetResult {
        allow: closed.is_empty(),
        closed,
        open_walls,
        ledger: walls,
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(err.contains("exactly 15"));
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
}
