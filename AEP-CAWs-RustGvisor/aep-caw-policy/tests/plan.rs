//! What compiles and what is refused. One test per row of the table of the plan,
//! then the precedence rule and the other refusals.

// Test code may use expect: a failed expect here is a failed test.
#![allow(clippy::expect_used)]

mod common;

use aep_caw_policy::plan::{compile, plan_digest, MountMode, PlanMount, SandboxPlan, Variables};
use aep_caw_policy::record::parse_record;
use aep_caw_policy::route::Scheme;
use aep_caw_policy::PolicyError;
use common::*;

const ROOT: &str = "/home/agent/project";

fn modes(plan: &SandboxPlan) -> Vec<(&str, MountMode)> {
    plan.mounts
        .iter()
        .map(|m| (m.path.as_str(), m.mode))
        .collect()
}

// Row 1: allow read, list and stat on a folder tree.
#[test]
fn an_allow_of_the_read_operations_is_a_read_only_mount() {
    let mut p = profile();
    p.mounts = vec![mount(
        "${PROJECT_ROOT}",
        vec![file_rule(
            "allow-read",
            &["${MOUNT_PATH}", "${MOUNT_PATH}/**"],
            &READ,
            "allow",
        )],
    )];
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(
        plan.mounts,
        vec![PlanMount {
            path: ROOT.to_string(),
            mode: MountMode::ReadOnly,
            exec: false,
            rule: "allow-read".to_string(),
        }]
    );
}

// Row 2: allow read and every write operation on a folder tree.
#[test]
fn an_allow_of_read_and_every_write_operation_is_a_read_write_mount() {
    let plan = compile(&profile(), &vars()).expect("compiles");
    assert_eq!(modes(&plan), vec![(ROOT, MountMode::ReadWrite)]);
    let mut star = profile();
    star.mounts = vec![mount(
        "${PROJECT_ROOT}",
        vec![file_rule(
            "allow-all",
            &["${MOUNT_PATH}/**"],
            &["*"],
            "allow",
        )],
    )];
    assert_eq!(
        modes(&compile(&star, &vars()).expect("compiles")),
        vec![(ROOT, MountMode::ReadWrite)]
    );
}

// Row 3: deny every operation on a path under an allowed tree.
#[test]
fn a_deny_of_everything_below_an_allowed_tree_is_a_mask() {
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![file_rule(
            "deny-secrets",
            &["${PROJECT_ROOT}/.secrets/**"],
            &["*"],
            "deny",
        )],
    );
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(
        modes(&plan),
        vec![
            (ROOT, MountMode::ReadWrite),
            ("/home/agent/project/.secrets", MountMode::Mask)
        ]
    );
    assert_eq!(plan.mounts[1].rule, "deny-secrets");
    assert!(!plan.mounts[1].exec);
}

// Row 4: deny write operations on a tree that an allow rule reads.
#[test]
fn a_deny_of_the_write_operations_on_a_read_tree_is_a_read_only_mount() {
    let mut p = profile();
    p.mounts = vec![mount(
        "/srv/config",
        vec![
            file_rule(
                "allow-config-read",
                &["${MOUNT_PATH}", "${MOUNT_PATH}/**"],
                &READ,
                "allow",
            ),
            file_rule("deny-config-write", &["${MOUNT_PATH}/**"], &WRITE, "deny"),
        ],
    )];
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(modes(&plan), vec![("/srv/config", MountMode::ReadOnly)]);
}

// Row 5: a path of the host that no rule allows.
#[test]
fn a_path_that_no_rule_allows_is_not_in_the_plan() {
    let plan = compile(&profile(), &vars()).expect("compiles");
    assert!(plan.mount_of("/home/agent/.ssh/id_ed25519").is_none());
    assert!(plan.mount_of("/home/agent/project-other/file").is_none());
    assert!(plan.mount_of("/home/agent").is_none());
    assert_eq!(
        plan.mount_of("/home/agent/project/src/main.rs")
            .map(|m| m.mode),
        Some(MountMode::ReadWrite)
    );
}

