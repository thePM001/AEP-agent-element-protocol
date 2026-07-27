//! Lattice Memory for AEP 2.8: dual-store attractor index.
//!
//! - **sqlite-vec** (`vec0`): durable vector + metadata in the Base Node SQLite file
//! - **USearch**: in-memory HNSW fast-path for sub-millisecond similarity queries

mod entry;
mod error;
mod sqlite;
mod store;

pub use entry::{
    MemoryCountRequest, MemoryEntryJson, MemoryHistoryRequest, MemoryMatchJson, MemorySearchRequest,
};
pub use error::MemoryError;
pub use store::{
    AttractorMatch, AttractorRecord, LatticeMemoryStore, DEFAULT_EMBEDDING_DIM,
    DEFAULT_SIMILARITY_THRESHOLD, MAX_ATTRACTORS,
};