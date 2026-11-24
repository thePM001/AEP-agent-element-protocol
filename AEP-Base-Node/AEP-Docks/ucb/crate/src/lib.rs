//! AEP 2.9 Universal Connect Bridge (UCB).
//!
//! UCB is an attach gateway. It is not a second evaluator. Base Node is the
//! only live evaluator. Public capabilities are ingest, delegate, health, rollback, egress and
//! compile-manifest. A task manifest is mandatory. Synthesis is refused. Trust fields
//! are refused. Foreign frameworks are fixtures not protocol members.
//! DenyReport uses the same shape as the kernel. The local compiler is gap-manifest-v1.

pub mod auth;
pub mod bridge;
pub mod config;
pub mod delegate;
pub mod egress;
pub mod gap_manifest;
pub mod http;
pub mod identity;
pub mod inference;
pub mod ingress;
pub mod journal;
pub mod lattice;
pub mod manifest;
pub mod mcp;
pub mod sandbox;
pub mod store;
#[cfg(all(test, unix))]
#[allow(clippy::expect_used, clippy::unwrap_used)] // fixture code: a failed expect is a failed test
pub(crate) mod test_support;
pub mod translator;
pub mod validate_process;

pub const UCB_VERSION: &str = "2.9";
pub const BRIDGE_ID: &str = "ucb/2.9";