// Rows 6 and 7: compiled_runtime decides whether a program in a mount may run.
#[test]
fn compiled_runtime_decides_the_exec_flag_of_the_mounts() {
    let mut p = profile();
    assert!(compile(&p, &vars())
        .expect("compiles")
        .mounts
        .iter()
        .all(|m| !m.exec));
    p.compiled_runtime = true;
    let plan = compile(&p, &vars()).expect("compiles");
    assert!(plan.compiled_runtime);
    assert!(plan.mounts.iter().all(|m| m.exec));
}

// Row 8: command_rules deny for a program name.
#[test]
fn a_denied_program_in_the_toolset_refuses_the_session() {
    let mut p = profile();
    p.base_policy.command_rules = vec![command_rule(
        "deny-privilege-escalation",
        &["sudo", "su"],
        "deny",
    )];
    assert!(compile(&p, &vars()).is_ok());
    p.toolset.programs.push(program("sudo"));
    assert_eq!(
        compile(&p, &vars()),
        Err(PolicyError::DeniedProgram {
            rule: "deny-privilege-escalation".to_string(),
            program: "sudo".to_string(),
        })
    );
    let mut in_mount = profile();
    in_mount.mounts[0].policy.command_rules = vec![command_rule("no-cat", &["cat"], "deny")];
    assert!(matches!(
        compile(&in_mount, &vars()),
        Err(PolicyError::DeniedProgram { .. })
    ));
}

// Row 9: decision soft_delete or approve.
#[test]
fn a_decision_other_than_allow_or_deny_is_refused_with_its_rule() {
    for decision in ["soft_delete", "approve", "audit", ""] {
        let mut p = profile();
        p.mounts[0].policy.file_rules.push(file_rule(
            "soft-delete-project",
            &["${MOUNT_PATH}/**"],
            &WRITE,
            decision,
        ));
        assert_eq!(
            compile(&p, &vars()),
            Err(PolicyError::UnsupportedDecision {
                rule: "soft-delete-project".to_string(),
                decision: decision.to_string(),
            })
        );
        let mut c = profile();
        c.base_policy.command_rules = vec![command_rule("ask-first", &["git"], decision)];
        assert!(matches!(
            compile(&c, &vars()),
            Err(PolicyError::UnsupportedDecision { .. })
        ));
    }
}

// Row 10: a rule that allows some write operations and denies others.
#[test]
fn a_part_of_the_write_or_read_operations_is_refused() {
    let cases: [(&[&str], &str, &str); 6] = [
        (
            &["read", "list", "stat", "write", "create", "mkdir"],
            "allow",
            "write",
        ),
        (&["read", "list", "stat", "chmod"], "allow", "write"),
        (&["read"], "allow", "read"),
        (
            &["write", "create", "mkdir", "delete", "rename"],
            "allow",
            "read",
        ),
        (&["delete", "rename"], "deny", "write"),
        (
            &["read", "write", "create", "mkdir", "delete", "rename"],
            "deny",
            "read",
        ),
    ];
    for (operations, decision, class) in cases {
        let mut p = profile();
        p.mounts = vec![mount(
            "${PROJECT_ROOT}",
            vec![file_rule(
                "partial",
                &["${MOUNT_PATH}"],
                operations,
                decision,
            )],
        )];
        assert_eq!(
            compile(&p, &vars()),
            Err(PolicyError::PartialOperations {
                rule: "partial".to_string(),
                class
            }),
            "{operations:?} {decision}"
        );
    }
    let mut unknown = profile();
    unknown.mounts[0].policy.file_rules[0]
        .operations
        .push("teleport".to_string());
    assert!(matches!(
        compile(&unknown, &vars()),
        Err(PolicyError::UnknownOperation { .. })
    ));
}

// Row 11: a pattern that is not a folder tree.
#[test]
fn a_pattern_that_is_not_a_folder_tree_is_refused() {
    for pattern in [
        "${MOUNT_PATH}/**/*.env",
        "${MOUNT_PATH}/*",
        "${MOUNT_PATH}/src/*.rs",
        "${MOUNT_PATH}/**/secrets/**",
        "${MOUNT_PATH}/file?",
        "${MOUNT_PATH}/[ab]",
        "/**",
    ] {
        let mut p = profile();
        p.mounts[0]
            .policy
            .file_rules
            .push(file_rule("deny-env", &[pattern], &["*"], "deny"));
        let result = compile(&p, &vars());
        assert!(
            matches!(
                result,
                Err(PolicyError::PatternNotATree { .. }) | Err(PolicyError::BadPath { .. })
            ),
            "{pattern}: {result:?}"
        );
    }
}

