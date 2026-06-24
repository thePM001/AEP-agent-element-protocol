//! AEP Universal Connect Bridge (UCB) - Rust implementation.
//!
//! - **Ingress**: foreign HTTP/MCP agents → lattice (identity + task manifest gate)
//! - **Egress**: credential injection + HTTP/MCP ACL to external APIs (Airlock patterns)
//! - **Manifest resolution** (optional): caller-provided manifest or configured synthesis tiers only

pub mod auth;
pub mod bridge;
pub mod config;
pub mod delegate;
pub mod egress;
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

pub const UCB_VERSION: &str = "2.8.0";
pub const BRIDGE_ID: &str = "ucb/2.8.0";