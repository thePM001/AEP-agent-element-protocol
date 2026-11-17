//! Provisional staging of host changes. Every test promotes a draft whose tree holds a
//! deploy manifest on a local bare repository and stages it into a host folder of its
//! own. The user tools are stubs that edit a passwd and a group table of the test.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "integration test crate: a failed unwrap here is a failed test"
)]

use aep_ede::hoststage::{self, core};
use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

fn sh(dir: &Path, cmd: &str) -> String {
    let o = Command::new("bash")
        .arg("-c")
        .arg(cmd)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        o.status.success(),
        "{}: {}",
        cmd,
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

fn exe(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

fn whoami() -> String {
    let uid = aep_ede::privilege::caller_uid().to_string();
    fs::read_to_string("/etc/passwd")
        .unwrap()
        .lines()
        .find_map(|l| {
            let f: Vec<&str> = l.split(':').collect();
            (f.len() > 2 && f[2] == uid).then(|| f[0].to_string())
        })
        .unwrap_or_else(|| "root".to_string())
}

struct T {
    base: PathBuf,
    op: PathBuf,
}

impl T {
    fn host(&self) -> PathBuf {
        self.base.with_file_name(format!(
            "{}-host",
            self.base.file_name().unwrap().to_str().unwrap()
        ))
    }
    fn conf(&self, extra: &str) {
        let b = self.base.display();
        let body = format!(
            "forge: git\ngit_remote: file://{b}/remote\ngit_direct: on\ndefault_owner: owner\nstate_root: {b}/drafts\nrecord_root: {b}/records\nede_user: {u}\nstage_targets: {h}\nuser_tool_dir: {b}/usertools\npasswd_file: {b}/passwd\ngroup_file: {b}/group\nstage_confirm_uids: {uid}\n{x}",
            b = b,
            u = whoami(),
            h = self.host().display(),
            uid = aep_ede::privilege::caller_uid(),
            x = extra
        );
        fs::write(self.op.join("operator.conf"), body).unwrap();
    }
    fn register(&self, agent: &str, grant_stage: bool) {
        let (secret, public) = aep_ede::identity::keygen();
        fs::write(
            self.base.join(format!("{}.seed", agent)),
            format!("{}\n", secret),
        )
        .unwrap();
        fs::create_dir_all(self.op.join("agents")).unwrap();
        fs::write(
            self.op.join("agents").join(format!("{}.pub", agent)),
            format!("{}\n", public),
        )
        .unwrap();
        fs::create_dir_all(self.op.join("profiles")).unwrap();
        let mut profile = aep_ede::profile::template(agent, &["owner/demo".to_string()]);
        if !grant_stage {
            profile = profile.replace(
                &format!("    - agent_id: {}\n      action: ede.stage\n", agent),
                "",
            );
        }
        fs::write(
            self.op.join("profiles").join(format!("{}.gap", agent)),
            profile,
        )
        .unwrap();
    }
    fn act_as(&self, agent: &str) {
        std::env::set_var("AEP_AGENT_ID", agent);
        std::env::set_var("AEP_AGENT_KEY", self.base.join(format!("{}.seed", agent)));
    }
    fn as_operator<R>(&self, f: impl FnOnce() -> R) -> R {
        let agent = std::env::var("AEP_AGENT_ID").unwrap_or_default();
        std::env::remove_var("AEP_AGENT_ID");
        let out = f();
        self.act_as(&agent);
        out
    }
    fn record(&self, draft: &str) -> core::StageRecord {
        let op = aep_ede::operator::load();
        core::read_record(&op, &op.record_root, draft, hoststage::RECORD_SCHEMA)
            .unwrap()
            .unwrap()
    }
}

impl Drop for T {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
        let _ = fs::remove_dir_all(self.host());
    }
}

fn setup(name: &str) -> T {
    let base = std::env::temp_dir().join(format!("aep-ede-stage-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join("op")).unwrap();
    let t = T {
        op: base.join("op"),
        base,
    };
    let _ = fs::remove_dir_all(t.host());
    fs::create_dir_all(t.host().join("bin")).unwrap();
    t.conf("");
    t.register("coding-agent", true);
    std::env::set_var("AEP_EDE_TEST_OPERATOR", &t.op);
    std::env::remove_var("AEP_EDE_TEST_NOW");
    t.act_as("coding-agent");
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "core.hooksPath");
    std::env::set_var("GIT_CONFIG_VALUE_0", "/dev/null");
    let tools = t.base.join("usertools");
    fs::create_dir_all(&tools).unwrap();
    let (p, g) = (t.base.join("passwd"), t.base.join("group"));
    fs::write(
        &p,
        "root:x:0:0::/root:/bin/sh\ndaemon:x:1:1::/:/usr/sbin/nologin\n",
    )
    .unwrap();
    fs::write(&g, "root:x:0:\ndaemon:x:1:\n").unwrap();
    let (p, g) = (p.display().to_string(), g.display().to_string());
    exe(
        &tools.join("groupadd"),
        &format!("#!/usr/bin/env bash\necho \"$4:x:$3:\" >> {g}\n"),
    );
    exe(
        &tools.join("useradd"),
        &format!("#!/usr/bin/env bash\ngid=$(awk -F: -v n=\"$8\" '$1==n {{print $3}}' {g})\necho \"$9:x:$6:$gid::/:$4\" >> {p}\n"),
    );
    exe(
        &tools.join("userdel"),
        &format!("#!/usr/bin/env bash\nsed -i \"/^$1:/d\" {p}\n"),
    );
    exe(
        &tools.join("groupdel"),
        &format!("#!/usr/bin/env bash\nsed -i \"/^$1:/d\" {g}\n"),
    );
    let bare = t.base.join("remote/owner/demo.git");
    fs::create_dir_all(&bare).unwrap();
    sh(&bare, "git init -q --bare -b main .");
    let w = t.base.join("w");
    fs::create_dir_all(&w).unwrap();
    fs::write(w.join("notes.txt"), "alpha\n").unwrap();
    sh(&w, &format!("git init -q -b main . && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init && git push -q {} main", bare.display()));
    t
}

fn manifest(check: &str, files: &[(&str, &Path, &str, &str)], users: &[&str]) -> String {
    let mut s = format!("schema_id: {}\nbuild: mkdir -p out && cp bin/tool.sh out/tool && cp bin/tool.sh out/second\ncheck: {}\n", hoststage::MANIFEST_SCHEMA, check);
    if !users.is_empty() {
        s.push_str("users:\n");
        for u in users {
            s.push_str(&format!("  - name: {}\n", u));
        }
    }
    s.push_str("files:\n");
    for (src, target, owner, mode) in files {
        s.push_str(&format!(
            "  - source: {}\n    target: {}\n    owner: {}\n    mode: {}\n",
            src,
            target.display(),
            owner,
            mode
        ));
    }
    s
}

fn promoted(manifest_text: &str) -> String {
    let s = aep_ede::seed("owner/demo", "main");
    assert!(s.ok, "{}", s.render());
    let d = s.draft;
    let tree = PathBuf::from(aep_ede::status(&d).note.split_whitespace().nth(1).unwrap());
    fs::create_dir_all(tree.join("deploy")).unwrap();
    fs::create_dir_all(tree.join("bin")).unwrap();
    fs::write(tree.join("deploy/host.rec"), manifest_text).unwrap();
    fs::write(tree.join("bin/tool.sh"), "#!/bin/sh\necho staged\n").unwrap();
    let s = aep_ede::scan(&d);
    assert!(s.ok, "{}", s.render());
    let p = aep_ede::promote(&d, "Add a deploy manifest");
    assert!(p.ok, "{}", p.render());
    d
}

fn old_target(path: &Path, body: &str) {
    fs::write(path, body).unwrap();
    std::os::unix::fs::chown(path, Some(1), Some(1)).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o640)).unwrap();
}

