//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use crate::scanner::ScannerId;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PredicateError {
    #[error("unknown predicate profile {0}")]
    UnknownProfile(String),
    #[error("paper005-vsa is off unless named and a hypervector binding is installed")]
    Paper005Off,
    #[error("P_P provenance missing or digest mismatch")]
    Provenance,
    #[error("P_S payload empty or content-type refused")]
    Structural,
    #[error("P_C scanner {0:?}")]
    Scanner(ScannerId),
    #[error("P_R replay window duplicate")]
    Replay,
    #[error("body {len} over default cap {cap}")]
    BodyDefaultCap { len: usize, cap: usize },
    #[error("body {len} over hard cap {cap}")]
    BodyHardCap { len: usize, cap: usize },
}
