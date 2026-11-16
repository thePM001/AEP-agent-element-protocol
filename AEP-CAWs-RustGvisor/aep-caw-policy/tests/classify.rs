//! Which reported failure is a refusal of the policy.

// Test code may use expect: a failed expect here is a failed test.
#![allow(clippy::expect_used)]

mod common;

use aep_caw_policy::classify::{Classifier, DenyEvent, DenyKind, Observation};
use aep_caw_policy::plan::{compile, SandboxPlan};
use common::*;

const ENOENT: i64 = 2;
const EROFS: i64 = 30;
const ENETUNREACH: i64 = 101;

/// A plan with a read write project, a read only config folder and a mask.
fn plan(compiled_runtime: bool) -> SandboxPlan {
    let mut p = profile();
    p.compiled_runtime = compiled_runtime;
    p.base_policy = policy(
        "base",
        vec![file_rule(
            "deny-secrets",
            &["${PROJECT_ROOT}/.secrets/**"],
            &["*"],
            "deny",
        )],
    );
    p.mounts.push(mount(
        "/srv/config",
        vec![file_rule(
            "allow-config-read",
            &["${MOUNT_PATH}/**"],
            &READ,
            "allow",
        )],
    ));
    compile(&p, &vars()).expect("compiles")
}

fn open(path: &str, errno: i64) -> Observation {
    Observation::OpenFailed {
        path: path.to_string(),
        errno,
        process: "cat".to_string(),
        thread_group: 7,
    }
}

fn asked(path: &str, thread_group: i32) -> Observation {
    Observation::ExecAsked {
        path: path.to_string(),
        process: "sh".to_string(),
        thread_group,
    }
}

fn connect(address: &[u8], errno: i64) -> Observation {
    Observation::ConnectFailed {
        address: address.to_vec(),
        errno,
        process: "curl".to_string(),
        thread_group: 9,
    }
}

fn inet(ip: [u8; 4], port: u16) -> Vec<u8> {
    let mut a = vec![2, 0];
    a.extend_from_slice(&port.to_be_bytes());
    a.extend_from_slice(&ip);
    a.extend_from_slice(&[0; 8]);
    a
}

fn kinds(events: &[DenyEvent]) -> Vec<(DenyKind, &str)> {
    events.iter().map(|e| (e.kind, e.target.as_str())).collect()
}

#[test]
fn a_failed_open_outside_the_plan_is_one_deny_event() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let event = c
        .observe(open("/home/agent/.ssh/id_ed25519", ENOENT))
        .expect("deny");
    assert_eq!(
        event,
        DenyEvent {
            kind: DenyKind::FileOutside,
            target: "/home/agent/.ssh/id_ed25519".to_string(),
            process: "cat".to_string(),
            errno: ENOENT,
            rule: String::new(),
        }
    );
    assert_eq!(c.observe(open("/home/agent/.ssh/id_ed25519", ENOENT)), None);
    assert_eq!(c.observe(open("/home/agent/.ssh/id_ed25519", ENOENT)), None);
    assert!(c.finish().is_empty());
}

#[test]
fn a_missing_file_in_the_root_or_in_a_mount_is_no_deny_event() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    for path in [
        "/etc/ld.so.cache",
        "/lib/x86_64-linux-gnu/glibc-hwcaps/x86-64-v3/libc.so.6",
        "/usr/share/locale/en/messages.mo",
        "/dev/kmsg",
        "/tmp/scratch",
        "/var/run/nscd/socket",
        "/home/agent/project/missing.txt",
        "/srv/config/missing.toml",
    ] {
        assert_eq!(c.observe(open(path, ENOENT)), None, "{path}");
    }
}

#[test]
fn a_failed_open_below_a_mask_names_the_rule() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let event = c
        .observe(open("/home/agent/project/.secrets/token", ENOENT))
        .expect("deny");
    assert_eq!(event.kind, DenyKind::FileMasked);
    assert_eq!(event.rule, "deny-secrets");
}