// Row 12: a variable the call does not supply.
#[test]
fn a_variable_the_call_does_not_supply_is_refused() {
    assert_eq!(
        compile(&profile(), &Variables::new()),
        Err(PolicyError::MissingVariable {
            place: "mount 1 of the profile".to_string(),
            name: "PROJECT_ROOT".to_string(),
        })
    );
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![file_rule("deny-keys", &["${HOME}/.ssh/**"], &["*"], "deny")],
    );
    assert!(matches!(
        compile(&p, &Variables::new().with("PROJECT_ROOT", ROOT)),
        Err(PolicyError::MissingVariable { name, .. }) if name == "HOME"
    ));
    let mut base = profile();
    base.base_policy = policy(
        "base",
        vec![file_rule(
            "needs-mount",
            &["${MOUNT_PATH}/x"],
            &["*"],
            "deny",
        )],
    );
    assert!(
        matches!(compile(&base, &vars()), Err(PolicyError::MissingVariable { name, .. }) if name == "MOUNT_PATH")
    );
    for broken in [
        "${project}/x",
        "$PROJECT_ROOT/x",
        "${PROJECT_ROOT/x",
        "${}/x",
    ] {
        let mut b = profile();
        b.mounts[0].path = broken.to_string();
        assert!(
            matches!(compile(&b, &vars()), Err(PolicyError::BadPath { .. })),
            "{broken}"
        );
    }
}

// Row 13: a key the record schema does not know.
#[test]
fn a_key_the_record_does_not_know_is_refused() {
    let text = include_str!("fixtures/restricted.json");
    assert!(parse_record(text).is_ok());
    for (at, extra) in [
        ("{", "\"approval\":\"ask\","),
        ("\"routes\":[{", "\"path\":\"/v1\","),
        ("\"programs\":[{", "\"sha256\":\"x\","),
    ] {
        let changed = text.replacen(at, &format!("{at}{extra}"), 1);
        let mut value: serde_json::Value = serde_json::from_str(&changed).expect("json");
        let digest = aep_caw_policy::canonical::digest_without_field(&value);
        value["digest"] = serde_json::Value::String(digest);
        let result = parse_record(&value.to_string());
        assert!(
            matches!(&result, Err(PolicyError::Shape(m)) if m.contains("unknown field")),
            "{extra}: {result:?}"
        );
    }
}

#[test]
fn a_deny_wins_over_an_allow_on_the_same_path() {
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![file_rule(
            "deny-project",
            &["${PROJECT_ROOT}/**"],
            &["*"],
            "deny",
        )],
    );
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(modes(&plan), vec![(ROOT, MountMode::Mask)]);
    assert_eq!(plan.mounts[0].rule, "deny-project");
}

#[test]
fn the_rule_on_the_longer_path_wins_and_is_mounted_later() {
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![
            file_rule(
                "deny-vendor",
                &["${PROJECT_ROOT}/vendor/**"],
                &["*"],
                "deny",
            ),
            file_rule(
                "allow-vendor-docs",
                &["${PROJECT_ROOT}/vendor/docs/**"],
                &READ,
                "allow",
            ),
            file_rule(
                "deny-write-src",
                &["${PROJECT_ROOT}/src/**"],
                &WRITE,
                "deny",
            ),
        ],
    );
    p.mounts.push(rw_mount("/home/agent/project-b"));
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(
        modes(&plan),
        vec![
            (ROOT, MountMode::ReadWrite),
            ("/home/agent/project/src", MountMode::ReadOnly),
            ("/home/agent/project/vendor", MountMode::Mask),
            ("/home/agent/project/vendor/docs", MountMode::ReadOnly),
            ("/home/agent/project-b", MountMode::ReadWrite),
        ]
    );
    assert_eq!(
        plan.mount_of("/home/agent/project/vendor/lib/a.c")
            .map(|m| m.mode),
        Some(MountMode::Mask)
    );
    assert_eq!(
        plan.mount_of("/home/agent/project/vendor/docs/a.md")
            .map(|m| m.mode),
        Some(MountMode::ReadOnly)
    );
    assert_eq!(
        plan.mount_of("/home/agent/project/src/a.rs")
            .map(|m| m.mode),
        Some(MountMode::ReadOnly)
    );
    assert_eq!(
        plan.mount_of("/home/agent/project-b/a")
            .map(|m| m.path.as_str()),
        Some("/home/agent/project-b")
    );
}

