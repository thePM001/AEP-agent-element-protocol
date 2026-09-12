//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use crate::error::PredicateError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PredicateProfile {
    PerimeterV1,
    Paper005Vsa,
}

pub fn parse_profile(raw: Option<&str>) -> Result<PredicateProfile, PredicateError> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(PredicateProfile::PerimeterV1),
        Some("perimeter-v1") => Ok(PredicateProfile::PerimeterV1),
        Some("paper005-vsa") => Ok(PredicateProfile::Paper005Vsa),
        Some(other) => Err(PredicateError::UnknownProfile(other.to_string())),
    }
}