#[test]
fn a_refused_write_below_a_read_only_mount_names_the_rule() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let event = c
        .observe(open("/srv/config/app.toml", EROFS))
        .expect("deny");
    assert_eq!(event.kind, DenyKind::FileReadOnly);
    assert_eq!(event.rule, "allow-config-read");
    assert_eq!(c.observe(open("/home/agent/project/a", 13)), None);
}

#[test]
fn one_target_gives_one_event_per_process() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let other = Observation::OpenFailed {
        path: "/outside/a".to_string(),
        errno: ENOENT,
        process: "head".to_string(),
        thread_group: 8,
    };
    assert!(c.observe(open("/outside/a", ENOENT)).is_some());
    assert!(c.observe(other.clone()).is_some());
    assert!(c.observe(other).is_none());
    assert!(c.observe(open("/outside/b", ENOENT)).is_some());
}

#[test]
fn a_path_is_judged_as_the_path_it_names() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    // A path that is not absolute starts from a folder the classifier does not know.
    for path in ["", "relative/file", "../outside/secret"] {
        assert_eq!(c.observe(open(path, ENOENT)), None, "{path:?}");
    }
    // Parent steps that end inside the root or inside a mount name a plain missing file.
    for path in [
        "/a/../etc/passwd",
        "/home/agent/project/src/../missing",
        "/usr//lib/./x",
    ] {
        assert_eq!(c.observe(open(path, ENOENT)), None, "{path:?}");
    }
    // Parent steps out of a mount name a file outside of the plan.
    let event = c
        .observe(open("/home/agent/project/../.ssh/id_ed25519", ENOENT))
        .expect("deny");
    assert_eq!(event.kind, DenyKind::FileOutside);
    assert_eq!(event.target, "/home/agent/.ssh/id_ed25519");
    // The same file in another spelling is the same target and gives no second event.
    assert_eq!(
        c.observe(open("/home/agent//project/./../.ssh/id_ed25519", ENOENT)),
        None
    );
    // Parent steps into a mask name the masked file.
    let masked = c
        .observe(open("/home/agent/project/src/../.secrets/token", ENOENT))
        .expect("deny");
    assert_eq!(masked.kind, DenyKind::FileMasked);
    assert_eq!(masked.target, "/home/agent/project/.secrets/token");
    // More parent steps than folders end at the root.
    let root = c.observe(open("/../../outside/a", ENOENT)).expect("deny");
    assert_eq!(root.target, "/outside/a");
}

#[test]
fn an_exec_that_was_asked_for_and_never_loaded_is_denied_at_the_end() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    assert_eq!(c.observe(asked("/usr/bin/cat", 10)), None);
    assert_eq!(
        c.observe(Observation::ExecLoaded { thread_group: 10 }),
        None
    );
    assert_eq!(c.observe(asked("/opt/outside/tool", 11)), None);
    assert_eq!(c.observe(asked("/home/agent/project/build/app", 12)), None);
    assert_eq!(
        c.observe(asked("/home/agent/project/.secrets/run", 13)),
        None
    );
    let events = c.finish();
    assert_eq!(
        kinds(&events),
        vec![
            (DenyKind::ExecOutside, "/opt/outside/tool"),
            (DenyKind::ExecInMount, "/home/agent/project/build/app"),
            (DenyKind::ExecMasked, "/home/agent/project/.secrets/run"),
        ]
    );
    assert!(events.iter().all(|e| e.errno == 0 && e.process == "sh"));
    assert_eq!(events[1].rule, "allow-rw");
}

#[test]
fn a_shell_that_searches_its_path_is_not_denied() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    c.observe(asked("/usr/local/bin/git", 20));
    c.observe(asked("/usr/bin/git", 20));
    c.observe(Observation::ExecLoaded { thread_group: 20 });
    assert!(c.finish().is_empty());
}

