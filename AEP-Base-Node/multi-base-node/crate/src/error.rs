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