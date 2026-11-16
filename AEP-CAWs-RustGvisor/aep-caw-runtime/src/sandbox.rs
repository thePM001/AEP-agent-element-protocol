//! Runs one command in one gVisor sandbox and collects its deny events.
//!
//! The supervisor writes the bundle, binds the trace socket, starts runsc and feeds
//! every trace point to the classifier. runsc runs without root, on the systrap
//! platform, with no network device and with no cgroup setup.
//!
//! A run whose trace stream never opened or lost points is reported as such. The
//! caller must treat it as a failed enforcer: its deny events are not complete.

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::DirBuilderExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use aep_caw_policy::classify::{Classifier, DenyEvent, Observation};
use aep_caw_policy::plan::{MountMode, SandboxPlan};
use rustix::net::{connect, socket, AddressFamily, SocketAddrUnix, SocketType};
use serde_json::json;

use crate::bundle::{config, BundleError, BundleInput, Limits};
use crate::trace::{TraceError, TraceEvent, TraceKind};
use crate::trace_listener::TraceListener;

/// Exit code of a command that the time limit ended.
pub const EXIT_TIME_LIMIT: i32 = 124;

/// Trace points the CAW asks gVisor for.
const TRACE_POINTS: [&str; 7] = [
    "syscall/open/exit",
    "syscall/openat/exit",
    "syscall/creat/exit",
    "syscall/execve/exit",
    "syscall/execveat/exit",
    "syscall/connect/exit",
    "sentry/execve",
];

/// What one run needs besides the plan.
#[derive(Debug, Clone)]
pub struct RunInput<'a> {
    /// Path of the runsc program.
    pub runsc: &'a Path,
    /// Root folder of the session, built by [`crate::rootfs::build_root`].
    pub root: &'a Path,
    /// An empty folder for this one command. It holds the bundle, the state of
    /// runsc and the sockets. Only the CAW user may read it.
    pub work: &'a Path,
    /// The command with its arguments.
    pub args: &'a [String],
    /// Working folder of the command inside the sandbox.
    pub cwd: &'a str,
    /// Folder on the host with the egress socket, if the plan has a route.
    pub egress_dir: Option<&'a Path>,
    /// Further variables of the environment.
    pub extra_env: &'a [(String, String)],
    /// Bounds of the sandbox.
    pub limits: Limits,
    /// The command is ended after this time.
    pub time_limit: Option<Duration>,
}

/// What one run gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutcome {
    /// Exit code of the command, or [`EXIT_TIME_LIMIT`].
    pub exit_code: i32,
    /// True when the time limit ended the command.
    pub timed_out: bool,
    /// The deny events of the command, in the order they were proven.
    pub deny_events: Vec<DenyEvent>,
    /// Number of trace points received.
    pub trace_points: u64,
    /// Number of trace points gVisor dropped.
    pub trace_dropped: u32,
    /// True when the trace stream opened and ended in order.
    pub trace_complete: bool,
}

