//! The event classifier: from what a sandbox reports to deny events.
//!
//! gVisor reports system calls, not policy decisions. The classifier knows the plan
//! of the sandbox and says which reported failure is a refusal of the policy:
//!
//! - A failed open of a path that the plan does not hold is a deny event. A missing
//!   file inside the root file system or inside a mount is a plain missing file.
//! - A failed open below a mask is a deny event.
//! - A write that a read only mount refused is a deny event.
//! - gVisor reports errno zero on the exit point of `execve` even when no program
//!   was loaded. A denied exec is an exec that was asked for and never loaded. It is
//!   known when the command ends, so [`Classifier::finish`] reports it.
//! - A failed connect to an address other than loopback is a deny event.
//!
//! A program that only asks whether a file exists leaves no event: gVisor has no
//! trace point for stat. One target gives one deny event per process, however often
//! the process tries.

use std::collections::{BTreeMap, BTreeSet};

use crate::in_root_trees;
use crate::plan::{MountMode, SandboxPlan};

const EPERM: i64 = 1;
const EACCES: i64 = 13;
const EROFS: i64 = 30;
const EINPROGRESS: i64 = 115;

const AF_UNIX: u16 = 1;
const AF_INET: u16 = 2;
const AF_INET6: u16 = 10;

/// One thing the trace sink of a sandbox reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Observation {
    /// An open, openat or creat call that failed.
    OpenFailed {
        /// Path argument of the call.
        path: String,
        /// Linux errno.
        errno: i64,
        /// Name of the calling process.
        process: String,
        /// Thread group id of the calling process.
        thread_group: i32,
    },
    /// An execve call was made.
    ExecAsked {
        /// Path argument of the call.
        path: String,
        /// Name of the calling process.
        process: String,
        /// Thread group id of the calling process.
        thread_group: i32,
    },
    /// A program image was loaded. It follows the `ExecAsked` it belongs to.
    ExecLoaded {
        /// Thread group id of the process.
        thread_group: i32,
    },
    /// A connect call that failed.
    ConnectFailed {
        /// Raw socket address of the call.
        address: Vec<u8>,
        /// Linux errno.
        errno: i64,
        /// Name of the calling process.
        process: String,
        /// Thread group id of the calling process.
        thread_group: i32,
    },
}

/// What kind of action the policy refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DenyKind {
    /// A file outside everything the plan holds.
    FileOutside,
    /// A file below a mask.
    FileMasked,
    /// A write below a read only mount.
    FileReadOnly,
    /// A program outside the toolset and outside every mount.
    ExecOutside,
    /// A program below a mask.
    ExecMasked,
    /// A program inside a mount of a profile that runs no workspace programs.
    ExecInMount,
    /// A network destination other than the egress listener.
    Connect,
}

impl DenyKind {
    /// Short name for audit lines.
    pub fn name(self) -> &'static str {
        match self {
            Self::FileOutside => "file-outside",
            Self::FileMasked => "file-masked",
            Self::FileReadOnly => "file-read-only",
            Self::ExecOutside => "exec-outside",
            Self::ExecMasked => "exec-masked",
            Self::ExecInMount => "exec-in-mount",
            Self::Connect => "connect",
        }
    }
}

/// One refusal of the policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DenyEvent {
    /// Kind of the refused action.
    pub kind: DenyKind,
    /// The path or the address the action named.
    pub target: String,
    /// Name of the process that tried.
    pub process: String,
    /// Linux errno the process saw. Zero for an exec, which gVisor reports without one.
    pub errno: i64,
    /// Name of the rule that hides or protects the target. Empty when no rule names it.
    pub rule: String,
}

/// Turns the observations of one sandbox into deny events.
#[derive(Debug)]
pub struct Classifier<'a> {
    plan: &'a SandboxPlan,
    seen: BTreeSet<(DenyKind, String, i32)>,
    asked: BTreeMap<i32, Vec<(String, String)>>,
}