#[test]
fn a_deny_below_a_mask_never_shows_what_the_mask_hides() {
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![
            file_rule(
                "deny-vendor",
                &["${PROJECT_ROOT}/vendor/**"],
                &["*"],
                "deny",
            ),
            file_rule(
                "no-write-vendor-lib",
                &["${PROJECT_ROOT}/vendor/lib/**"],
                &WRITE,
                "deny",
            ),
            file_rule(
                "deny-vendor-keys",
                &["${PROJECT_ROOT}/vendor/keys/**"],
                &["*"],
                "deny",
            ),
            file_rule(
                "no-write-docs",
                &["${PROJECT_ROOT}/docs/**"],
                &WRITE,
                "deny",
            ),
            file_rule(
                "no-write-docs-api",
                &["${PROJECT_ROOT}/docs/api/**"],
                &WRITE,
                "deny",
            ),
            file_rule(
                "deny-docs-private",
                &["${PROJECT_ROOT}/docs/private/**"],
                &["*"],
                "deny",
            ),
        ],
    );
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(
        modes(&plan),
        vec![
            (ROOT, MountMode::ReadWrite),
            ("/home/agent/project/docs", MountMode::ReadOnly),
            ("/home/agent/project/docs/private", MountMode::Mask),
            ("/home/agent/project/vendor", MountMode::Mask),
        ]
    );
    assert_eq!(
        plan.mount_of("/home/agent/project/vendor/lib/a.c")
            .map(|m| m.mode),
        Some(MountMode::Mask)
    );
    assert_eq!(
        plan.mount_of("/home/agent/project/vendor/keys/k")
            .map(|m| m.mode),
        Some(MountMode::Mask)
    );
}

#[test]
fn a_deny_on_a_path_that_nothing_allows_adds_no_mount() {
    let mut p = profile();
    p.base_policy = policy(
        "base",
        vec![file_rule(
            "deny-home-secrets",
            &["${HOME}/.ssh/**", "${HOME}/.aws/**"],
            &["*"],
            "deny",
        )],
    );
    let plan = compile(&p, &vars()).expect("compiles");
    assert_eq!(modes(&plan), vec![(ROOT, MountMode::ReadWrite)]);
    let home_is_project = vars().with("PROJECT_ROOT", "/home/agent");
    let plan = compile(&p, &home_is_project).expect("compiles");
    assert_eq!(
        modes(&plan),
        vec![
            ("/home/agent", MountMode::ReadWrite),
            ("/home/agent/.aws", MountMode::Mask),
            ("/home/agent/.ssh", MountMode::Mask),
        ]
    );
}

#[test]
fn a_mount_over_the_root_file_system_of_the_sandbox_is_refused() {
    for path in [
        "/usr",
        "/usr/local/share",
        "/etc",
        "/tmp",
        "/proc/self",
        "/dev",
        "/run/caw",
        "/bin",
        "/lib64",
    ] {
        let result = compile(&profile(), &vars().with("PROJECT_ROOT", path));
        assert!(
            matches!(result, Err(PolicyError::ReservedPath { .. })),
            "{path}: {result:?}"
        );
    }
    for path in [
        "/",
        "relative/path",
        "/a//b",
        "/a/./b",
        "/a/../b",
        "/a/",
        "",
    ] {
        let result = compile(&profile(), &vars().with("PROJECT_ROOT", path));
        assert!(
            matches!(result, Err(PolicyError::BadPath { .. })),
            "{path:?}: {result:?}"
        );
    }
}

#[test]
fn two_mounts_of_one_path_are_refused() {
    let mut p = profile();
    p.mounts.push(rw_mount("/home/agent/project"));
    assert_eq!(
        compile(&p, &vars()),
        Err(PolicyError::DuplicateMount(ROOT.to_string()))
    );
}

