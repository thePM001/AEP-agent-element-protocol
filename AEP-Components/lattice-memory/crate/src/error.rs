//! Errors of the store.

use aep_lattice_memory_core::CoreError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MemoryError {
    /// A record or a setting the core refuses, such as an embedding of the wrong dimension.
    #[error("{0}")]
    Core(#[from] CoreError),
    /// The store was made with other settings than the caller asks for.
    #[error("store setting {name} is {stored}, the caller asks for {asked}")]
    ConfigMismatch {
        name: &'static str,
        stored: String,
        asked: String,
    },
    /// The folder is not a Lattice Memory store of a version this code reads.
    #[error("format: {0}")]
    Format(String),
    /// A log or its attractors do not hold together.
    #[error("store is not consistent: {0}")]
    Corrupt(String),
    /// A write on a store that was opened to read.
    #[error("the store is open read-only")]
    ReadOnly,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A lock of the attractors was poisoned by a thread that ended in a panic.
    #[error("the attractor lock is poisoned")]
    Poisoned,
    /// A failure a test put into a write to prove the write is atomic.
    #[cfg(test)]
    #[error("injected failure at {0}")]
    Injected(&'static str),
}
