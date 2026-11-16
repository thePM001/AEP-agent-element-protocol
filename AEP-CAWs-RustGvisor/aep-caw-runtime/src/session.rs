//! Sessions of the CAW and the one gate that starts a sandbox.
//!
//! A session is a folder that only the CAW user can read. It holds the sandbox plan
//! with its digest, the pinned root file system and the audit log. `create` builds
//! it from one resolved profile record. [`exec`] is the only function that starts a
//! sandbox. It runs these steps in this order and stops at the first that fails:
//!
//! 1. Load the session file and check its digest and the digest of the plan.
//! 2. Check every file of the root against its pin.
//! 3. Check the runsc program against the pinned digest.
//! 4. Ask the kernel gate. A silent or refusing gate ends the run with the rule
//!    `kernel-dock-silent`.
//! 5. Append the start event to the audit log and sync it.
//! 6. Start the sandbox and append its seal record: the process id bound to the
//!    runtime and to the digest of the plan. A seal that cannot be stored ends the
//!    sandbox at once.
//!
//! After the command the gate appends one event per deny event and the end event,
//! removes the folder of the command and returns the exit code.

use std::fs;
use std::io::Read;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aep_caw_egress::{EgressEvent, EgressProxy, ProxyConfig};
use aep_caw_policy::canonical::{canonical_json, digest_without_field};
use aep_caw_policy::plan::{compile, plan_digest, PlanProgram, SandboxPlan, Variables};
use aep_caw_policy::record::parse_record;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha512};

use aep_isolation::{seal_process, IsolationSpec};

use crate::audit::AuditLog;
use crate::bundle::Limits;
use crate::rootfs::{build_root, resolve_root, verify_root, RootImage, DEFAULT_LIBRARY_DIRS};
use crate::sandbox::{run, short_private_dir, RunInput, RunOutcome};

/// The rule a refusal carries when the kernel gate did not admit the run.
pub const RULE_KERNEL_DOCK_SILENT: &str = "kernel-dock-silent";
/// Exit code of a run the gate refused before the sandbox started.
pub const EXIT_REFUSED: i32 = 126;
/// Exit code of a run whose trace stream was not complete.
pub const EXIT_ENFORCER_INCOMPLETE: i32 = 125;

/// Name of the sandbox runtime in a seal record.
pub const RUNTIME_NAME: &str = "gvisor-systrap";

/// Path of the init program inside every sandbox.
pub const INIT_PATH: &str = "/usr/bin/aep-caw-init";
/// Port of the relay on the loopback device of a sandbox.
pub const RELAY_PORT: u16 = 3128;
/// Path of the egress socket inside a sandbox.
pub const EGRESS_SOCKET: &str = "/run/caw/egress.sock";

/// The pin file of gVisor, read at build time.
const RUNSC_PIN: &str = include_str!("../../proof/runsc-pin.env");