#[test]
fn the_toolset_is_checked() {
    let mut empty = profile();
    empty.toolset.programs.clear();
    assert!(matches!(
        compile(&empty, &vars()),
        Err(PolicyError::Program { .. })
    ));
    let changes: [fn(&mut aep_caw_policy::record::Program); 5] = [
        |p| p.source = "bin/sh".to_string(),
        |p| p.source = "/usr/../bin/sh".to_string(),
        |p| p.path = "/home/agent/project/sh".to_string(),
        |p| p.name = "bin/sh".to_string(),
        |p| p.path = "/usr/bin/cat".to_string(),
    ];
    for change in changes {
        let mut p = profile();
        change(&mut p.toolset.programs[0]);
        assert!(matches!(
            compile(&p, &vars()),
            Err(PolicyError::Program { .. })
        ));
    }
}

fn tree(name: &str, source: &str, path: &str, bin: Option<&str>) -> aep_caw_policy::record::Tree {
    aep_caw_policy::record::Tree {
        name: name.to_string(),
        source: source.to_string(),
        path: path.to_string(),
        bin: bin.map(str::to_string),
    }
}

#[test]
fn the_trees_of_a_toolset_are_compiled_with_their_variables() {
    let mut p = profile();
    p.toolset.trees = vec![
        tree("rust", "${RUST_TOOLCHAIN}", "/usr/local/rust", Some("bin")),
        tree(
            "libraries",
            "/usr/lib/x86_64-linux-gnu",
            "/usr/lib/x86_64-linux-gnu",
            None,
        ),
    ];
    assert!(matches!(
        compile(&p, &vars()),
        Err(PolicyError::MissingVariable { name, .. }) if name == "RUST_TOOLCHAIN"
    ));
    let session = vars().with("RUST_TOOLCHAIN", "/opt/rust/stable");
    let plan = compile(&p, &session).expect("compiles");
    assert_eq!(plan.trees.len(), 2);
    assert_eq!(plan.trees[0].source, "/opt/rust/stable");
    assert_eq!(plan.trees[0].path, "/usr/local/rust");
    assert_eq!(plan.trees[0].bin.as_deref(), Some("bin"));
    assert_eq!(plan.trees[1].bin, None);
    let without = compile(&profile(), &session).expect("compiles");
    assert!(without.trees.is_empty());
    assert_ne!(plan.digest, without.digest);
    let moved = vars().with("RUST_TOOLCHAIN", "/opt/rust/other");
    assert_ne!(plan.digest, compile(&p, &moved).expect("compiles").digest);
}

#[test]
fn a_tree_that_is_not_a_plain_folder_of_the_root_is_refused() {
    let cases: [(&str, &str, Option<&str>); 12] = [
        ("relative/rust", "/usr/local/rust", None),
        ("/opt/../etc", "/usr/local/rust", None),
        ("/opt/rust/", "/usr/local/rust", None),
        ("/opt/rust", "/home/agent/rust", None),
        ("/opt/rust", "/etc/rust", None),
        ("/opt/rust", "/tmp/rust", None),
        ("/opt/rust", "/usr", None),
        ("/opt/rust", "/lib64", None),
        ("/opt/rust", "/usr/local/../rust", None),
        ("/opt/rust", "/usr/local/rust", Some("/bin")),
        ("/opt/rust", "/usr/local/rust", Some("../bin")),
        ("/opt/rust", "/usr/local/rust", Some("")),
    ];
    for (source, path, bin) in cases {
        let mut p = profile();
        p.toolset.trees = vec![tree("rust", source, path, bin)];
        let result = compile(&p, &vars());
        assert!(
            matches!(result, Err(PolicyError::Tree { .. })),
            "{source} {path} {bin:?}: {result:?}"
        );
    }
    let mut nested = profile();
    nested.toolset.trees = vec![
        tree("a", "/opt/a", "/usr/local/a", None),
        tree("b", "/opt/b", "/usr/local/a/b", None),
    ];
    assert!(matches!(
        compile(&nested, &vars()),
        Err(PolicyError::Tree { .. })
    ));
    let mut twice = profile();
    twice.toolset.trees = vec![
        tree("a", "/opt/a", "/usr/local/a", None),
        tree("a", "/opt/b", "/usr/local/b", None),
    ];
    assert!(matches!(
        compile(&twice, &vars()),
        Err(PolicyError::Tree { .. })
    ));
    let mut over_program = profile();
    over_program.toolset.trees = vec![tree("bin", "/opt/bin", "/usr/bin", None)];
    assert!(matches!(
        compile(&over_program, &vars()),
        Err(PolicyError::Tree { reason, .. }) if reason.contains("the program sh")
    ));
}