#[test]
fn a_checked_stage_is_provisional_and_only_the_operator_confirms_it() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("confirm");
    let tool = t.host().join("bin/tool");
    old_target(&tool, "old\n");
    let d = promoted(&manifest(
        &format!("{} | grep -q staged", tool.display()),
        &[("out/tool", &tool, "root", "0755")],
        &[],
    ));
    let r = hoststage::stage(&d, "deploy/host.rec");
    assert!(r.ok, "{}", r.render());
    assert_eq!(r.code, "stage_checked");
    assert_eq!(
        fs::read_to_string(&tool).unwrap(),
        "#!/bin/sh\necho staged\n"
    );
    assert_eq!(
        hoststage::stage_confirm(&d).code,
        "stage_confirm_operator_only"
    );
    let r = t.as_operator(|| hoststage::stage_confirm(&d));
    assert!(r.ok, "{}", r.render());
    assert_eq!(t.record(&d).state, "confirmed");
    let ledger = fs::read_to_string(t.base.join("records/ledger/ledger.rec")).unwrap_or_default();
    for kind in [
        "kind: stage\n",
        "kind: stage-check\n",
        "kind: stage-confirm\n",
    ] {
        assert!(ledger.contains(kind), "the ledger names {}", kind);
    }
}

#[test]
fn a_failed_check_puts_every_target_back_and_removes_a_created_user() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("fail");
    let tool = t.host().join("bin/tool");
    let second = t.host().join("bin/second");
    old_target(&tool, "old\n");
    let d = promoted(&manifest(
        "false",
        &[
            ("out/tool", &tool, "svc-demo", "0755"),
            ("out/second", &second, "root", "0755"),
        ],
        &["svc-demo"],
    ));
    let r = hoststage::stage(&d, "deploy/host.rec");
    assert_eq!(r.code, "stage_check_failed", "{}", r.render());
    assert_eq!(fs::read_to_string(&tool).unwrap(), "old\n");
    let m = fs::metadata(&tool).unwrap();
    assert_eq!((m.uid(), m.gid(), m.mode() & 0o7777), (1, 1, 0o640));
    assert!(!second.exists());
    assert!(core::id_in(
        &fs::read_to_string(t.base.join("passwd")).unwrap(),
        "svc-demo"
    )
    .is_none());
    assert_eq!(t.record(&d).state, "reverted");
}