/// Why a session cannot be created or a command cannot run.
#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    /// A file or folder cannot be read or written.
    #[error("{what} {path}: {source}")]
    Io {
        /// What the CAW tried.
        what: &'static str,
        /// The path.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
    /// The configuration file is not usable.
    #[error("caw.toml line {line}: {reason}")]
    Config {
        /// Number of the line, from 1.
        line: usize,
        /// What is wrong with it.
        reason: &'static str,
    },
    /// The profile is not in the allowed list of the configuration.
    #[error("the profile {0} is not in the allowed list of caw.toml")]
    ProfileNotAllowed(String),
    /// An id holds a character that is not allowed.
    #[error("{what} {value:?} is not a plain id")]
    Id {
        /// What the id names.
        what: &'static str,
        /// The id.
        value: String,
    },
    /// The policy engine refused the record or the session.
    #[error(transparent)]
    Policy(#[from] aep_caw_policy::PolicyError),
    /// The root file system cannot be built or changed after its pin.
    #[error(transparent)]
    Root(#[from] crate::rootfs::RootError),
    /// The audit log cannot be used.
    #[error(transparent)]
    Audit(#[from] crate::audit::AuditError),
    /// The sandbox cannot be started.
    #[error(transparent)]
    Run(#[from] crate::sandbox::RunError),
    /// The session file does not carry its digest.
    #[error("the session file {0} does not match its digest")]
    SessionDigest(PathBuf),
    /// The runsc program is not the pinned one.
    #[error("{path} is not the pinned runsc: its sha512 is {found}")]
    RunscPin {
        /// Path of runsc.
        path: PathBuf,
        /// The digest found.
        found: String,
    },
    /// The egress proxy cannot serve its socket.
    #[error("the egress proxy did not start: {0}")]
    Egress(String),
    /// The kernel gate did not admit the run.
    #[error("refused by the rule {RULE_KERNEL_DOCK_SILENT}: {0}")]
    KernelDockSilent(String),
}

fn io(what: &'static str, path: &Path) -> impl FnOnce(std::io::Error) -> SessionError {
    let path = path.to_path_buf();
    move |source| SessionError::Io { what, path, source }
}

/// The settings of the CAW on one host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CawConfig {
    /// Profiles a session may be created from.
    pub allowed_profiles: Vec<String>,
    /// Path of the runsc program.
    pub runsc: PathBuf,
    /// Path of the program aep-caw-init on the host. It becomes process 1 of
    /// every sandbox.
    pub init: PathBuf,
}

/// The init program next to the running program, the place a release puts it.
pub fn default_init() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("aep-caw-init")))
        .unwrap_or_else(|| PathBuf::from(INIT_PATH))
}

fn quoted(text: &str) -> Option<&str> {
    let inner = text.trim().strip_prefix('"')?.strip_suffix('"')?;
    (!inner.contains(['"', '\\'])).then_some(inner)
}

/// Reads `caw.toml`. The file knows three keys, each on one line:
///
/// ```text
/// allowed_profiles = ["restricted", "coding-agent"]
/// runsc = "/usr/bin/runsc"
/// init = "/usr/libexec/aep-caw-init"
/// ```
///
/// A line that starts with `#` is a comment. Any other content is refused, so a
/// misspelt key never passes as a default.
pub fn parse_config(text: &str) -> Result<CawConfig, SessionError> {
    let mut allowed: Option<Vec<String>> = None;
    let mut runsc: Option<PathBuf> = None;
    let mut init: Option<PathBuf> = None;
    for (i, raw) in text.lines().enumerate() {
        let bad = |reason| SessionError::Config {
            line: i + 1,
            reason,
        };
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| bad("the line is not key = value"))?;
        match key.trim() {
            "allowed_profiles" => {
                if allowed.is_some() {
                    return Err(bad("allowed_profiles is set twice"));
                }
                let inner = value
                    .trim()
                    .strip_prefix('[')
                    .and_then(|v| v.strip_suffix(']'))
                    .ok_or_else(|| bad("allowed_profiles must be a list in one line"))?;
                let mut names = Vec::new();
                for item in inner
                    .split(',')
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                {
                    names.push(
                        quoted(item)
                            .ok_or_else(|| bad("a profile must be a quoted text"))?
                            .to_string(),
                    );
                }
                allowed = Some(names);
            }
            "runsc" => {
                if runsc.is_some() {
                    return Err(bad("runsc is set twice"));
                }
                let path = quoted(value).ok_or_else(|| bad("runsc must be a quoted text"))?;
                if !path.starts_with('/') {
                    return Err(bad("runsc must be an absolute path"));
                }
                runsc = Some(PathBuf::from(path));
            }
            "init" => {
                if init.is_some() {
                    return Err(bad("init is set twice"));
                }
                let path = quoted(value).ok_or_else(|| bad("init must be a quoted text"))?;
                if !path.starts_with('/') {
                    return Err(bad("init must be an absolute path"));
                }
                init = Some(PathBuf::from(path));
            }
            _ => return Err(bad("unknown key")),
        }
    }
    Ok(CawConfig {
        allowed_profiles: allowed.unwrap_or_default(),
        runsc: runsc
            .unwrap_or_else(|| PathBuf::from(pin_value("RUNSC_BIN").unwrap_or("/usr/bin/runsc"))),
        init: init.unwrap_or_else(default_init),
    })
}

