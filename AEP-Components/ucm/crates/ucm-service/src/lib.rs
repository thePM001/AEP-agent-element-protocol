//! AEP UCM service library: the engine operations, HTTP API, MCP server, receipt store and
//! optional System-1 ranker behind the aep-ucm binary.

#![forbid(unsafe_code)]

pub mod engine;
pub mod http;
pub mod mcp;
pub mod ranker;
pub mod store;
