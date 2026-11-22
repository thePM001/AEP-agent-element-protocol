//! Lattice Memory of AEP 2.9: the store.
//!
//! Lattice Memory is the record of what the Admit Gate judged. Every recorded verdict
//! is one record in an append-only log with a hash chain. Accepted records form
//! attractors with support counts. The computing part is the crate
//! `aep-lattice-memory-core`. This crate adds the backends behind one trait:
//!
//! - [`InMemoryBackend`] for development and tests
//! - [`LogBackend`] for production: one log file per domain in one folder
//!
//! No backend has an operation that changes or removes a record. No database engine
//! and no query language is involved, and neither crate has a C or C++ dependency.
//!
//! A stored shape is evidence for a later reader. It is never a permission.

mod error;
mod frames;
mod logstore;
mod memory;
mod model;
mod snapshot;
pub mod wire;

pub use aep_lattice_memory_core as core;
pub use aep_lattice_memory_core::{
    CoreConfig, CoreError, Fingerprint, FrameContext, LogEntry, Outcome, Plan, ProposalShape,
    QuantizedEmbedding, RouteHint, SimHash,
};
pub use error::MemoryError;
pub use frames::FORMAT_VERSION;
pub use logstore::{
    LogBackend, OpenOptionsLog, LOG_SUFFIX, META_FILE, SNAPSHOT_EVERY, SNAPSHOT_SHARE,
};
pub use memory::InMemoryBackend;
pub use model::{
    is_judged_domain, Counts, Cursor, DomainAnchor, DomainCounts, DomainVerify, Match,
    MemoryBackend, MemoryHealth, NewRecord, Page, Receipt, RecordQuery, StoredRecord, VerifyReport,
    DEFAULT_PAGE_BYTES, JUDGED_DOMAIN,
};
pub use snapshot::SNAPSHOT_SUFFIX;