fn pin_value(key: &str) -> Option<&'static str> {
    RUNSC_PIN.lines().find_map(|line| {
        line.strip_prefix(key)
            .and_then(|rest| rest.strip_prefix('='))
    })
}

/// The pinned sha512 of the runsc program.
pub fn pinned_runsc_sha512() -> &'static str {
    pin_value("RUNSC_BIN_SHA512").unwrap_or("")
}

/// The pinned gVisor release.
pub fn pinned_runsc_release() -> &'static str {
    pin_value("RUNSC_RELEASE").unwrap_or("")
}

/// Checks a runsc program against the pin.
pub fn check_runsc(path: &Path) -> Result<(), SessionError> {
    let mut file = fs::File::open(path).map_err(io("open", path))?;
    let mut hasher = Sha512::new();
    let mut buffer = vec![0u8; 1 << 16];
    loop {
        let read = file.read(&mut buffer).map_err(io("read", path))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let found: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if found != pinned_runsc_sha512() {
        return Err(SessionError::RunscPin {
            path: path.to_path_buf(),
            found,
        });
    }
    Ok(())
}

/// The content of the session file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRecord {
    /// Id of the session.
    pub session_id: String,
    /// Time of creation in seconds since 1970.
    pub created_unix: u64,
    /// The workspace folder, also the working folder of every command.
    pub workspace: String,
    /// The sandbox plan.
    pub plan: SandboxPlan,
    /// The pinned files of the root.
    pub root: RootImage,
    /// sha256 over the canonical JSON of this record without this field.
    pub digest: String,
}

/// The folders of the CAW below one data folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    base: PathBuf,
}

impl Layout {
    /// The layout below `<data>/caw-framework`.
    pub fn new(data: &Path) -> Self {
        Self {
            base: data.join("caw-framework"),
        }
    }

    /// Path of the configuration file.
    pub fn config(&self) -> PathBuf {
        self.base.join("caw.toml")
    }

    /// Folder of the resolved profile records.
    pub fn profiles(&self) -> PathBuf {
        self.base.join("profiles")
    }

    /// Folder of one session.
    pub fn session(&self, id: &str) -> PathBuf {
        self.base.join("sessions").join(id)
    }
}

fn plain_id(what: &'static str, value: &str) -> Result<(), SessionError> {
    let plain = !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|b| {
            b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.' || b == b'_'
        })
        && !value.starts_with('.');
    if plain {
        Ok(())
    } else {
        Err(SessionError::Id {
            what,
            value: value.to_string(),
        })
    }
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn random_id() -> Result<String, SessionError> {
    let path = Path::new("/dev/urandom");
    let mut bytes = [0u8; 16];
    fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(io("read", path))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn private_dir(path: &Path) -> Result<(), SessionError> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path)
        .map_err(io("create the folder", path))
}

