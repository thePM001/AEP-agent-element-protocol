//! Evaluation chain meet. All 15 walls. Collect-all. No skip.
//! @PAD: aep28-eval-chain-rust-meet-v1
//! @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c

pub use aep_evaluation_chain::{
    closed_set_key, meet, meet_named, run_meet_ledger, MeetResult, Wall, CHAIN_STEP_COUNT,
    STEP_NAMES,
};

use aep_evaluation_chain::run_meet_ledger as meet_ledger;

#[derive(Debug, Clone)]
pub struct StepResult {
    pub step: usize,
    pub name: String,
    pub verdict: String,
    pub reason: String,
    pub duration_us: u128,
}

pub struct ChainResult {
    pub verdict: String,
    pub rejection_step: Option<usize>,
    pub ledger: Vec<StepResult>,
    pub total_duration_us: u128,
}

pub fn run_meet(names: &[&str], fail_at: &[usize]) -> ChainResult {
    let m = meet_ledger(names, fail_at);
    let mut ledger = Vec::new();
    let mut rejection_step = None;
    for w in &m.ledger {
        let verdict = if w.open {
            String::from("pass")
        } else {
            if rejection_step.is_none() {
                rejection_step = Some(w.step);
            }
            String::from("reject")
        };
        ledger.push(StepResult {
            step: w.step,
            name: w.name.clone(),
            verdict,
            reason: w.reason.clone(),
            duration_us: 0,
        });
    }
    ChainResult {
        verdict: if m.allow {
            String::from("pass")
        } else {
            String::from("reject")
        },
        rejection_step,
        ledger,
        total_duration_us: 0,
    }
}

/// Old name kept as a call to meet. Remaining steps are not skipped.
pub fn run_sequential(names: &[&str], fail_at: Option<usize>) -> ChainResult {
    let fails = match fail_at {
        Some(s) => vec![s],
        None => Vec::new(),
    };
    run_meet(names, &fails)
}
