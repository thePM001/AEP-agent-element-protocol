// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! AEP 2.8.6 Universal Connect Bridge (UCB).
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
pub mod inference;
pub mod http;
pub mod identity;
pub mod ingress;
pub mod journal;
pub mod lattice;
pub mod manifest;
pub mod mcp;
pub mod store;
pub mod translator;

pub const UCB_VERSION: &str = "2.8.6";
pub const BRIDGE_ID: &str = "ucb/2.8.6";
pub const DOCK_WIRE_SCORE: u16 = 0;