/// A path in plain form: absolute, no empty, `.` or `..` part.
fn is_plain(path: &str) -> bool {
    path.starts_with('/')
        && (path.len() == 1
            || path[1..]
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}

/// Writes a raw socket address as text. `None` for a family the CAW does not judge.
fn address_text(address: &[u8]) -> Option<(u16, String, bool)> {
    let family = u16::from_le_bytes([*address.first()?, *address.get(1)?]);
    match family {
        AF_INET => {
            let port = u16::from_be_bytes([*address.get(2)?, *address.get(3)?]);
            let ip = address.get(4..8)?;
            let text = format!("{}.{}.{}.{}:{port}", ip[0], ip[1], ip[2], ip[3]);
            Some((family, text, ip[0] == 127))
        }
        AF_INET6 => {
            let port = u16::from_be_bytes([*address.get(2)?, *address.get(3)?]);
            let ip = address.get(8..24)?;
            let groups: Vec<String> = ip
                .chunks(2)
                .map(|pair| format!("{:x}", u16::from_be_bytes([pair[0], pair[1]])))
                .collect();
            let loopback = ip[..15].iter().all(|b| *b == 0) && ip[15] == 1;
            Some((family, format!("[{}]:{port}", groups.join(":")), loopback))
        }
        AF_UNIX => {
            let path = address.get(2..)?;
            let end = path.iter().position(|b| *b == 0).unwrap_or(path.len());
            Some((
                family,
                String::from_utf8_lossy(&path[..end]).into_owned(),
                false,
            ))
        }
        _ => None,
    }
}

impl<'a> Classifier<'a> {
    /// A classifier for one sandbox with the given plan.
    pub fn new(plan: &'a SandboxPlan) -> Self {
        Self {
            plan,
            seen: BTreeSet::new(),
            asked: BTreeMap::new(),
        }
    }

    fn once(
        &mut self,
        kind: DenyKind,
        target: &str,
        process: &str,
        thread_group: i32,
        errno: i64,
        rule: &str,
    ) -> Option<DenyEvent> {
        if !self.seen.insert((kind, target.to_string(), thread_group)) {
            return None;
        }
        Some(DenyEvent {
            kind,
            target: target.to_string(),
            process: process.to_string(),
            errno,
            rule: rule.to_string(),
        })
    }

    fn failed_path(
        &mut self,
        path: &str,
        errno: i64,
        process: &str,
        thread_group: i32,
    ) -> Option<DenyEvent> {
        if !is_plain(path) {
            return None;
        }
        let found = self.plan.mount_of(path).map(|m| (m.mode, m.rule.clone()));
        match found {
            Some((MountMode::Mask, rule)) => self.once(
                DenyKind::FileMasked,
                path,
                process,
                thread_group,
                errno,
                &rule,
            ),
            Some((MountMode::ReadOnly, rule)) if matches!(errno, EROFS | EACCES | EPERM) => self
                .once(
                    DenyKind::FileReadOnly,
                    path,
                    process,
                    thread_group,
                    errno,
                    &rule,
                ),
            Some(_) => None,
            None if in_root_trees(path) => None,
            None => self.once(
                DenyKind::FileOutside,
                path,
                process,
                thread_group,
                errno,
                "",
            ),
        }
    }

    /// Takes one observation. Returns the deny event it proves, if any.
    pub fn observe(&mut self, observation: Observation) -> Option<DenyEvent> {
        match observation {
            Observation::OpenFailed {
                path,
                errno,
                process,
                thread_group,
            } => self.failed_path(&path, errno, &process, thread_group),
            Observation::ExecAsked {
                path,
                process,
                thread_group,
            } => {
                self.asked
                    .entry(thread_group)
                    .or_default()
                    .push((path, process));
                None
            }
            Observation::ExecLoaded { thread_group } => {
                if let Some(pending) = self.asked.get_mut(&thread_group) {
                    pending.pop();
                }
                None
            }
            Observation::ConnectFailed {
                address,
                errno,
                process,
                thread_group,
            } => {
                if errno == 0 || errno == EINPROGRESS {
                    return None;
                }
                let (family, text, loopback) = address_text(&address)?;
                if family == AF_UNIX {
                    return self.failed_path(&text, errno, &process, thread_group);
                }
                if loopback {
                    return None;
                }
                self.once(DenyKind::Connect, &text, &process, thread_group, errno, "")
            }
        }
    }

    /// Ends the command. Returns the deny events of every exec that was asked for
    /// and never loaded.
    pub fn finish(mut self) -> Vec<DenyEvent> {
        let asked = std::mem::take(&mut self.asked);
        let mut events = Vec::new();
        for (thread_group, pending) in asked {
            for (path, process) in pending {
                if !is_plain(&path) {
                    continue;
                }
                let found = self
                    .plan
                    .mount_of(&path)
                    .map(|m| (m.mode, m.exec, m.rule.clone()));
                let event = match found {
                    Some((MountMode::Mask, _, rule)) => self.once(
                        DenyKind::ExecMasked,
                        &path,
                        &process,
                        thread_group,
                        0,
                        &rule,
                    ),
                    Some((_, false, rule)) => self.once(
                        DenyKind::ExecInMount,
                        &path,
                        &process,
                        thread_group,
                        0,
                        &rule,
                    ),
                    Some((_, true, _)) => None,
                    None if in_root_trees(&path) => None,
                    None => self.once(DenyKind::ExecOutside, &path, &process, thread_group, 0, ""),
                };
                events.extend(event);
            }
        }
        events
    }
}
