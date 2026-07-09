// @GCDE: document_sha256=adbe8ae74f5743a0fcebd766a08c82efcba7bbcf274e6d50d4a5f00dbb1aa8c0
use thiserror::Error;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid registry: {0}")]
    Invalid(String),
    #[error("node not found: {0}")]
    NotFound(String),
    #[error("node already exists: {0}")]
    AlreadyExists(String),
}

pub type Result<T> = std::result::Result<T, RegistryError>;