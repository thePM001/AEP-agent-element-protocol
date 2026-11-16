//! Policy engine of the CAW of AEP.
//!
//! The sandbox is the policy. This crate turns one resolved profile record of the GAP
//! compiler into a sandbox plan: the mounts, the programs and the routes of one gVisor
//! sandbox. A rule that a sandbox cannot express is refused with its name. Nothing is
//! weakened in silence.
//!
//! The crate does no I/O. It reads no file, opens no socket and starts no program, so
//! every decision is a pure function of the record and the variables of the call.
//!
//! - [`record`] parses the record and checks its sha256 digest.
//! - [`plan`] compiles the record into a [`plan::SandboxPlan`] or refuses it.
//! - [`route`] judges one outbound request against the routes of a plan.
//! - [`classify`] turns observed failures of a sandbox into deny events.

pub mod canonical;
pub mod classify;
pub mod error;
pub mod plan;
pub mod record;
pub mod route;

pub use error::PolicyError;

/// Folder trees that belong to the root file system the CAW builds for a sandbox.
/// No profile mounts a host folder over them. A missing file below them is a plain
/// missing file and no refusal of the policy.
pub const ROOT_TREES: [&str; 16] = [
    "/bin",
    "/dev",
    "/etc",
    "/lib",
    "/lib32",
    "/lib64",
    "/libx32",
    "/proc",
    "/run",
    "/sbin",
    "/sys",
    "/tmp",
    "/usr",
    "/var/cache",
    "/var/db",
    "/var/run",
];

/// True when `path` is `tree` or lies below it. Both are absolute and normalized.
pub fn is_under(path: &str, tree: &str) -> bool {
    if tree == "/" {
        return path.starts_with('/');
    }
    path == tree
        || (path.len() > tree.len()
            && path.starts_with(tree)
            && path.as_bytes()[tree.len()] == b'/')
}

/// True when `path` lies in the root file system of the sandbox.
pub fn in_root_trees(path: &str) -> bool {
    ROOT_TREES.iter().any(|tree| is_under(path, tree))
}