#[test]
fn targets_outside_the_list_or_on_a_protected_place_are_refused() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("limits");
    // A later key wins: the test base holds the operator folder, a protected place.
    t.conf(&format!(
        "stage_targets: {} {}\n",
        t.base.display(),
        t.host().display()
    ));
    let conf = t.op.join("operator.conf");
    let outside = PathBuf::from("/etc/aep-ede-stage-test");
    let d = promoted(&manifest(
        "true",
        &[
            ("out/tool", &outside, "root", "0755"),
            ("out/tool", &conf, "root", "0644"),
        ],
        &[],
    ));
    let before = fs::read_to_string(&conf).unwrap();
    let r = hoststage::stage(&d, "deploy/host.rec");
    assert_eq!(r.code, "stage_targets", "{}", r.render());
    assert!(r.note.contains("outside the stage targets"), "{}", r.note);
    assert!(r.note.contains("protected place"), "{}", r.note);
    assert_eq!(fs::read_to_string(&conf).unwrap(), before);
    assert!(!outside.exists());
}

#[test]
fn an_agent_without_the_stage_grant_is_refused() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("grant");
    let tool = t.host().join("bin/tool");
    let d = promoted(&manifest(
        "true",
        &[("out/tool", &tool, "root", "0755")],
        &[],
    ));
    t.register("coding-agent", false);
    let r = hoststage::stage(&d, "deploy/host.rec");
    assert_eq!(r.code, "profile_refused", "{}", r.render());
    assert!(!tool.exists());
}

#[test]
fn the_deadline_closes_confirm_and_the_sweep_reverts() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("deadline");
    let tool = t.host().join("bin/tool");
    old_target(&tool, "old\n");
    let d = promoted(&manifest(
        "true",
        &[("out/tool", &tool, "root", "0755")],
        &[],
    ));
    assert!(hoststage::stage(&d, "deploy/host.rec").ok);
    let late = t.record(&d).deadline_unix + 1;
    std::env::set_var("AEP_EDE_TEST_NOW", late.to_string());
    let r = t.as_operator(|| hoststage::stage_confirm(&d));
    assert_eq!(r.code, "stage_deadline", "{}", r.render());
    let out = aep_ede::sweep();
    assert!(
        out.iter().any(|l| l.contains("reverted the stage of")),
        "{:?}",
        out
    );
    assert_eq!(fs::read_to_string(&tool).unwrap(), "old\n");
    assert_eq!(t.record(&d).state, "reverted");
    std::env::remove_var("AEP_EDE_TEST_NOW");
}