#[test]
fn the_load_clears_the_newest_ask_of_its_own_process_only() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    c.observe(asked("/opt/outside/first", 30));
    c.observe(asked("/usr/bin/cat", 30));
    c.observe(asked("/opt/outside/other", 31));
    c.observe(Observation::ExecLoaded { thread_group: 30 });
    c.observe(Observation::ExecLoaded { thread_group: 99 });
    assert_eq!(
        kinds(&c.finish()),
        vec![
            (DenyKind::ExecOutside, "/opt/outside/first"),
            (DenyKind::ExecOutside, "/opt/outside/other")
        ]
    );
}

#[test]
fn a_program_in_a_mount_may_fail_to_load_when_the_profile_runs_workspace_programs() {
    let plan = plan(true);
    let mut c = Classifier::new(&plan);
    c.observe(asked("/home/agent/project/build/app", 40));
    assert!(c.finish().is_empty());
}

#[test]
fn a_failed_connect_to_an_address_is_one_deny_event() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let event = c
        .observe(connect(&inet([192, 0, 2, 7], 443), ENETUNREACH))
        .expect("deny");
    assert_eq!(event.kind, DenyKind::Connect);
    assert_eq!(event.target, "192.0.2.7:443");
    assert_eq!(event.errno, ENETUNREACH);
    assert_eq!(
        c.observe(connect(&inet([192, 0, 2, 7], 443), ENETUNREACH)),
        None
    );
    assert!(c
        .observe(connect(&inet([192, 0, 2, 7], 80), ENETUNREACH))
        .is_some());

    let mut v6 = vec![10, 0, 0x01, 0xbb, 0, 0, 0, 0];
    v6.extend_from_slice(&[0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    v6.extend_from_slice(&[0; 4]);
    let event = c.observe(connect(&v6, ENETUNREACH)).expect("deny");
    assert_eq!(event.target, "[2001:db8:0:0:0:0:0:1]:443");
}

#[test]
fn loopback_a_pending_connect_and_a_short_address_give_no_event() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    assert_eq!(c.observe(connect(&inet([127, 0, 0, 1], 3128), 111)), None);
    let mut v6 = vec![10, 0, 0, 80, 0, 0, 0, 0];
    v6.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    assert_eq!(c.observe(connect(&v6, 111)), None);
    assert_eq!(c.observe(connect(&inet([192, 0, 2, 7], 443), 115)), None);
    assert_eq!(c.observe(connect(&inet([192, 0, 2, 7], 443), 0)), None);
    assert_eq!(c.observe(connect(&[2, 0, 1], ENETUNREACH)), None);
    assert_eq!(c.observe(connect(&[], ENETUNREACH)), None);
    assert_eq!(c.observe(connect(&[16, 0, 0, 0, 0, 0], ENETUNREACH)), None);
}

#[test]
fn a_unix_socket_is_judged_as_a_path() {
    let plan = plan(false);
    let mut c = Classifier::new(&plan);
    let mut nscd = vec![1, 0];
    nscd.extend_from_slice(b"/var/run/nscd/socket\0\0\0garbage");
    assert_eq!(c.observe(connect(&nscd, ENOENT)), None);
    let mut egress = vec![1, 0];
    egress.extend_from_slice(b"/run/caw/egress.sock\0");
    assert_eq!(c.observe(connect(&egress, 111)), None);
    let mut docker = vec![1, 0];
    docker.extend_from_slice(b"/home/agent/docker.sock");
    let event = c.observe(connect(&docker, ENOENT)).expect("deny");
    assert_eq!(event.kind, DenyKind::FileOutside);
    assert_eq!(event.target, "/home/agent/docker.sock");
}

#[test]
fn every_kind_has_its_name() {
    let names: Vec<&str> = [
        DenyKind::FileOutside,
        DenyKind::FileMasked,
        DenyKind::FileReadOnly,
        DenyKind::ExecOutside,
        DenyKind::ExecMasked,
        DenyKind::ExecInMount,
        DenyKind::Connect,
    ]
    .iter()
    .map(|k| k.name())
    .collect();
    assert_eq!(
        names,
        vec![
            "file-outside",
            "file-masked",
            "file-read-only",
            "exec-outside",
            "exec-masked",
            "exec-in-mount",
            "connect"
        ]
    );
}
