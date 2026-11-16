//! The CAW command.
//!
//! ```text
//! aep-caw profiles list  --data <folder>
//! aep-caw session create --data <folder> --profile <id> --workspace <folder> [--var NAME=VALUE]...
//! aep-caw exec           --data <folder> --session <id> [--time-limit <seconds>] -- <command> [args]
//! aep-caw doctor         --data <folder>
//! ```
//!
//! There is no server mode. Every call does one thing and ends. The variables of a
//! session come from `--var` and `--workspace` only, never from the environment of
//! the caller.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use aep_caw_dock::DockClient;
use aep_caw_policy::plan::Variables;
use aep_caw_runtime::session::{
    check_runsc, create, exec, list_profiles, parse_config, pinned_runsc_release, CawConfig,
    GateRequest, KernelGate, Layout, SessionError, EXIT_REFUSED,
};

const USAGE: &str = "usage:
  aep-caw profiles list  --data <folder>
  aep-caw session create --data <folder> --profile <id> --workspace <folder> [--var NAME=VALUE]...
  aep-caw exec           --data <folder> --session <id> [--time-limit <seconds>] -- <command> [args]
  aep-caw doctor         --data <folder>";

/// Exit code of a call with wrong arguments.
const EXIT_USAGE: u8 = 64;

/// One parsed call.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Call {
    ProfilesList {
        data: PathBuf,
    },
    SessionCreate {
        data: PathBuf,
        profile: String,
        workspace: PathBuf,
        variables: Vec<(String, String)>,
    },
    Exec {
        data: PathBuf,
        session: String,
        time_limit: Option<Duration>,
        command: Vec<String>,
    },
    Doctor {
        data: PathBuf,
    },
}

/// The options of one call: each `--name value` once, `--var` any number of times.
#[derive(Debug, Default)]
struct Options {
    values: Vec<(String, String)>,
    variables: Vec<(String, String)>,
    command: Vec<String>,
}

impl Options {
    fn parse(args: &[String], known: &[&str]) -> Result<Self, String> {
        let mut options = Self::default();
        let mut i = 0;
        while i < args.len() {
            let name = args[i].as_str();
            if name == "--" {
                options.command = args[i + 1..].to_vec();
                return Ok(options);
            }
            let value = args
                .get(i + 1)
                .ok_or_else(|| format!("{name} needs a value"))?;
            if name == "--var" && known.contains(&"--var") {
                let (key, text) = value.split_once('=').ok_or("--var needs NAME=VALUE")?;
                let plain = !key.is_empty()
                    && key
                        .bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
                if !plain || key == "PROJECT_ROOT" || key == "MOUNT_PATH" {
                    return Err(format!("the variable name {key} is not allowed"));
                }
                options.variables.push((key.to_string(), text.to_string()));
            } else if known.contains(&name) {
                if options.values.iter().any(|(n, _)| n == name) {
                    return Err(format!("{name} is given twice"));
                }
                options.values.push((name.to_string(), value.clone()));
            } else {
                return Err(format!("unknown option {name}"));
            }
            i += 2;
        }
        Ok(options)
    }

    fn take(&self, name: &str) -> Result<String, String> {
        self.values
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
            .ok_or_else(|| format!("{name} is missing"))
    }
}

fn parse(args: &[String]) -> Result<Call, String> {
    let words: Vec<&str> = args.iter().take(2).map(String::as_str).collect();
    match words.as_slice() {
        ["profiles", "list"] => {
            let o = Options::parse(&args[2..], &["--data"])?;
            if !o.command.is_empty() {
                return Err("profiles list takes no command".to_string());
            }
            Ok(Call::ProfilesList {
                data: o.take("--data")?.into(),
            })
        }
        ["session", "create"] => {
            let o = Options::parse(&args[2..], &["--data", "--profile", "--workspace", "--var"])?;
            if !o.command.is_empty() {
                return Err("session create takes no command".to_string());
            }
            Ok(Call::SessionCreate {
                data: o.take("--data")?.into(),
                profile: o.take("--profile")?,
                workspace: o.take("--workspace")?.into(),
                variables: o.variables,
            })
        }
        ["exec", ..] => {
            let o = Options::parse(&args[1..], &["--data", "--session", "--time-limit"])?;
            if o.command.is_empty() {
                return Err("exec needs a command after --".to_string());
            }
            let time_limit = match o.take("--time-limit") {
                Ok(text) => {
                    let seconds: u64 = text
                        .parse()
                        .ok()
                        .filter(|s| *s > 0)
                        .ok_or("--time-limit needs a number of seconds above zero")?;
                    Some(Duration::from_secs(seconds))
                }
                Err(_) => None,
            };
            Ok(Call::Exec {
                data: o.take("--data")?.into(),
                session: o.take("--session")?,
                time_limit,
                command: o.command,
            })
        }
        ["doctor", ..] => {
            let o = Options::parse(&args[1..], &["--data"])?;
            if !o.command.is_empty() {
                return Err("doctor takes no command".to_string());
            }
            Ok(Call::Doctor {
                data: o.take("--data")?.into(),
            })
        }
        _ => Err("unknown command".to_string()),
    }
}

