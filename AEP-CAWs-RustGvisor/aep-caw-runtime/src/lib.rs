//! Runtime of the CAW of AEP.
//!
//! The CAW runs every agent command in its own gVisor sandbox. This crate grows with
//! the work packages of the Rust CAW. Today it holds the trace part: the wire format of
//! the gVisor `remote` trace sink and a listener for it. The events of that sink are
//! the source of the deny events of the CAW.

pub mod trace;
pub mod trace_listener;
