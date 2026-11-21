//! Lattice Memory core of AEP 2.9.
//!
//! This crate is the part of Lattice Memory that computes. It reads no file, opens no
//! socket and holds no clock. It has no C and no C++ dependency and builds for
//! `wasm32-wasip2`. Scores are integers, so every target gives the same score for the
//! same input.
//!
//! - `shape`: the canonical shape of a proposal and its SHA-256 digest
//! - `fingerprint`: the 256 bit SimHash and operator embeddings quantized to bytes
//! - `index`: the attractors of one domain in contiguous arrays with an exact scan
//! - `attractor`: support counts, eviction and the route hint
//! - `memo`: the exact-match memo for checks that are pure
//! - `chain`: the hash chain of the record log
//! - `time`: timestamps as unix seconds
//!
//! A stored shape is evidence for a later reader. It is never a permission. The route
//! hint schedules work and the memo replays the rows of a pure check for byte
//! identical input. Neither turns a deny into an allow and similarity alone never
//! skips a wall.

pub mod attractor;
pub mod chain;
pub mod error;
pub mod fingerprint;
pub mod index;
pub mod memo;
pub mod shape;
pub mod time;

pub use attractor::{
    check_domain, CoreConfig, MemoryCore, Observation, Plan, RouteHint,
    DEFAULT_CAPACITY_PER_DOMAIN, DEFAULT_EMBEDDING_MIN_SCORE, DEFAULT_SIMHASH_MIN_SCORE,
    MAX_DOMAIN_LEN,
};
pub use chain::{
    canonical_labels, check_id, entry_hash, genesis_hash, parse_labels, LogEntry, Outcome,
    MAX_BODY_BYTES, MAX_ENTRY_BYTES,
};
pub use error::CoreError;
pub use fingerprint::{
    Fingerprint, FingerprintKind, QuantizedEmbedding, SimHash, EMBEDDING_MAX_SCORE,
    MAX_EMBEDDING_DIM, SIMHASH_BITS, SIMHASH_MAX_SCORE,
};
pub use index::{Attractor, DomainIndex, Hit};
pub use memo::{ExactMemo, MemoKey, WallRow, DEFAULT_MEMO_CAPACITY};
pub use shape::{
    canonical_json, sha256, FrameContext, ProposalShape, MAX_SHAPE_TOKENS, SHAPE_EVENT_FIELDS,
    SHAPE_FRAME_FIELDS, SHAPE_LEFT_OUT,
};
pub use time::{format_unix_iso, parse_timestamp_unix};
