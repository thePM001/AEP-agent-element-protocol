//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use crate::error::PredicateError;

#[derive(Debug, Clone, Copy)]
pub struct WireLimits {
    pub ingest_default_bytes: usize,
    pub ingest_hard_bytes: usize,
    pub egress_default_bytes: usize,
    pub validate_timeout_ms: u64,
    pub dock_timeout_ms: u64,
    pub egress_connect_ms: u64,
    pub egress_total_ms: u64,
    pub journal_max_bytes: usize,
}

impl Default for WireLimits {
    fn default() -> Self {
        Self {
            ingest_default_bytes: 262144,
            ingest_hard_bytes: 2097152,
            egress_default_bytes: 1048576,
            validate_timeout_ms: 2000,
            dock_timeout_ms: 5000,
            egress_connect_ms: 5000,
            egress_total_ms: 15000,
            journal_max_bytes: 33554432,
        }
    }
}

pub fn reject_over_cap(len: usize, limits: WireLimits) -> Result<(), PredicateError> {
    if len > limits.ingest_hard_bytes {
        return Err(PredicateError::BodyHardCap { len, cap: limits.ingest_hard_bytes });
    }
    if len > limits.ingest_default_bytes {
        return Err(PredicateError::BodyDefaultCap { len, cap: limits.ingest_default_bytes });
    }
    Ok(())
}
