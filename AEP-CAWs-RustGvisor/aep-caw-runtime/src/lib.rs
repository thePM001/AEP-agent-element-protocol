//! Runtime of the CAW of AEP.
//!
//! The CAW runs every agent command in its own gVisor sandbox. This crate grows with
//! the work packages of the Rust CAW. Its parts today:
//!
//! - [`trace`] and [`trace_listener`]: the wire format of the gVisor `remote` trace
//!   sink and a listener for it. The events of that sink are the source of the deny
//!   events of the CAW.
//! - [`elf`]: reads which loader and which shared libraries a program needs.
//! - [`rootfs`]: pins the programs of a toolset with their libraries and builds the
//!   root folder of a session from the pinned copies.
//! - [`bundle`]: writes the OCI configuration of one command from a sandbox plan.
//! - [`sandbox`]: starts runsc for one command and collects its deny events.
//! - [`session`]: the session folder and the one gate that starts a sandbox.
//! - [`audit`]: the append only audit log of a session with its hash chain.

pub mod audit;
pub mod bundle;
pub mod elf;
pub mod rootfs;
pub mod sandbox;
pub mod session;
pub mod trace;
pub mod trace_listener;
