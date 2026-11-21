//! Errors of the core. Every refusal names what was expected and what arrived.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CoreError {
    /// An operator embedding whose length is not the dimension of the store.
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch { expected: usize, got: usize },
    /// An operator embedding arrived while the store holds no embedding dimension.
    #[error("operator embeddings are off: the store holds no embedding dimension")]
    EmbeddingsOff,
    /// An operator embedding holds a value that is not a finite number.
    #[error("embedding value at index {index} is not finite")]
    NotFinite { index: usize },
    /// An operator embedding of length zero in every direction cannot be normalized.
    #[error("embedding has zero norm")]
    ZeroNorm,
    /// A fingerprint of one kind arrived in a domain that holds the other kind.
    #[error(
        "fingerprint kind mismatch in domain {domain}: the domain holds {expected}, got {got}"
    )]
    KindMismatch {
        domain: String,
        expected: &'static str,
        got: &'static str,
    },
    /// A timestamp that is neither unix time nor ISO 8601.
    #[error("timestamp is neither unix time nor ISO 8601: {0}")]
    Timestamp(String),
    /// A field outside its bounds.
    #[error("invalid {field}: {reason}")]
    Invalid { field: &'static str, reason: String },
}

impl CoreError {
    pub(crate) fn invalid(field: &'static str, reason: impl Into<String>) -> Self {
        CoreError::Invalid {
            field,
            reason: reason.into(),
        }
    }
}
