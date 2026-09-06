//! Derived 15-row ledger types. Not live evaluation.
//! Live path is Admit collect-all then Apply.
//! run_meet is parked off this SDK. Derived ledger lives in aep-evaluation-chain.
//! @PAD: aep28-eval-chain-rust-meet-v1
//! @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c

pub use aep_evaluation_chain::{
    closed_set_key, meet, meet_named, ledger_from_open_flags, MeetResult, Wall,
    CHAIN_STEP_COUNT, STEP_NAMES,
};