#[test]
fn routes_are_compiled_with_their_variables_and_checked() {
    let mut p = profile();
    p.llm_proxy = true;
    p.egress_policy = Some(egress(vec![route(
        "model-gateway",
        "https",
        "${AEP_MODEL_GATEWAY_HOST}",
        443,
        "allow",
    )]));
    assert!(
        matches!(compile(&p, &vars()), Err(PolicyError::MissingVariable { name, .. }) if name == "AEP_MODEL_GATEWAY_HOST")
    );
    let plan = compile(
        &p,
        &vars().with("AEP_MODEL_GATEWAY_HOST", "Gateway.Example.com."),
    )
    .expect("compiles");
    assert_eq!(plan.routes.len(), 1);
    assert_eq!(plan.routes[0].host, "gateway.example.com");
    assert_eq!(plan.routes[0].scheme, Scheme::Https);
    assert!(plan.routes[0].allow);
    for host in [
        "192.0.2.1",
        "[2001:db8::1]",
        "3221225985",
        "not a host",
        "*",
        "",
    ] {
        let result = compile(&p, &vars().with("AEP_MODEL_GATEWAY_HOST", host));
        assert!(
            matches!(result, Err(PolicyError::Route { .. })),
            "{host:?}: {result:?}"
        );
    }
    let changes: [fn(&mut aep_caw_policy::record::EgressPolicy); 4] = [
        |e| e.unmatched = "allow".to_string(),
        |e| e.routes[0].scheme = "ftp".to_string(),
        |e| e.routes[0].decision = "approve".to_string(),
        |e| e.routes[0].port = 0,
    ];
    for change in changes {
        let mut bad = p.clone();
        if let Some(e) = bad.egress_policy.as_mut() {
            change(e);
        }
        let result = compile(
            &bad,
            &vars().with("AEP_MODEL_GATEWAY_HOST", "gateway.example.com"),
        );
        assert!(
            matches!(result, Err(PolicyError::Route { .. })),
            "{result:?}"
        );
    }
}

#[test]
fn an_open_model_gateway_needs_an_allow_route() {
    let mut p = profile();
    p.llm_proxy = true;
    assert_eq!(compile(&p, &vars()), Err(PolicyError::ProxyWithoutRoute));
    p.egress_policy = Some(egress(vec![route(
        "closed",
        "https",
        "gateway.example.com",
        443,
        "deny",
    )]));
    assert_eq!(compile(&p, &vars()), Err(PolicyError::ProxyWithoutRoute));
    p.llm_proxy = false;
    let plan = compile(&p, &vars()).expect("compiles");
    assert!(!plan.routes[0].allow);
}

#[test]
fn a_profile_with_no_egress_policy_has_no_route() {
    assert!(compile(&profile(), &vars())
        .expect("compiles")
        .routes
        .is_empty());
}

#[test]
fn the_plan_digest_covers_every_part_of_the_plan() {
    let plan = compile(&profile(), &vars()).expect("compiles");
    assert_eq!(plan.digest, plan_digest(&plan).expect("digest"));
    assert_eq!(plan, compile(&profile(), &vars()).expect("compiles"));
    let other_root = compile(
        &profile(),
        &vars().with("PROJECT_ROOT", "/home/agent/other"),
    )
    .expect("compiles");
    assert_ne!(plan.digest, other_root.digest);
    let mut runtime = profile();
    runtime.compiled_runtime = true;
    assert_ne!(
        plan.digest,
        compile(&runtime, &vars()).expect("compiles").digest
    );
    let mut tools = profile();
    tools.toolset.programs.push(program("ls"));
    assert_ne!(
        plan.digest,
        compile(&tools, &vars()).expect("compiles").digest
    );
    let mut record = profile();
    record.digest = "sha256:other".to_string();
    assert_ne!(
        plan.digest,
        compile(&record, &vars()).expect("compiles").digest
    );
}