/// The gate of a host whose caw.toml names no Base Node. It admits nothing, so no
/// command starts on a host that was never tied to a kernel.
struct NoBaseNode;

impl KernelGate for NoBaseNode {
    fn admit(&self, _: &GateRequest<'_>) -> Result<(), String> {
        Err("caw.toml names no Base Node: set base_node_data and dock_socket".to_string())
    }
}

/// The kernel gate of a configuration: the dock client of the named Base Node.
fn gate_of(config: &CawConfig) -> Box<dyn KernelGate> {
    match (&config.base_node_data, &config.dock_socket) {
        (Some(data), Some(socket)) => Box::new(DockClient::new(data, socket)),
        _ => Box::new(NoBaseNode),
    }
}

fn read_config(layout: &Layout) -> Result<CawConfig, SessionError> {
    let path = layout.config();
    let text = std::fs::read_to_string(&path).map_err(|source| SessionError::Io {
        what: "read",
        path,
        source,
    })?;
    parse_config(&text)
}

fn doctor(layout: &Layout) -> bool {
    let mut healthy = true;
    let mut line = |ok: bool, text: String| {
        println!("{} {text}", if ok { "ok  " } else { "FAIL" });
        healthy &= ok;
    };
    match read_config(layout) {
        Ok(config) => {
            line(
                true,
                format!(
                    "caw.toml allows {} profile or profiles",
                    config.allowed_profiles.len()
                ),
            );
            match check_runsc(&config.runsc) {
                Ok(()) => line(
                    true,
                    format!(
                        "{} is the pinned {}",
                        config.runsc.display(),
                        pinned_runsc_release()
                    ),
                ),
                Err(err) => line(false, err.to_string()),
            }
            match list_profiles(layout) {
                Ok(ids) => {
                    for allowed in &config.allowed_profiles {
                        line(ids.contains(allowed), format!("profile record {allowed}"));
                    }
                }
                Err(err) => line(false, err.to_string()),
            }
        }
        Err(err) => line(false, err.to_string()),
    }
    let restrict = Path::new("/proc/sys/kernel/apparmor_restrict_unprivileged_userns");
    if std::fs::read_to_string(restrict).is_ok_and(|v| v.trim() == "1") {
        let profile = Path::new("/etc/apparmor.d/runsc").exists();
        line(
            profile,
            "this host restricts user namespaces through AppArmor: the profile /etc/apparmor.d/runsc must exist".to_string(),
        );
    }
    match read_config(layout) {
        Ok(config) => {
            let command = vec![String::from("doctor")];
            let request = GateRequest {
                session_id: "doctor",
                plan_digest: "",
                args: &command,
            };
            match gate_of(&config).admit(&request) {
                Ok(()) => line(
                    true,
                    "the kernel dock of the Base Node admits a sealed ping".to_string(),
                ),
                Err(reason) => line(false, format!("kernel-dock-silent: {reason}")),
            }
        }
        Err(_) => line(
            false,
            "kernel-dock-silent: caw.toml cannot be read".to_string(),
        ),
    }
    healthy
}

