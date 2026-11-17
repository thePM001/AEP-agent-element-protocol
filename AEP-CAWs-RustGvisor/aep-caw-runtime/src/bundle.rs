//! The OCI bundle of one command.
//!
//! runsc starts a sandbox from a bundle: a root folder and one `config.json`. This
//! module writes that configuration from a sandbox plan. It is a pure function, so
//! the same plan and the same command always give the same sandbox.
//!
//! What every sandbox gets, whatever the plan says:
//! - a read only root that holds the programs of the toolset,
//! - an empty `/tmp` of its own with a size bound,
//! - no capability, no new privileges and an environment built from nothing,
//! - its own process, mount, IPC, host name and network namespace.

use std::collections::BTreeSet;

use aep_caw_policy::plan::{MountMode, SandboxPlan};
use serde_json::{json, Value};

/// Where the egress socket of the command appears inside the sandbox.
pub const EGRESS_DIR: &str = "/run/caw";

/// Bounds of one sandbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Size bound of `/tmp` in bytes.
    pub tmp_bytes: u64,
    /// Most open files of one process.
    pub open_files: u64,
    /// Most processes.
    pub processes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            tmp_bytes: 256 * 1024 * 1024,
            open_files: 1024,
            processes: 256,
        }
    }
}

/// What a bundle is built from besides the plan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleInput<'a> {
    /// The command with its arguments. The first entry is the program.
    pub args: &'a [String],
    /// Working folder of the command inside the sandbox.
    pub cwd: &'a str,
    /// Path of the root folder of the session on the host.
    pub root: &'a str,
    /// Mask paths of the plan that exist as a folder on the host. A mask over a
    /// path that does not exist has nothing to hide and gets no mount.
    pub existing_masks: &'a BTreeSet<String>,
    /// Folder on the host that holds the egress socket of this command, if the
    /// plan has a route.
    pub egress_dir: Option<&'a str>,
    /// Further variables of the environment, such as the proxy address.
    pub extra_env: &'a [(String, String)],
    /// The folder trees of the toolset: the folder of the host and its path inside
    /// the sandbox. Each is mounted read only.
    pub trees: &'a [(String, String)],
    /// Folders of the trees that join the search path of programs.
    pub path_dirs: &'a [String],
    /// Bounds of the sandbox.
    pub limits: Limits,
}

/// Why a bundle cannot be written.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BundleError {
    /// The command is empty.
    #[error("the command is empty")]
    EmptyCommand,
    /// A text holds a zero byte.
    #[error("{0} holds a zero byte")]
    ZeroByte(&'static str),
    /// The working folder is not an absolute path in plain form.
    #[error("the working folder {0} is not an absolute path in plain form")]
    Cwd(String),
    /// A variable of the environment has a name that is not plain.
    #[error("the variable name {0} is not plain")]
    EnvName(String),
}

fn plain_path(path: &str) -> bool {
    path.starts_with('/')
        && (path == "/"
            || path[1..]
                .split('/')
                .all(|part| !part.is_empty() && part != "." && part != ".."))
}

/// The environment of a command. It is built from nothing: no variable of the
/// caller reaches the sandbox unless the gate passes it in `extra`.
pub fn environment(
    extra: &[(String, String)],
    path_dirs: &[String],
) -> Result<Vec<String>, BundleError> {
    let mut env = vec![
        // The programs of the toolset come first, then the folders of its trees.
        std::iter::once("PATH=/usr/bin:/bin".to_string())
            .chain(path_dirs.iter().cloned())
            .collect::<Vec<_>>()
            .join(":"),
        "HOME=/tmp".to_string(),
        "TMPDIR=/tmp".to_string(),
        "LANG=C.UTF-8".to_string(),
    ];
    for (name, value) in extra {
        let plain = !name.is_empty()
            && !name.as_bytes()[0].is_ascii_digit()
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
        if !plain {
            return Err(BundleError::EnvName(name.clone()));
        }
        if value.contains('\0') {
            return Err(BundleError::ZeroByte("a variable of the environment"));
        }
        env.retain(|entry| !entry.starts_with(&format!("{name}=")));
        env.push(format!("{name}={value}"));
    }
    Ok(env)
}

