//! Builders for the tests of the policy engine.
#![allow(dead_code)]

use aep_caw_policy::plan::Variables;
use aep_caw_policy::record::{
    CommandRule, EgressPolicy, FileRule, Mount, Policy, Program, ResolvedProfile, Route, Toolset,
};

pub const READ: [&str; 3] = ["read", "list", "stat"];
pub const ALL: [&str; 8] = [
    "read", "list", "stat", "write", "create", "mkdir", "delete", "rename",
];
pub const WRITE: [&str; 5] = ["write", "create", "mkdir", "delete", "rename"];

pub fn file_rule(name: &str, paths: &[&str], operations: &[&str], decision: &str) -> FileRule {
    FileRule {
        name: name.to_string(),
        paths: paths.iter().map(|s| s.to_string()).collect(),
        operations: operations.iter().map(|s| s.to_string()).collect(),
        decision: decision.to_string(),
    }
}

pub fn command_rule(name: &str, commands: &[&str], decision: &str) -> CommandRule {
    CommandRule {
        name: name.to_string(),
        commands: commands.iter().map(|s| s.to_string()).collect(),
        decision: decision.to_string(),
    }
}

pub fn policy(name: &str, file_rules: Vec<FileRule>) -> Policy {
    Policy {
        name: name.to_string(),
        file_rules,
        command_rules: Vec::new(),
    }
}

pub fn mount(path: &str, file_rules: Vec<FileRule>) -> Mount {
    Mount {
        path: path.to_string(),
        policy: policy("mount-policy", file_rules),
    }
}

/// A mount whose tree is read write.
pub fn rw_mount(path: &str) -> Mount {
    mount(
        path,
        vec![file_rule(
            "allow-rw",
            &["${MOUNT_PATH}", "${MOUNT_PATH}/**"],
            &ALL,
            "allow",
        )],
    )
}

pub fn program(name: &str) -> Program {
    Program {
        name: name.to_string(),
        source: format!("/usr/bin/{name}"),
        path: format!("/usr/bin/{name}"),
    }
}

pub fn route(name: &str, scheme: &str, host: &str, port: u16, decision: &str) -> Route {
    Route {
        name: name.to_string(),
        scheme: scheme.to_string(),
        host: host.to_string(),
        port,
        decision: decision.to_string(),
    }
}

pub fn egress(routes: Vec<Route>) -> EgressPolicy {
    EgressPolicy {
        name: "egress".to_string(),
        unmatched: "deny".to_string(),
        routes,
    }
}

/// A profile with one read write mount at the project root, the programs sh and
/// cat and no network.
pub fn profile() -> ResolvedProfile {
    ResolvedProfile {
        record: "aep.caw.resolved_profile".to_string(),
        version: 1,
        profile_id: "test".to_string(),
        gap_address: Some("dev.test/test.v1".to_string()),
        enforcement_tier: "gvisor".to_string(),
        llm_proxy: false,
        compiled_runtime: false,
        base_policy: policy("base", Vec::new()),
        mounts: vec![rw_mount("${PROJECT_ROOT}")],
        egress_policy: None,
        toolset: Toolset {
            name: "tools".to_string(),
            programs: vec![program("sh"), program("cat")],
        },
        digest: "sha256:test".to_string(),
    }
}

/// The variables of a usual session.
pub fn vars() -> Variables {
    Variables::new()
        .with("PROJECT_ROOT", "/home/agent/project")
        .with("HOME", "/home/agent")
}