/// Why a run did not start or did not end in order.
#[derive(Debug, thiserror::Error)]
pub enum RunError {
    /// A folder or file of the run cannot be written.
    #[error("{what} {path}: {source}")]
    Io {
        /// What the CAW tried.
        what: &'static str,
        /// The path.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
    /// A mount of the plan has no folder on the host.
    #[error("the mount {0} of the plan is not a folder on this host")]
    MountSource(String),
    /// The bundle cannot be written.
    #[error(transparent)]
    Bundle(#[from] BundleError),
    /// The trace socket cannot be bound.
    #[error(transparent)]
    Trace(#[from] TraceError),
    /// runsc cannot be started.
    #[error("runsc {path} cannot be started: {source}")]
    Spawn {
        /// Path of runsc.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
}

fn io(what: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> RunError {
    let path = path.to_path_buf();
    move |source| RunError::Io { what, path, source }
}

fn private_dir(path: &Path) -> Result<(), RunError> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(io("create the folder", path))
}

/// Turns one trace point into what the classifier reads.
pub fn observation(event: TraceEvent) -> Option<Observation> {
    match event.kind {
        TraceKind::Open if event.failed() => Some(Observation::OpenFailed {
            path: event.pathname,
            errno: event.exit.map_or(0, |e| e.errno),
            process: event.process_name,
            thread_group: event.thread_group_id,
        }),
        TraceKind::Execve => Some(Observation::ExecAsked {
            path: event.pathname,
            process: event.process_name,
            thread_group: event.thread_group_id,
        }),
        TraceKind::ExecDone => Some(Observation::ExecLoaded {
            thread_group: event.thread_group_id,
        }),
        TraceKind::Connect if event.failed() => Some(Observation::ConnectFailed {
            address: event.address,
            errno: event.exit.map_or(0, |e| e.errno),
            process: event.process_name,
            thread_group: event.thread_group_id,
        }),
        TraceKind::Open | TraceKind::Connect | TraceKind::Other(_) => None,
    }
}

/// What the trace thread hands back.
struct TraceResult {
    events: Vec<TraceEvent>,
    dropped: u32,
    complete: bool,
}

/// Runs one command in one sandbox.
pub fn run(plan: &SandboxPlan, input: &RunInput<'_>) -> Result<RunOutcome, RunError> {
    let mut existing_masks = BTreeSet::new();
    for mount in &plan.mounts {
        let is_dir = fs::metadata(&mount.path).is_ok_and(|m| m.is_dir());
        match mount.mode {
            MountMode::Mask if is_dir => {
                existing_masks.insert(mount.path.clone());
            }
            MountMode::Mask => {}
            MountMode::ReadOnly | MountMode::ReadWrite if !is_dir => {
                return Err(RunError::MountSource(mount.path.clone()));
            }
            MountMode::ReadOnly | MountMode::ReadWrite => {}
        }
    }

    let bundle = input.work.join("bundle");
    let state = input.work.join("state");
    private_dir(&bundle)?;
    private_dir(&state)?;
    let root = input.root.to_string_lossy();
    let egress = input.egress_dir.map(|p| p.to_string_lossy().into_owned());
    let document = config(
        plan,
        &BundleInput {
            args: input.args,
            cwd: input.cwd,
            root: &root,
            existing_masks: &existing_masks,
            egress_dir: egress.as_deref(),
            extra_env: input.extra_env,
            limits: input.limits,
        },
    )?;
    let config_path = bundle.join("config.json");
    fs::write(&config_path, document.to_string()).map_err(io("write", &config_path))?;

    let trace_socket = input.work.join("trace.sock");
    let points: Vec<_> = TRACE_POINTS
        .iter()
        .map(|name| json!({"name": name, "context_fields": ["process_name", "group_id", "container_id"]}))
        .collect();
    let session = json!({
        "trace_session": {
            "name": "Default",
            "points": points,
            "sinks": [{"name": "remote", "config": {"endpoint": trace_socket.to_string_lossy()}}],
        }
    });
    let init_path = input.work.join("pod-init.json");
    fs::write(&init_path, session.to_string()).map_err(io("write", &init_path))?;

    let listener = TraceListener::bind(&trace_socket)?;
    let trace = std::thread::spawn(move || {
        let mut result = TraceResult {
            events: Vec::new(),
            dropped: 0,
            complete: false,
        };
        let Ok(mut connection) = listener.accept() else {
            return result;
        };
        loop {
            match connection.next_event() {
                Ok(Some(event)) => {
                    result.dropped = event.dropped_count;
                    result.events.push(event);
                }
                Ok(None) => {
                    result.complete = true;
                    return result;
                }
                Err(_) => return result,
            }
        }
    });

    let id = format!("caw-{}", std::process::id());
    let mut command = Command::new(input.runsc);
    command
        .arg("--rootless")
        .arg("--platform=systrap")
        .arg("--network=none")
        .arg("--ignore-cgroups")
        .arg(format!("--root={}", state.display()))
        .arg(format!("--pod-init-config={}", init_path.display()));
    if input.egress_dir.is_some() {
        command.arg("--host-uds=open");
    }
    command
        .arg("run")
        .arg("--bundle")
        .arg(&bundle)
        .arg(&id)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|source| RunError::Spawn {
        path: input.runsc.to_path_buf(),
        source,
    })?;

    // The output of the command is relayed, not inherited. A sandbox that holds the
    // file of the caller writes at an offset of its own and would overwrite what
    // the caller wrote to the same file.
    let relay_out = child.stdout.take().map(|mut from| {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut from, &mut std::io::stdout());
        })
    });
    let relay_err = child.stderr.take().map(|mut from| {
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut from, &mut std::io::stderr());
        })
    });

    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {}
            Err(_) => break None,
        }
        if input
            .time_limit
            .is_some_and(|limit| started.elapsed() >= limit)
        {
            timed_out = true;
            let _ = child.kill();
            break child.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(5));
    };

    for relay in [relay_out, relay_err].into_iter().flatten() {
        let _ = relay.join();
    }
    {
        use std::io::Write;
        let _ = std::io::stdout().flush();
    }

    // A sandbox that never connected leaves the trace thread in accept. One
    // connection from here ends that wait: it sends no handshake.
    if !trace.is_finished() {
        if let (Ok(fd), Ok(address)) = (
            socket(AddressFamily::UNIX, SocketType::SEQPACKET, None),
            SocketAddrUnix::new(&trace_socket),
        ) {
            let _ = connect(&fd, &address);
        }
    }
    let result = trace.join().unwrap_or(TraceResult {
        events: Vec::new(),
        dropped: 0,
        complete: false,
    });

    let trace_points = result.events.len() as u64;
    let mut classifier = Classifier::new(plan);
    let mut deny_events = Vec::new();
    for event in result.events {
        if let Some(seen) = observation(event) {
            deny_events.extend(classifier.observe(seen));
        }
    }
    deny_events.extend(classifier.finish());

    let exit_code = if timed_out {
        EXIT_TIME_LIMIT
    } else {
        status.and_then(|s| s.code()).unwrap_or(1)
    };
    Ok(RunOutcome {
        exit_code,
        timed_out,
        deny_events,
        trace_points,
        trace_dropped: result.dropped,
        trace_complete: result.complete,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::TraceExit;

    fn event(kind: TraceKind, errno: Option<i64>) -> TraceEvent {
        TraceEvent {
            kind,
            dropped_count: 0,
            exit: errno.map(|errno| TraceExit { result: 0, errno }),
            sysno: 0,
            pathname: "/p".to_string(),
            fd_path: String::new(),
            address: vec![2, 0],
            process_name: "sh".to_string(),
            container_id: String::new(),
            thread_group_id: 5,
        }
    }

    #[test]
    fn trace_points_map_to_what_the_classifier_reads() {
        assert_eq!(
            observation(event(TraceKind::Open, Some(2))),
            Some(Observation::OpenFailed {
                path: "/p".to_string(),
                errno: 2,
                process: "sh".to_string(),
                thread_group: 5,
            })
        );
        assert_eq!(observation(event(TraceKind::Open, Some(0))), None);
        assert_eq!(observation(event(TraceKind::Open, None)), None);
        assert_eq!(
            observation(event(TraceKind::Execve, Some(0))),
            Some(Observation::ExecAsked {
                path: "/p".to_string(),
                process: "sh".to_string(),
                thread_group: 5,
            })
        );
        assert_eq!(
            observation(event(TraceKind::ExecDone, None)),
            Some(Observation::ExecLoaded { thread_group: 5 })
        );
        assert_eq!(
            observation(event(TraceKind::Connect, Some(101))),
            Some(Observation::ConnectFailed {
                address: vec![2, 0],
                errno: 101,
                process: "sh".to_string(),
                thread_group: 5,
            })
        );
        assert_eq!(observation(event(TraceKind::Connect, Some(0))), None);
        assert_eq!(observation(event(TraceKind::Other(9), Some(1))), None);
    }
}