/// Writes the `config.json` of one command.
pub fn config(plan: &SandboxPlan, input: &BundleInput<'_>) -> Result<Value, BundleError> {
    if input.args.is_empty() || input.args[0].is_empty() {
        return Err(BundleError::EmptyCommand);
    }
    if input.args.iter().any(|arg| arg.contains('\0')) {
        return Err(BundleError::ZeroByte("the command"));
    }
    if !plain_path(input.cwd) {
        return Err(BundleError::Cwd(input.cwd.to_string()));
    }
    let env = environment(input.extra_env, input.path_dirs)?;

    let mut mounts = vec![
        json!({"destination": "/proc", "type": "proc", "source": "proc"}),
        json!({"destination": "/dev", "type": "tmpfs", "source": "tmpfs", "options": ["nosuid", "noexec"]}),
        json!({
            "destination": "/tmp",
            "type": "tmpfs",
            "source": "tmpfs",
            "options": ["nosuid", "nodev", "noexec", format!("size={}", input.limits.tmp_bytes)],
        }),
    ];
    // A tree of the toolset is a folder of the host, read only. Its programs may
    // run: a compiler is of no use otherwise.
    for (source, path) in input.trees {
        mounts.push(json!({
            "destination": path,
            "type": "bind",
            "source": source,
            "options": ["bind", "ro", "nosuid", "nodev"],
        }));
    }
    for mount in &plan.mounts {
        match mount.mode {
            MountMode::Mask => {
                if input.existing_masks.contains(&mount.path) {
                    mounts.push(json!({
                        "destination": mount.path,
                        "type": "tmpfs",
                        "source": "tmpfs",
                        "options": ["ro", "nosuid", "nodev", "noexec", "size=4096"],
                    }));
                }
            }
            MountMode::ReadOnly | MountMode::ReadWrite => {
                let mut options = vec!["bind", "nosuid", "nodev"];
                options.push(if mount.mode == MountMode::ReadWrite {
                    "rw"
                } else {
                    "ro"
                });
                if !mount.exec {
                    options.push("noexec");
                }
                mounts.push(json!({
                    "destination": mount.path,
                    "type": "bind",
                    "source": mount.path,
                    "options": options,
                }));
            }
        }
    }
    if let Some(dir) = input.egress_dir {
        mounts.push(json!({
            "destination": EGRESS_DIR,
            "type": "bind",
            "source": dir,
            "options": ["bind", "rw", "nosuid", "nodev", "noexec"],
        }));
    }

    let none: [&str; 0] = [];
    Ok(json!({
        "ociVersion": "1.0.0",
        "hostname": "caw",
        "root": {"path": input.root, "readonly": true},
        "process": {
            "terminal": false,
            "user": {"uid": 0, "gid": 0},
            "args": input.args,
            "env": env,
            "cwd": input.cwd,
            "noNewPrivileges": true,
            "capabilities": {
                "bounding": none,
                "effective": none,
                "inheritable": none,
                "permitted": none,
                "ambient": none,
            },
            "rlimits": [
                {"type": "RLIMIT_NOFILE", "hard": input.limits.open_files, "soft": input.limits.open_files},
                {"type": "RLIMIT_NPROC", "hard": input.limits.processes, "soft": input.limits.processes},
                {"type": "RLIMIT_CORE", "hard": 0, "soft": 0},
            ],
        },
        "mounts": mounts,
        "linux": {
            "namespaces": [
                {"type": "pid"},
                {"type": "network"},
                {"type": "ipc"},
                {"type": "uts"},
                {"type": "mount"},
            ],
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_caw_policy::plan::PlanMount;

    fn plan(compiled_runtime: bool) -> SandboxPlan {
        let mount = |path: &str, mode: MountMode| PlanMount {
            path: path.to_string(),
            mode,
            exec: compiled_runtime && mode != MountMode::Mask,
            rule: "rule".to_string(),
        };
        SandboxPlan {
            profile_id: "test".to_string(),
            record_digest: "sha256:r".to_string(),
            compiled_runtime,
            mounts: vec![
                mount("/home/agent/project", MountMode::ReadWrite),
                mount("/home/agent/project/.secrets", MountMode::Mask),
                mount("/home/agent/project/vendor", MountMode::Mask),
                mount("/srv/config", MountMode::ReadOnly),
            ],
            programs: Vec::new(),
            trees: Vec::new(),
            routes: Vec::new(),
            digest: "sha256:p".to_string(),
        }
    }

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn built(plan: &SandboxPlan, masks: &[&str], egress: Option<&str>) -> Value {
        let command = args(&["sh", "-c", "true"]);
        let masks: BTreeSet<String> = masks.iter().map(|s| s.to_string()).collect();
        config(
            plan,
            &BundleInput {
                args: &command,
                cwd: "/home/agent/project",
                root: "/var/lib/caw/s1/rootfs",
                existing_masks: &masks,
                egress_dir: egress,
                extra_env: &[],
                trees: &[],
                path_dirs: &[],
                limits: Limits::default(),
            },
        )
        .expect("config")
    }

    fn mount_at<'a>(config: &'a Value, destination: &str) -> Option<&'a Value> {
        config["mounts"]
            .as_array()
            .expect("mounts")
            .iter()
            .find(|m| m["destination"] == destination)
    }

    fn options(mount: &Value) -> Vec<&str> {
        mount["options"]
            .as_array()
            .expect("options")
            .iter()
            .map(|o| o.as_str().expect("text"))
            .collect()
    }

    #[test]
    fn the_root_is_read_only_and_the_process_has_no_privilege() {
        let config = built(&plan(false), &[], None);
        assert_eq!(
            config["root"],
            json!({"path": "/var/lib/caw/s1/rootfs", "readonly": true})
        );
        assert_eq!(config["process"]["noNewPrivileges"], true);
        for set in [
            "bounding",
            "effective",
            "inheritable",
            "permitted",
            "ambient",
        ] {
            assert_eq!(config["process"]["capabilities"][set], json!([]), "{set}");
        }
        assert_eq!(config["process"]["terminal"], false);
        assert_eq!(config["process"]["args"], json!(["sh", "-c", "true"]));
        assert_eq!(config["process"]["cwd"], "/home/agent/project");
    }

    #[test]
    fn the_sandbox_has_its_own_namespaces_and_a_network_namespace() {
        let config = built(&plan(false), &[], None);
        let kinds: Vec<&str> = config["linux"]["namespaces"]
            .as_array()
            .expect("namespaces")
            .iter()
            .map(|n| n["type"].as_str().expect("type"))
            .collect();
        assert_eq!(kinds, vec!["pid", "network", "ipc", "uts", "mount"]);
    }

    #[test]
    fn the_environment_is_built_from_nothing() {
        let config = built(&plan(false), &[], None);
        assert_eq!(
            config["process"]["env"],
            json!([
                "PATH=/usr/bin:/bin",
                "HOME=/tmp",
                "TMPDIR=/tmp",
                "LANG=C.UTF-8"
            ])
        );
        let extra = vec![
            (
                "HTTPS_PROXY".to_string(),
                "http://localhost:3128".to_string(),
            ),
            ("HOME".to_string(), "/home/agent/project".to_string()),
        ];
        assert_eq!(
            environment(&extra, &[]),
            Ok(vec![
                "PATH=/usr/bin:/bin".to_string(),
                "TMPDIR=/tmp".to_string(),
                "LANG=C.UTF-8".to_string(),
                "HTTPS_PROXY=http://localhost:3128".to_string(),
                "HOME=/home/agent/project".to_string(),
            ])
        );
        for name in ["", "1A", "A=B", "A B", "LD-PRELOAD"] {
            let bad = vec![(name.to_string(), "x".to_string())];
            assert_eq!(
                environment(&bad, &[]),
                Err(BundleError::EnvName(name.to_string()))
            );
        }
        let zero = vec![("A".to_string(), "x\0y".to_string())];
        assert!(matches!(
            environment(&zero, &[]),
            Err(BundleError::ZeroByte(_))
        ));
    }

    #[test]
    fn mounts_follow_the_plan_and_a_workspace_program_does_not_run() {
        let config = built(&plan(false), &["/home/agent/project/.secrets"], None);
        let project = mount_at(&config, "/home/agent/project").expect("project");
        assert_eq!(project["type"], "bind");
        assert_eq!(project["source"], "/home/agent/project");
        assert_eq!(
            options(project),
            vec!["bind", "nosuid", "nodev", "rw", "noexec"]
        );
        let cfg = mount_at(&config, "/srv/config").expect("config");
        assert_eq!(
            options(cfg),
            vec!["bind", "nosuid", "nodev", "ro", "noexec"]
        );
        let mask = mount_at(&config, "/home/agent/project/.secrets").expect("mask");
        assert_eq!(mask["type"], "tmpfs");
        assert!(options(mask).contains(&"ro"));
        assert!(mount_at(&config, "/home/agent/project/vendor").is_none());
        let order: Vec<&str> = config["mounts"]
            .as_array()
            .expect("mounts")
            .iter()
            .map(|m| m["destination"].as_str().expect("text"))
            .collect();
        assert_eq!(
            order,
            vec![
                "/proc",
                "/dev",
                "/tmp",
                "/home/agent/project",
                "/home/agent/project/.secrets",
                "/srv/config"
            ]
        );
    }

    #[test]
    fn a_profile_that_runs_workspace_programs_mounts_them_without_noexec() {
        let config = built(&plan(true), &[], None);
        let project = mount_at(&config, "/home/agent/project").expect("project");
        assert_eq!(options(project), vec!["bind", "nosuid", "nodev", "rw"]);
        assert!(options(mount_at(&config, "/tmp").expect("tmp")).contains(&"noexec"));
    }

    #[test]
    fn a_tree_is_mounted_read_only_before_the_mounts_of_the_plan_and_joins_the_path() {
        let command = args(&["cargo", "test"]);
        let masks = BTreeSet::new();
        let trees = vec![(
            "/opt/rust/stable".to_string(),
            "/usr/local/rust".to_string(),
        )];
        let path_dirs = vec!["/usr/local/rust/bin".to_string()];
        let p = plan(true);
        let config = config(
            &p,
            &BundleInput {
                args: &command,
                cwd: "/home/agent/project",
                root: "/r",
                existing_masks: &masks,
                egress_dir: None,
                extra_env: &[],
                trees: &trees,
                path_dirs: &path_dirs,
                limits: Limits::default(),
            },
        )
        .expect("config");
        let tree = mount_at(&config, "/usr/local/rust").expect("tree");
        assert_eq!(tree["source"], "/opt/rust/stable");
        assert_eq!(options(tree), vec!["bind", "ro", "nosuid", "nodev"]);
        let order: Vec<&str> = config["mounts"]
            .as_array()
            .expect("mounts")
            .iter()
            .map(|m| m["destination"].as_str().expect("text"))
            .collect();
        assert_eq!(
            order[..5],
            [
                "/proc",
                "/dev",
                "/tmp",
                "/usr/local/rust",
                "/home/agent/project"
            ]
        );
        assert_eq!(
            config["process"]["env"][0],
            "PATH=/usr/bin:/bin:/usr/local/rust/bin"
        );
    }

    #[test]
    fn the_egress_socket_folder_is_mounted_only_when_given() {
        assert!(mount_at(&built(&plan(false), &[], None), EGRESS_DIR).is_none());
        let config = built(&plan(false), &[], Some("/var/lib/caw/s1/run/c1"));
        let egress = mount_at(&config, EGRESS_DIR).expect("egress");
        assert_eq!(egress["source"], "/var/lib/caw/s1/run/c1");
        assert!(options(egress).contains(&"noexec"));
    }

    #[test]
    fn tmp_has_its_size_bound_and_the_limits_are_written() {
        let config = built(&plan(false), &[], None);
        assert!(options(mount_at(&config, "/tmp").expect("tmp")).contains(&"size=268435456"));
        assert_eq!(
            config["process"]["rlimits"],
            json!([
                {"type": "RLIMIT_NOFILE", "hard": 1024, "soft": 1024},
                {"type": "RLIMIT_NPROC", "hard": 256, "soft": 256},
                {"type": "RLIMIT_CORE", "hard": 0, "soft": 0},
            ])
        );
    }

    #[test]
    fn a_command_or_folder_that_is_not_plain_is_refused() {
        let masks = BTreeSet::new();
        let make = |command: Vec<String>, cwd: &'static str| {
            let p = plan(false);
            config(
                &p,
                &BundleInput {
                    args: &command,
                    cwd,
                    root: "/r",
                    existing_masks: &masks,
                    egress_dir: None,
                    extra_env: &[],
                    trees: &[],
                    path_dirs: &[],
                    limits: Limits::default(),
                },
            )
        };
        assert_eq!(make(Vec::new(), "/"), Err(BundleError::EmptyCommand));
        assert_eq!(make(args(&[""]), "/"), Err(BundleError::EmptyCommand));
        assert_eq!(
            make(args(&["sh", "a\0b"]), "/"),
            Err(BundleError::ZeroByte("the command"))
        );
        for cwd in ["", "relative", "/a/../b", "/a//b", "/a/"] {
            assert_eq!(
                make(args(&["sh"]), cwd),
                Err(BundleError::Cwd(cwd.to_string()))
            );
        }
        assert!(make(args(&["sh"]), "/").is_ok());
    }

    #[test]
    fn the_same_plan_and_command_give_the_same_bundle() {
        assert_eq!(
            built(&plan(false), &["/home/agent/project/vendor"], None),
            built(&plan(false), &["/home/agent/project/vendor"], None)
        );
    }
}
