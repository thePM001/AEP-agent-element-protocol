//! Lattice Memory of AEP 2.9: the store.
//!
//! Lattice Memory keeps what the Admit Gate judged. Every judged proposal is one
//! record in an append-only log with a hash chain. Accepted records form attractors
//! with support counts. The computing part is the crate `aep-lattice-memory-core`.
//! This crate adds the backends behind one trait:
//!
//! - [`InMemoryBackend`] for development and tests
//! - [`LogBackend`] for production: one log file per domain in one folder
//!
//! No backend has an operation that changes or removes a record. No database engine
//! and no query language is involved, and neither crate has a C or C++ dependency.
//!
//! A stored shape is evidence for a later reader. It is never a permission.

mod error;
mod logstore;
mod memory;
mod model;
pub mod wire;

pub use aep_lattice_memory_core as core;
pub use aep_lattice_memory_core::{
    CoreConfig, CoreError, Fingerprint, FrameContext, LogEntry, Outcome, Plan, ProposalShape,
    QuantizedEmbedding, RouteHint, SimHash,
};
pub use error::MemoryError;
pub use logstore::{
    LogBackend, OpenOptionsLog, FORMAT_VERSION, LOG_SUFFIX, META_FILE, SNAPSHOT_EVERY,
    SNAPSHOT_SUFFIX,
};
pub use memory::InMemoryBackend;
pub use model::{
    is_judged_domain, Counts, DomainCounts, DomainVerify, HintReader, Match, MemoryBackend,
    MemoryHealth, NewRecord, Receipt, StoredRecord, VerifyReport, JUDGED_DOMAIN,
};