/// Lists the ids of the profile records below a data folder, sorted.
pub fn list_profiles(layout: &Layout) -> Result<Vec<String>, SessionError> {
    let dir = layout.profiles();
    let mut ids = Vec::new();
    for entry in fs::read_dir(&dir).map_err(io("list", &dir))? {
        let name = entry
            .map_err(io("list", &dir))?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if let Some(id) = name.strip_suffix(".json") {
            ids.push(id.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}

/// Creates a session from the record of one profile.
///
/// `variables` come from the arguments of the call. The variable `PROJECT_ROOT`
/// is set to the resolved workspace folder.
pub fn create(
    layout: &Layout,
    config: &CawConfig,
    profile_id: &str,
    workspace: &Path,
    variables: &Variables,
) -> Result<SessionRecord, SessionError> {
    plain_id("the profile", profile_id)?;
    if !config.allowed_profiles.iter().any(|p| p == profile_id) {
        return Err(SessionError::ProfileNotAllowed(profile_id.to_string()));
    }
    let record_path = layout.profiles().join(format!("{profile_id}.json"));
    let text = fs::read_to_string(&record_path).map_err(io("read", &record_path))?;
    let record = parse_record(&text)?;
    let workspace = fs::canonicalize(workspace).map_err(io("resolve", workspace))?;
    let workspace = workspace.to_string_lossy().into_owned();
    let variables = variables.clone().with("PROJECT_ROOT", &workspace);
    let plan = compile(&record, &variables)?;
    // The init program is part of every root, whatever the toolset holds.
    let mut programs = plan.programs.clone();
    programs.push(PlanProgram {
        name: "aep-caw-init".to_string(),
        source: config.init.to_string_lossy().into_owned(),
        path: INIT_PATH.to_string(),
    });
    let root = resolve_root(&programs, &DEFAULT_LIBRARY_DIRS)?;

    let session_id = random_id()?;
    let dir = layout.session(&session_id);
    private_dir(&dir)?;
    let mount_paths: Vec<&str> = plan.mounts.iter().map(|m| m.path.as_str()).collect();
    build_root(&root, &mount_paths, &dir.join("rootfs"))?;

    let mut session = SessionRecord {
        session_id,
        created_unix: now_unix_ms() / 1000,
        workspace,
        plan,
        root,
        digest: String::new(),
    };
    let mut value = serde_json::to_value(&session).map_err(|e| SessionError::Io {
        what: "encode",
        path: dir.clone(),
        source: std::io::Error::other(e),
    })?;
    session.digest = digest_without_field(&value);
    value["digest"] = Value::String(session.digest.clone());
    let file = dir.join("session.json");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    {
        use std::io::Write;
        let mut handle = options.open(&file).map_err(io("create", &file))?;
        handle
            .write_all(canonical_json(&value).as_bytes())
            .and_then(|()| handle.sync_all())
            .map_err(io("write", &file))?;
    }
    let mut audit = AuditLog::open(&dir.join("audit.log"))?;
    audit.append(
        now_unix_ms(),
        &json!({
            "kind": "session-create",
            "session": session.session_id,
            "profile": session.plan.profile_id,
            "record_digest": session.plan.record_digest,
            "plan_digest": session.plan.digest,
            "session_digest": session.digest,
        }),
    )?;
    Ok(session)
}

/// Loads a session and checks the digest of its file and of its plan.
pub fn load(layout: &Layout, session_id: &str) -> Result<SessionRecord, SessionError> {
    plain_id("the session", session_id)?;
    let file = layout.session(session_id).join("session.json");
    let text = fs::read_to_string(&file).map_err(io("read", &file))?;
    let mismatch = || SessionError::SessionDigest(file.clone());
    let value: Value = serde_json::from_str(&text).map_err(|_| mismatch())?;
    if value.get("digest").and_then(Value::as_str) != Some(digest_without_field(&value).as_str()) {
        return Err(mismatch());
    }
    let session: SessionRecord = serde_json::from_value(value).map_err(|_| mismatch())?;
    if session.session_id != session_id || plan_digest(&session.plan)? != session.plan.digest {
        return Err(mismatch());
    }
    Ok(session)
}

/// What the gate tells the kernel dock about one run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateRequest<'a> {
    /// Id of the session.
    pub session_id: &'a str,
    /// Digest of the sandbox plan.
    pub plan_digest: &'a str,
    /// The command with its arguments.
    pub args: &'a [String],
}

/// The side of the kernel dock the gate talks to.
///
/// An implementation seals one ping, sends it to the validation dock of the Base
/// Node and returns `Ok` only when the dock admitted it. Every other outcome, a
/// silent socket and a late answer included, is an `Err` with its reason.
pub trait KernelGate {
    /// Asks the kernel dock to admit one run.
    fn admit(&self, request: &GateRequest<'_>) -> Result<(), String>;
}

/// What one command gave, after the audit log was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutcome {
    /// Exit code the caller returns.
    pub exit_code: i32,
    /// Number of deny events of the command.
    pub deny_count: usize,
    /// What the sandbox reported.
    pub run: RunOutcome,
    /// What the egress proxy saw, one entry per request.
    pub egress: Vec<EgressEvent>,
}

/// Runs one command in a session. This is the only function that starts a sandbox.
pub fn exec(
    layout: &Layout,
    config: &CawConfig,
    gate: &dyn KernelGate,
    session_id: &str,
    args: &[String],
    time_limit: Option<Duration>,
) -> Result<ExecOutcome, SessionError> {
    let session = load(layout, session_id)?;
    let dir = layout.session(session_id);
    let root = dir.join("rootfs");
    verify_root(&session.root, &root)?;
    check_runsc(&config.runsc)?;

    let mut audit = AuditLog::open(&dir.join("audit.log"))?;
    let command_id = format!("c{}", audit.len() + 1);
    let request = GateRequest {
        session_id,
        plan_digest: &session.plan.digest,
        args,
    };
    if let Err(reason) = gate.admit(&request) {
        // The refusal is recorded when the log takes it. It is returned either way.
        let _ = audit.append(
            now_unix_ms(),
            &json!({
                "kind": "refused",
                "session": session_id,
                "command": command_id,
                "rule": RULE_KERNEL_DOCK_SILENT,
                "reason": reason,
                "args": args,
            }),
        );
        return Err(SessionError::KernelDockSilent(reason));
    }
    audit.append(
        now_unix_ms(),
        &json!({
            "kind": "start",
            "session": session_id,
            "command": command_id,
            "args": args,
            "plan_digest": session.plan.digest,
            "runsc_release": pinned_runsc_release(),
            "runsc_sha512": pinned_runsc_sha512(),
        }),
    )?;

    let work = dir.join("commands").join(&command_id);
    private_dir(&work)?;
    let audit = std::cell::RefCell::new(audit);
    let seal = |pid: u32| -> Result<(), String> {
        let spec = IsolationSpec::for_sandbox(RUNTIME_NAME, &session.plan.digest);
        let now = now_unix_ms();
        let sealed = seal_process(pid, &spec, i64::try_from(now).unwrap_or(i64::MAX))?;
        audit
            .borrow_mut()
            .append(
                now,
                &json!({
                    "kind": "seal",
                    "session": session_id,
                    "command": command_id,
                    "pid": sealed.pid,
                    "seal": sealed.seal,
                    "algorithm": sealed.algorithm,
                    "spec_digest": sealed.spec_digest,
                    "runtime": RUNTIME_NAME,
                    "plan_digest": session.plan.digest,
                }),
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    };
    // Process 1 is the init program. With a route in the plan it also relays the
    // loopback proxy port to the egress socket and the proxy serves that socket.
    let mut sandbox_args = vec![INIT_PATH.to_string()];
    let mut extra_env: Vec<(String, String)> = Vec::new();
    let mut proxy: Option<(EgressProxy, PathBuf)> = None;
    if !session.plan.routes.is_empty() {
        let egress_dir = short_private_dir()?;
        let started = EgressProxy::start(
            &egress_dir.join("egress.sock"),
            ProxyConfig::new(session.plan.routes.clone()),
        );
        match started {
            Ok(running) => proxy = Some((running, egress_dir)),
            Err(err) => {
                let _ = fs::remove_dir_all(&egress_dir);
                let _ = fs::remove_dir_all(&work);
                let mut log = audit.into_inner();
                log.append(
                    now_unix_ms(),
                    &json!({"kind": "end", "session": session_id, "command": command_id, "error": err.to_string()}),
                )?;
                return Err(SessionError::Egress(err.to_string()));
            }
        }
        sandbox_args.extend([
            "--relay".to_string(),
            RELAY_PORT.to_string(),
            EGRESS_SOCKET.to_string(),
        ]);
        let address = format!("http://127.0.0.1:{RELAY_PORT}");
        for name in ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] {
            extra_env.push((name.to_string(), address.clone()));
        }
    }
    sandbox_args.push("--".to_string());
    sandbox_args.extend(args.iter().cloned());
    let result = run(
        &session.plan,
        &RunInput {
            runsc: &config.runsc,
            root: &root,
            work: &work,
            args: &sandbox_args,
            cwd: &session.workspace,
            egress_dir: proxy.as_ref().map(|(_, dir)| dir.as_path()),
            extra_env: &extra_env,
            limits: Limits::default(),
            time_limit,
            on_started: Some(&seal),
        },
    );
    let mut audit = audit.into_inner();
    let _ = fs::remove_dir_all(&work);
    let egress = match proxy {
        Some((running, egress_dir)) => {
            let events = running.finish();
            let _ = fs::remove_dir_all(&egress_dir);
            events
        }
        None => Vec::new(),
    };
    let run = match result {
        Ok(run) => run,
        Err(err) => {
            audit.append(
                now_unix_ms(),
                &json!({"kind": "end", "session": session_id, "command": command_id, "error": err.to_string()}),
            )?;
            return Err(err.into());
        }
    };

    for event in &run.deny_events {
        audit.append(
            now_unix_ms(),
            &json!({
                "kind": "deny",
                "session": session_id,
                "command": command_id,
                "deny": event.kind.name(),
                "target": event.target,
                "process": event.process,
                "errno": event.errno,
                "rule": event.rule,
            }),
        )?;
    }
    let mut egress_denied = 0usize;
    for event in &egress {
        let refused_by_policy = event.refusal.as_ref().is_some_and(|r| r.is_policy());
        if refused_by_policy {
            egress_denied += 1;
        }
        audit.append(
            now_unix_ms(),
            &json!({
                "kind": if refused_by_policy { "deny" } else { "egress" },
                "session": session_id,
                "command": command_id,
                "deny": if refused_by_policy { "egress" } else { "" },
                "scheme": event.scheme,
                "target": format!("{}:{}", event.host, event.port),
                "route": event.allowed.as_ref().map(|(route, _)| route.clone()),
                "address": event.allowed.as_ref().map(|(_, address)| address.to_string()),
                "refusal": event.refusal.as_ref().map(|r| r.name()),
            }),
        )?;
    }
    let deny_count = run.deny_events.len() + egress_denied;
    let enforcer_complete = run.trace_complete && run.trace_dropped == 0;
    let exit_code = if enforcer_complete {
        run.exit_code
    } else {
        EXIT_ENFORCER_INCOMPLETE
    };
    audit.append(
        now_unix_ms(),
        &json!({
            "kind": "end",
            "session": session_id,
            "command": command_id,
            "exit_code": exit_code,
            "command_exit_code": run.exit_code,
            "timed_out": run.timed_out,
            "deny_count": deny_count,
            "trace_points": run.trace_points,
            "trace_dropped": run.trace_dropped,
            "trace_complete": run.trace_complete,
        }),
    )?;
    Ok(ExecOutcome {
        exit_code,
        deny_count,
        run,
        egress,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::verify;

    struct Admit;
    impl KernelGate for Admit {
        fn admit(&self, _: &GateRequest<'_>) -> Result<(), String> {
            Ok(())
        }
    }
    struct Silent;
    impl KernelGate for Silent {
        fn admit(&self, _: &GateRequest<'_>) -> Result<(), String> {
            Err("no answer from the validation dock".to_string())
        }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("caw-session-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    /// A data folder with one profile record whose toolset is one static program,
    /// and a workspace outside of the root trees.
    fn fixture(name: &str) -> (PathBuf, Layout, CawConfig, PathBuf) {
        let base = PathBuf::from(format!(
            "/var/tmp/caw-session-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&base);
        let _ = temp(name);
        let workspace = base.join("project");
        fs::create_dir_all(&workspace).expect("workspace");
        let tool = base.join("tool");
        let mut plain = vec![0u8; 64];
        plain[..6].copy_from_slice(b"\x7fELF\x02\x01");
        fs::write(&tool, &plain).expect("tool");
        let layout = Layout::new(&base.join("data"));
        fs::create_dir_all(layout.profiles()).expect("profiles");
        let mut value = json!({
            "record": "aep.caw.resolved_profile",
            "version": 1,
            "profile_id": "test",
            "gap_address": "dev.test/test.v1",
            "enforcement_tier": "gvisor",
            "llm_proxy": false,
            "compiled_runtime": false,
            "base_policy": {"name": "base", "file_rules": [], "command_rules": []},
            "mounts": [{
                "path": "${PROJECT_ROOT}",
                "policy": {"name": "rw", "command_rules": [], "file_rules": [{
                    "name": "allow-rw",
                    "paths": ["${MOUNT_PATH}", "${MOUNT_PATH}/**"],
                    "operations": ["*"],
                    "decision": "allow"
                }]}
            }],
            "egress_policy": null,
            "toolset": {"name": "tools", "programs": [
                {"name": "tool", "source": tool.to_string_lossy(), "path": "/usr/bin/tool"}
            ]},
        });
        let digest = digest_without_field(&value);
        value["digest"] = Value::String(digest);
        fs::write(layout.profiles().join("test.json"), canonical_json(&value)).expect("record");
        let config = CawConfig {
            allowed_profiles: vec!["test".to_string()],
            runsc: base.join("no-runsc"),
            init: tool.clone(),
        };
        (base, layout, config, workspace)
    }

    #[test]
    fn the_configuration_knows_two_keys_and_refuses_the_rest() {
        let config = parse_config("# CAW settings\nallowed_profiles = [\"restricted\", \"coding-agent\"]\nrunsc = \"/opt/gvisor/runsc\"\ninit = \"/opt/caw/aep-caw-init\"\n")
            .expect("parses");
        assert_eq!(
            config.allowed_profiles,
            vec!["restricted".to_string(), "coding-agent".to_string()]
        );
        assert_eq!(config.runsc, PathBuf::from("/opt/gvisor/runsc"));
        let empty = parse_config("").expect("parses");
        assert!(empty.allowed_profiles.is_empty());
        assert_eq!(empty.runsc, PathBuf::from("/usr/bin/runsc"));
        for text in [
            "allowed = [\"a\"]",
            "allowed_profiles = \"a\"",
            "allowed_profiles = [a]",
            "allowed_profiles = [\"a\"]\nallowed_profiles = [\"b\"]",
            "runsc = runsc",
            "runsc = \"bin/runsc\"",
            "runsc = \"/a\"\nrunsc = \"/b\"",
            "init = \"relative/init\"",
            "init = \"/a\"\ninit = \"/b\"",
            "just a line",
            "[section]",
        ] {
            assert!(
                matches!(parse_config(text), Err(SessionError::Config { .. })),
                "{text}"
            );
        }
    }

    #[test]
    fn the_pin_is_read_from_the_pin_file() {
        assert_eq!(pinned_runsc_sha512().len(), 128);
        assert!(pinned_runsc_release().starts_with("release-"));
    }

    #[test]
    fn a_session_holds_its_plan_its_root_and_its_first_audit_line() {
        let (base, layout, config, workspace) = fixture("create");
        let session =
            create(&layout, &config, "test", &workspace, &Variables::new()).expect("creates");
        assert_eq!(session.session_id.len(), 32);
        assert_eq!(session.plan.profile_id, "test");
        assert_eq!(session.workspace, workspace.to_string_lossy());
        assert_eq!(session.root.files.len(), 2);
        assert!(session.root.files.iter().any(|f| f.path == INIT_PATH));
        let dir = layout.session(&session.session_id);
        assert!(dir.join("rootfs/usr/bin/tool").is_file());
        assert!(dir
            .join("rootfs")
            .join(session.workspace.trim_start_matches('/'))
            .is_dir());
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&dir).expect("meta").permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(dir.join("session.json"))
                .expect("meta")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(verify(&dir.join("audit.log")).expect("chain").0, 1);
        assert_eq!(load(&layout, &session.session_id).expect("loads"), session);
        assert_eq!(
            list_profiles(&layout).expect("lists"),
            vec!["test".to_string()]
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_profile_outside_the_allowed_list_creates_no_session() {
        let (base, layout, mut config, workspace) = fixture("allowed");
        config.allowed_profiles.clear();
        assert!(matches!(
            create(&layout, &config, "test", &workspace, &Variables::new()),
            Err(SessionError::ProfileNotAllowed(p)) if p == "test"
        ));
        config.allowed_profiles = vec!["absent".to_string(), "../test".to_string()];
        assert!(matches!(
            create(&layout, &config, "absent", &workspace, &Variables::new()),
            Err(SessionError::Io { .. })
        ));
        assert!(matches!(
            create(&layout, &config, "../test", &workspace, &Variables::new()),
            Err(SessionError::Id { .. })
        ));
        assert!(!layout.session("x").parent().is_some_and(Path::exists));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_changed_session_file_is_refused() {
        let (base, layout, config, workspace) = fixture("changed");
        let session =
            create(&layout, &config, "test", &workspace, &Variables::new()).expect("creates");
        let file = layout.session(&session.session_id).join("session.json");
        let text = fs::read_to_string(&file).expect("read");
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).expect("mode");
        fs::write(&file, text.replacen("\"read-write\"", "\"read-only\"", 1)).expect("write");
        assert!(matches!(
            load(&layout, &session.session_id),
            Err(SessionError::SessionDigest(_))
        ));
        fs::write(&file, &text).expect("write");
        assert!(load(&layout, &session.session_id).is_ok());
        for id in ["", "../x", "A", "a/b", ".hidden"] {
            assert!(
                matches!(load(&layout, id), Err(SessionError::Id { .. })),
                "{id:?}"
            );
        }
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_program_of_the_root_that_changed_stops_the_run_before_the_gate() {
        let (base, layout, config, workspace) = fixture("root-changed");
        let session =
            create(&layout, &config, "test", &workspace, &Variables::new()).expect("creates");
        let dir = layout.session(&session.session_id);
        let copy = dir.join("rootfs/usr/bin/tool");
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&copy, fs::Permissions::from_mode(0o755)).expect("mode");
        fs::write(&copy, b"swapped").expect("write");
        let args = vec!["tool".to_string()];
        assert!(matches!(
            exec(&layout, &config, &Admit, &session.session_id, &args, None),
            Err(SessionError::Root(_))
        ));
        assert_eq!(verify(&dir.join("audit.log")).expect("chain").0, 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_runsc_that_is_not_the_pinned_one_stops_the_run_before_the_gate() {
        let (base, layout, config, workspace) = fixture("runsc");
        let session =
            create(&layout, &config, "test", &workspace, &Variables::new()).expect("creates");
        let args = vec!["tool".to_string()];
        assert!(matches!(
            exec(&layout, &config, &Admit, &session.session_id, &args, None),
            Err(SessionError::Io { .. })
        ));
        fs::write(&config.runsc, b"#!/bin/sh\nexit 0\n").expect("write");
        assert!(matches!(
            exec(&layout, &config, &Admit, &session.session_id, &args, None),
            Err(SessionError::RunscPin { .. })
        ));
        assert_eq!(
            verify(&layout.session(&session.session_id).join("audit.log"))
                .expect("chain")
                .0,
            1
        );
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_silent_gate_refuses_the_run_and_leaves_one_refusal_in_the_log() {
        let (base, layout, mut config, workspace) = fixture("silent");
        let session =
            create(&layout, &config, "test", &workspace, &Variables::new()).expect("creates");
        let Some(runsc) = [pin_value("RUNSC_BIN").unwrap_or("/usr/bin/runsc")]
            .iter()
            .map(PathBuf::from)
            .find(|p| check_runsc(p).is_ok())
        else {
            let _ = fs::remove_dir_all(base);
            return;
        };
        config.runsc = runsc;
        let args = vec!["tool".to_string()];
        let result = exec(&layout, &config, &Silent, &session.session_id, &args, None);
        assert!(
            matches!(&result, Err(SessionError::KernelDockSilent(reason)) if reason.contains("no answer"))
        );
        assert!(result
            .err()
            .is_some_and(|e| e.to_string().contains(RULE_KERNEL_DOCK_SILENT)));
        let dir = layout.session(&session.session_id);
        let text = fs::read_to_string(dir.join("audit.log")).expect("read");
        let last: Value = serde_json::from_str(text.lines().last().expect("line")).expect("json");
        assert_eq!(last["event"]["kind"], "refused");
        assert_eq!(last["event"]["rule"], RULE_KERNEL_DOCK_SILENT);
        assert!(!dir.join("commands").exists());
        let _ = fs::remove_dir_all(base);
    }
}