fn run(call: Call) -> Result<u8, SessionError> {
    match call {
        Call::ProfilesList { data } => {
            let layout = Layout::new(&data);
            let allowed = read_config(&layout)?.allowed_profiles;
            for id in list_profiles(&layout)? {
                let mark = if allowed.contains(&id) {
                    "allowed"
                } else {
                    "not-allowed"
                };
                println!("{id} {mark}");
            }
            Ok(0)
        }
        Call::SessionCreate {
            data,
            profile,
            workspace,
            variables,
        } => {
            let layout = Layout::new(&data);
            let config = read_config(&layout)?;
            let mut vars = Variables::new();
            for (name, value) in &variables {
                vars = vars.with(name, value);
            }
            let session = create(&layout, &config, &profile, &workspace, &vars)?;
            println!("{}", session.session_id);
            eprintln!(
                "plan {} with {} mounts, {} programs and {} routes",
                session.plan.digest,
                session.plan.mounts.len(),
                session.plan.programs.len(),
                session.plan.routes.len()
            );
            Ok(0)
        }
        Call::Exec {
            data,
            session,
            time_limit,
            command,
        } => {
            let layout = Layout::new(&data);
            let config = read_config(&layout)?;
            let gate = gate_of(&config);
            let outcome = exec(
                &layout,
                &config,
                gate.as_ref(),
                &session,
                &command,
                time_limit,
            )?;
            Ok(u8::try_from(outcome.exit_code.clamp(0, 255)).unwrap_or(1))
        }
        Call::Doctor { data } => Ok(if doctor(&Layout::new(&data)) { 0 } else { 1 }),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let call = match parse(&args) {
        Ok(call) => call,
        Err(message) => {
            eprintln!("aep-caw: {message}\n{USAGE}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    match run(call) {
        Ok(code) => ExitCode::from(code),
        Err(err) => {
            eprintln!("aep-caw: {err}");
            ExitCode::from(u8::try_from(EXIT_REFUSED).unwrap_or(126))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(text: &str) -> Vec<String> {
        text.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn every_command_parses_with_its_options() {
        assert_eq!(
            parse(&args("profiles list --data /d")),
            Ok(Call::ProfilesList { data: "/d".into() })
        );
        assert_eq!(
            parse(&args("session create --data /d --profile restricted --workspace /w --var HOME=/home/a --var AEP_MODEL_GATEWAY_HOST=g.example.com")),
            Ok(Call::SessionCreate {
                data: "/d".into(),
                profile: "restricted".to_string(),
                workspace: "/w".into(),
                variables: vec![
                    ("HOME".to_string(), "/home/a".to_string()),
                    ("AEP_MODEL_GATEWAY_HOST".to_string(), "g.example.com".to_string()),
                ],
            })
        );
        assert_eq!(
            parse(&args(
                "exec --data /d --session abc --time-limit 30 -- sh -c true"
            )),
            Ok(Call::Exec {
                data: "/d".into(),
                session: "abc".to_string(),
                time_limit: Some(Duration::from_secs(30)),
                command: args("sh -c true"),
            })
        );
        assert_eq!(
            parse(&args("doctor --data /d")),
            Ok(Call::Doctor { data: "/d".into() })
        );
    }

    #[test]
    fn options_of_the_command_after_the_two_dashes_are_not_read() {
        let call = parse(&args(
            "exec --data /d --session s -- ls --data /other --session x",
        ))
        .expect("parses");
        assert_eq!(
            call,
            Call::Exec {
                data: "/d".into(),
                session: "s".to_string(),
                time_limit: None,
                command: args("ls --data /other --session x"),
            }
        );
    }

    #[test]
    fn wrong_calls_are_refused() {
        for text in [
            "",
            "serve --data /d",
            "profiles list",
            "profiles list --data /d --data /e",
            "profiles list --data",
            "profiles list --data /d -- ls",
            "session create --data /d --profile p",
            "session create --data /d --profile p --workspace /w --var lower=1",
            "session create --data /d --profile p --workspace /w --var NOVALUE",
            "session create --data /d --profile p --workspace /w --var PROJECT_ROOT=/etc",
            "session create --data /d --profile p --workspace /w --var MOUNT_PATH=/etc",
            "session create --data /d --profile p --workspace /w --unknown x",
            "exec --data /d --session s",
            "exec --data /d --session s --",
            "exec --data /d --session s --time-limit 0 -- ls",
            "exec --data /d --session s --time-limit soon -- ls",
            "exec --data /d --var A=B --session s -- ls",
            "doctor",
            "doctor --data /d -- ls",
        ] {
            assert!(parse(&args(text)).is_err(), "{text:?}");
        }
    }

    #[test]
    fn a_configuration_with_no_base_node_admits_no_run() {
        let request = GateRequest {
            session_id: "s",
            plan_digest: "sha256:p",
            args: &args("true"),
        };
        let mut config = CawConfig {
            allowed_profiles: Vec::new(),
            runsc: "/usr/bin/runsc".into(),
            init: "/usr/bin/aep-caw-init".into(),
            base_node_data: None,
            dock_socket: None,
        };
        let refused = |config: &CawConfig, text: &str| {
            gate_of(config)
                .admit(&request)
                .is_err_and(|e| e.contains(text))
        };
        assert!(refused(&config, "names no Base Node"));
        config.base_node_data = Some("/nonexistent/aep".into());
        assert!(refused(&config, "names no Base Node"));
        config.dock_socket = Some("/nonexistent/aep/sockets/validation".into());
        assert!(refused(&config, "has no dock key"));
    }
}
