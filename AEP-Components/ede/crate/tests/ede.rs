//! Tests of aep-ede against local bare repositories and a local stand-in
//! for the GitHub API. Every test writes its own operator folder, registers the key of
//! its agent there and names the folder through AEP_EDE_TEST_OPERATOR, which only a test
//! build reads.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "integration test crate: a failed unwrap here is a failed test"
)]

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

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
    sh(Path::new("/"), &format!("chmod +x {}", path.display()));
}

/// The name of the user that runs the tests: the EDE user of their operator folder.
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
    fn conf(&self, forge: &str, extra: &str) {
        let body = format!(
            "{f}\ndefault_owner: owner\nstate_root: {b}/drafts\nrecord_root: {b}/records\nede_user: {u}\n{x}",
            f = forge,
            b = self.base.display(),
            u = whoami(),
            x = extra
        );
        fs::write(self.op.join("operator.conf"), body).unwrap();
    }
    fn git_forge(&self) -> String {
        format!(
            "forge: git\ngit_remote: file://{}/remote",
            self.base.display()
        )
    }
    fn bare(&self) -> PathBuf {
        self.base.join("remote/owner/demo.git")
    }
    fn show(&self, rev_path: &str) -> String {
        sh(
            &self.base,
            &format!("git --git-dir={} show {}", self.bare().display(), rev_path),
        )
    }
    fn register(&self, agent: &str) {
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
        fs::write(
            self.op.join("profiles").join(format!("{}.gap", agent)),
            aep_ede::profile::template(agent, &["owner/demo".to_string()]),
        )
        .unwrap();
    }
    fn act_as(&self, agent: &str) {
        std::env::set_var("AEP_AGENT_ID", agent);
        std::env::set_var("AEP_AGENT_KEY", self.base.join(format!("{}.seed", agent)));
    }
    fn ledger(&self) -> String {
        fs::read_to_string(self.base.join("records/ledger/ledger.rec")).unwrap_or_default()
    }
}

impl Drop for T {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

/// A fresh operator folder, the agent test-agent with its key and profile, and a bare
/// repository owner/demo holding README.md and notes.txt.
fn setup(name: &str) -> T {
    let base = std::env::temp_dir().join(format!("aep-ede-test-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(base.join("op")).unwrap();
    let t = T {
        op: base.join("op"),
        base,
    };
    t.conf(&t.git_forge(), "");
    t.register("test-agent");
    for k in [
        "AEP_EDE_TEST_NOW",
        "AEP_EDE_TEST_CLASH",
        "AEP_EDE_ROOT",
        "AEP_EDE_PROFILE",
        "AEP_EDE_FORGE",
        "AEP_EDE_QUOTA",
        "AEP_EDE_GIT_REMOTE",
        "AEP_EDE_GIT_DIRECT",
        "GITHUB_TOKEN",
    ] {
        std::env::remove_var(k);
    }
    std::env::set_var("AEP_EDE_TEST_OPERATOR", &t.op);
    t.act_as("test-agent");
    // The git processes of the tests run without hooks of the host; aep-ede clears every
    // GIT_ variable for its own git calls.
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "core.hooksPath");
    std::env::set_var("GIT_CONFIG_VALUE_0", "/dev/null");
    let bare = t.bare();
    fs::create_dir_all(&bare).unwrap();
    sh(&bare, "git init -q --bare -b main .");
    let w = t.base.join("w");
    fs::create_dir_all(&w).unwrap();
    fs::write(
        w.join("README.md"),
        "# Demo\n\nThe first line of the demo.\n",
    )
    .unwrap();
    fs::write(w.join("notes.txt"), "alpha\nbeta\n").unwrap();
    sh(&w, &format!("git init -q -b main . && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init && git push -q {} main", bare.display()));
    t
}

fn land_outside(t: &T, file: &str, body: &str) {
    let w = t.base.join(format!("outside-{}", file));
    let _ = fs::remove_dir_all(&w);
    sh(
        &t.base,
        &format!("git clone -q {} {}", t.bare().display(), w.display()),
    );
    fs::write(w.join(file), body).unwrap();
    sh(&w, "git -c user.name=o -c user.email=o@o add -A && git -c user.name=o -c user.email=o@o commit -q -m outside && git push -q origin main");
}

fn tree(draft: &str) -> PathBuf {
    let s = aep_ede::status(draft);
    assert!(s.ok, "{}", s.render());
    PathBuf::from(s.note.split_whitespace().nth(1).unwrap())
}

fn seeded() -> String {
    let s = aep_ede::seed("owner/demo", "main");
    assert!(s.ok, "{}", s.render());
    s.draft
}

fn scan_id(draft: &str) -> String {
    aep_ede::store::load(&aep_ede::operator::load(), draft)
        .unwrap()
        .scan_id
}

#[test]
fn git_forge_lands_the_scanned_tree_as_one_commit() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("git");
    let d = seeded();
    let tr = tree(&d);
    assert!(tr.join("README.md").is_file());
    assert!(!tr.join(".git").exists(), "the tree holds no git folder");
    assert_eq!(aep_ede::scan(&d).code, "scan_empty");
    fs::write(tr.join("src.rs"), "pub fn f() {}\n").unwrap();
    fs::remove_file(tr.join("notes.txt")).unwrap();
    assert!(aep_ede::diff(&d).note.starts_with("2 changes:"));
    assert_eq!(
        aep_ede::promote(&d, "m").code,
        "lifecycle_wall",
        "the wall closes promote before scan"
    );
    let s = aep_ede::scan(&d);
    assert!(s.ok, "{}", s.render());
    // An edit after the scan remains in the tree and does not land.
    fs::write(tr.join("src.rs"), "pub fn f() { sneak() }\n").unwrap();
    assert_eq!(aep_ede::promote(&d, "").code, "promote_message");
    let tip = sh(
        &t.base,
        &format!("git --git-dir={} rev-parse main", t.bare().display()),
    );
    let p = aep_ede::promote(&d, "Add src.rs\n\nIt adds one function.");
    assert!(p.ok, "{}", p.render());
    let branch = format!("aep-ede/{}", d);
    assert_eq!(t.show(&format!("{}:src.rs", branch)), "pub fn f() {}");
    assert_eq!(
        sh(
            &t.base,
            &format!(
                "git --git-dir={} rev-list --count {}..{}",
                t.bare().display(),
                tip,
                branch
            )
        ),
        "1",
        "one commit on the fetched tip"
    );
    let msg = sh(
        &t.base,
        &format!(
            "git --git-dir={} log --format=%B -1 {}",
            t.bare().display(),
            branch
        ),
    );
    assert_eq!(msg, format!("Add src.rs\n\nIt adds one function.\n\nAEP-Agent: test-agent\nAEP-EDE-Draft: {}\nAEP-EDE-Scan: {}\nAEP-EDE-Base: {}", d, scan_id(&d), tip));
    assert_eq!(aep_ede::status(&d).code, "promoted");
    for r in [
        aep_ede::scan(&d),
        aep_ede::promote(&d, "again"),
        aep_ede::refresh(&d),
        aep_ede::expire(&d),
    ] {
        assert_eq!(r.code, "draft_promoted", "{}", r.render());
    }
    let ledger = t.ledger();
    assert!(
        ledger.contains("kind: seed")
            && ledger.contains("kind: scan")
            && ledger.contains("kind: promote"),
        "{}",
        ledger
    );
    assert_eq!(
        aep_ede::store::verify_ledger(&aep_ede::operator::load()).unwrap(),
        3
    );
}

#[test]
fn a_moved_branch_means_a_new_scan_and_a_conflict_is_refused() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("rebase");
    let d = seeded();
    fs::write(tree(&d).join("new.rs"), "pub fn n() {}\n").unwrap();
    assert!(aep_ede::scan(&d).ok);
    let first = scan_id(&d);
    land_outside(&t, "notes.txt", "alpha\nbeta\ngamma\n");
    let p = aep_ede::promote(&d, "Add new.rs");
    assert!(p.ok, "{}", p.render());
    assert!(p.note.contains("rescanned on"), "{}", p.note);
    let second = scan_id(&d);
    assert_ne!(first, second, "the merged tree has a scan id of its own");
    let branch = format!("aep-ede/{}", d);
    assert_eq!(
        t.show(&format!("{}:notes.txt", branch)),
        "alpha\nbeta\ngamma"
    );
    assert_eq!(t.show(&format!("{}:new.rs", branch)), "pub fn n() {}");
    let msg = sh(
        &t.base,
        &format!(
            "git --git-dir={} log --format=%B -1 {}",
            t.bare().display(),
            branch
        ),
    );
    assert!(
        msg.contains(&format!("AEP-EDE-Scan: {}", second)),
        "{}",
        msg
    );
    assert!(t.ledger().contains("kind: rescan"));

    let d2 = seeded();
    fs::write(tree(&d2).join("notes.txt"), "alpha\nbeta\ngamma\nmine\n").unwrap();
    assert!(aep_ede::scan(&d2).ok);
    land_outside(&t, "notes.txt", "alpha\nbeta\ntheirs\n");
    let c = aep_ede::promote(&d2, "conflict");
    assert_eq!(c.code, "tip_conflict", "{}", c.render());
    assert!(c.note.contains("notes.txt"), "{}", c.note);
    assert_eq!(
        fs::read_to_string(tree(&d2).join("notes.txt")).unwrap(),
        "alpha\nbeta\ngamma\nmine\n"
    );
    assert_eq!(
        aep_ede::status(&d2).code,
        "scanned",
        "a refused promote leaves the scan"
    );
    assert_eq!(aep_ede::refresh(&d2).code, "tip_conflict");
    fs::write(tree(&d2).join("notes.txt"), "alpha\nbeta\ntheirs\n").unwrap();
    fs::write(tree(&d2).join("e.rs"), "pub fn e() {}\n").unwrap();
    assert_eq!(aep_ede::refresh(&d2).code, "refreshed");
    assert_eq!(
        aep_ede::status(&d2).code,
        "seeded",
        "a refresh ends the scan"
    );
    assert_eq!(aep_ede::diff(&d2).note, "1 changes: put e.rs");
}

#[test]
fn a_writing_finding_is_named_where_the_line_now_stands() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("writing");
    let d = seeded();
    let tr = tree(&d);
    // Text that already sits in a file never blocks; a line added anywhere is judged at
    // its new position, also when the same text stood elsewhere before (baseline B5).
    land_outside(
        &t,
        "README.md",
        "# Demo\n\nThe first line of the demo.\nold \u{2014} line\n",
    );
    assert_eq!(aep_ede::refresh(&d).code, "refreshed");
    fs::write(
        tr.join("README.md"),
        "# Demo\n\nold \u{2014} line\nThe first line of the demo.\nold \u{2014} line\n",
    )
    .unwrap();
    let s = aep_ede::scan(&d);
    assert_eq!(s.code, "scan_findings", "{}", s.render());
    assert!(
        s.note.contains("README.md:3: "),
        "the moved line is judged at line 3: {}",
        s.note
    );
    assert!(
        !s.note.contains("README.md:5: "),
        "the line that stayed is not judged: {}",
        s.note
    );
}

/// A one request stand-in for the GitHub API. It records the request and answers 201.
fn api_stub() -> (String, Arc<Mutex<String>>, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("localhost:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(String::new()));
    let keep = seen.clone();
    let h = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let start = std::time::Instant::now();
        let mut s = loop {
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(_) if start.elapsed().as_secs() < 60 => {
                    std::thread::sleep(std::time::Duration::from_millis(50))
                }
                Err(_) => return,
            }
        };
        s.set_nonblocking(false).unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = s.read(&mut chunk).unwrap();
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            if let Some(head_end) = text.find("\r\n\r\n") {
                let len = text[..head_end]
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                if buf.len() >= head_end + 4 + len {
                    break;
                }
            }
        }
        *keep.lock().unwrap() = String::from_utf8_lossy(&buf).to_string();
        // A decoy title holds the text html_url: a typed answer reads the field, not the first match.
        let body = "{\"title\": \"html_url decoy\", \"html_url\": \"https://github.com/owner/demo/pull/7\", \"number\": 7}";
        let resp = format!("HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        s.write_all(resp.as_bytes()).unwrap();
    });
    (format!("http://localhost:{}", port), seen, h)
}

#[test]
fn github_forge_pushes_one_commit_and_opens_a_pull_request_in_process() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("gh");
    let gh = |api: &str| {
        format!(
            "forge: github\ngithub_url: file://{}/remote\ngithub_api: {}",
            t.base.display(),
            api
        )
    };
    t.conf(&gh("http://localhost:9"), "");
    let d = seeded();
    fs::write(tree(&d).join("pr.rs"), "pub fn pr() {}\n").unwrap();
    assert!(aep_ede::scan(&d).ok);
    // A token in the environment of the agent is never read.
    std::env::set_var("GITHUB_TOKEN", "agent-token");
    let refused = aep_ede::promote(&d, "Open a pull request");
    assert_eq!(refused.code, "promote_land", "{}", refused.render());
    assert!(refused.note.contains("github-token"), "{}", refused.note);
    assert_eq!(
        aep_ede::status(&d).code,
        "scanned",
        "a refused land keeps the scan"
    );
    let (api, seen, h) = api_stub();
    t.conf(&gh(&api), "");
    fs::write(t.op.join("github-token"), "test-token-value\n").unwrap();
    let p = aep_ede::promote(&d, "Open a pull request\n\nIt adds pr.rs.");
    h.join().unwrap();
    assert!(p.ok, "{}", p.render());
    assert!(
        p.note
            .starts_with("pull request https://github.com/owner/demo/pull/7 "),
        "{}",
        p.note
    );
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /repos/owner/demo/pulls "), "{}", req);
    assert!(
        req.to_ascii_lowercase()
            .contains("authorization: bearer test-token-value"),
        "{}",
        req
    );
    assert!(!req.contains("agent-token"), "{}", req);
    let branch = format!("aep-ede/{}", d);
    let json_start = req.find("\r\n\r\n").unwrap() + 4;
    let sent: serde_json::Value = serde_json::from_str(&req[json_start..]).unwrap();
    assert_eq!(sent["head"], branch.as_str());
    assert_eq!(sent["base"], "main");
    assert_eq!(sent["title"], "Open a pull request");
    assert!(
        sent["body"]
            .as_str()
            .unwrap()
            .starts_with("It adds pr.rs.\n\nAEP-Agent: test-agent\nAEP-EDE-Draft: "),
        "{}",
        sent["body"]
    );
    assert_eq!(t.show(&format!("{}:pr.rs", branch)), "pub fn pr() {}");
    let leftovers = sh(
        &t.base,
        &format!(
            "grep -rl test-token-value {} {} || true",
            t.base.join("drafts").display(),
            t.base.join("records").display()
        ),
    );
    assert_eq!(leftovers, "", "the token is written nowhere");
    std::env::remove_var("GITHUB_TOKEN");
}

#[test]
fn every_verb_proves_its_agent_and_passes_its_profile() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("identity");
    let op = aep_ede::operator::load();
    let prof = aep_ede::profile::load(&op, "test-agent").unwrap();
    assert!(
        prof.summary()
            .contains("grants seed refresh scan promote expire stage for owner/demo"),
        "{}",
        prof.summary()
    );
    std::env::set_var("AEP_AGENT_ID", "");
    assert_eq!(aep_ede::seed("owner/demo", "main").code, "identity");
    // A claim with the key of another agent fails the proof.
    t.register("other-agent");
    std::env::set_var("AEP_AGENT_ID", "test-agent");
    std::env::set_var("AEP_AGENT_KEY", t.base.join("other-agent.seed"));
    let r = aep_ede::seed("owner/demo", "main");
    assert_eq!(r.code, "identity", "{}", r.render());
    assert!(r.note.contains("does not verify"), "{}", r.note);
    // An agent the operator never registered.
    std::env::set_var("AEP_AGENT_ID", "ghost");
    assert!(aep_ede::seed("owner/demo", "main")
        .note
        .contains("registered no key"));
    t.act_as("test-agent");
    let other_repo = aep_ede::seed("owner/other", "main");
    assert_eq!(other_repo.code, "profile_refused");
    assert!(other_repo.note.contains("ede_repos"), "{}", other_repo.note);
    let d = seeded();
    fs::write(tree(&d).join("p.rs"), "pub fn p() {}\n").unwrap();
    // Another agent with a profile of its own cannot touch the draft.
    t.act_as("other-agent");
    for r in [
        aep_ede::scan(&d),
        aep_ede::expire(&d),
        aep_ede::diff(&d),
        aep_ede::status(&d),
    ] {
        assert_eq!(r.code, "draft_foreign_agent", "{}", r.render());
    }
    // A profile without ede.promote scans but does not land.
    t.act_as("test-agent");
    let text = aep_ede::profile::template("test-agent", &["owner/demo".to_string()])
        .replace("      action: ede.promote\n", "      action: ede.read\n");
    fs::write(t.op.join("profiles/test-agent.gap"), text).unwrap();
    assert!(aep_ede::scan(&d).ok);
    let refused = aep_ede::promote(&d, "Add p.rs");
    assert_eq!(refused.code, "profile_refused");
    assert!(refused.note.contains("ede.promote"), "{}", refused.note);
    // A profile path in the environment of the agent is never read.
    let wide = t.base.join("wide.gap");
    fs::write(
        &wide,
        aep_ede::profile::template("test-agent", &["*".to_string()]),
    )
    .unwrap();
    std::env::set_var("AEP_EDE_PROFILE", &wide);
    assert_eq!(aep_ede::promote(&d, "Add p.rs").code, "profile_refused");
    std::env::remove_var("AEP_EDE_PROFILE");
    // profile init writes into the operator folder only and keeps an existing profile.
    assert!(aep_ede::profile::init(&op, "test-agent", &["owner/demo".to_string()]).is_err());
    assert!(
        aep_ede::profile::init(&op, "third-agent", &["owner/demo".to_string()])
            .unwrap()
            .starts_with(&t.op)
    );
}

#[test]
fn the_reference_profile_grants_the_six_verbs() {
    let text = include_str!("../../../gap/policies/reference/ede-coding-agent.gap");
    let (records, repos) = aep_ede::profile::parse(text).unwrap();
    let actions: Vec<&str> = records.iter().map(|r| r.action.as_str()).collect();
    assert_eq!(
        actions,
        vec![
            "ede.seed",
            "ede.refresh",
            "ede.scan",
            "ede.promote",
            "ede.expire",
            "ede.stage"
        ]
    );
    assert!(records.iter().all(|r| r.agent_id == "coding-agent"));
    assert_eq!(repos, vec!["owner/repo".to_string()]);
    let generated = aep_ede::profile::template("coding-agent", &repos);
    let (g_records, g_repos) = aep_ede::profile::parse(&generated).unwrap();
    assert_eq!(g_records, records);
    assert_eq!(g_repos, repos);
}

#[test]
fn hostile_records_folders_and_ids_are_denied() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("records");
    let a = seeded();
    let b = seeded();
    fs::write(tree(&a).join("a.rs"), "pub fn a() {}\n").unwrap();
    assert!(aep_ede::scan(&a).ok);
    // A manifest beside the tree means nothing; a record edited by hand loses its seal.
    let folder_b = tree(&b).parent().unwrap().to_path_buf();
    fs::write(folder_b.join("manifest"), "state: scanned\ndigest: x\n").unwrap();
    assert_eq!(aep_ede::promote(&b, "m").code, "lifecycle_wall");
    let rb = t.base.join(format!("records/drafts/{}.rec", b));
    let body = fs::read_to_string(&rb).unwrap();
    fs::write(&rb, body.replace("state: seeded", "state: scanned")).unwrap();
    assert_eq!(aep_ede::status(&b).code, "draft_record_forged");
    // The sealed record of A copied over B names A.
    fs::copy(t.base.join(format!("records/drafts/{}.rec", a)), &rb).unwrap();
    assert_eq!(aep_ede::promote(&b, "m").code, "draft_record_forged");
    // A renamed folder.
    let other = "ede-1-0123456789abcdef0123456789abcdef";
    let folder_a = tree(&a).parent().unwrap().to_path_buf();
    fs::rename(&folder_a, folder_a.parent().unwrap().join(other)).unwrap();
    assert_eq!(aep_ede::status(other).code, "draft_missing");
    assert_eq!(aep_ede::scan(&a).code, "draft_folder");
    assert_eq!(aep_ede::status("../x").code, "draft_id_grammar");
    // Line breaks.
    assert_eq!(
        aep_ede::seed("owner/demo\nstate: scanned", "main").code,
        "seed_repo"
    );
    assert_eq!(aep_ede::seed("owner/demo", "main\nx").code, "seed_branch");
    assert_eq!(aep_ede::seed("owner/demo", "-uattack").code, "seed_branch");
    std::env::set_var("AEP_AGENT_ID", "test-agent\nstate: scanned");
    assert_eq!(aep_ede::seed("owner/demo", "main").code, "identity");
    t.act_as("test-agent");
}

#[test]
fn two_seeds_in_one_second_and_a_failed_clone_leave_every_draft() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("seeds");
    std::env::set_var("AEP_EDE_TEST_NOW", "1794800000");
    let a = seeded();
    let b = seeded();
    assert_ne!(a, b);
    assert!(a.starts_with("ede-1794800000-") && aep_ede::ident::draft_id_ok(&b));
    fs::write(tree(&a).join("mine.txt"), "keep\n").unwrap();
    std::env::set_var("AEP_EDE_TEST_CLASH", &a);
    let c = seeded();
    std::env::remove_var("AEP_EDE_TEST_CLASH");
    assert_ne!(c, a);
    assert_eq!(
        fs::read_to_string(tree(&a).join("mine.txt")).unwrap(),
        "keep\n"
    );
    // A git that refuses every clone.
    let fake = t.base.join("noclone");
    fs::create_dir_all(&fake).unwrap();
    let real = sh(&t.base, "command -v git");
    exe(&fake.join("git"), &format!("#!/bin/sh\nfor a in \"$@\"; do [ \"$a\" = clone ] && {{ echo refused >&2; exit 128; }}; done\nexec {} \"$@\"\n", real));
    let path = std::env::var("PATH").unwrap();
    let before: Vec<_> = fs::read_dir(t.base.join("drafts/test-agent"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    std::env::set_var("PATH", format!("{}:{}", fake.display(), path));
    let r = aep_ede::seed("owner/demo", "main");
    std::env::set_var("PATH", path);
    assert_eq!(r.code, "seed_clone", "{}", r.render());
    let after: Vec<_> = fs::read_dir(t.base.join("drafts/test-agent"))
        .unwrap()
        .flatten()
        .map(|e| e.file_name())
        .collect();
    assert_eq!(before, after);
    std::env::remove_var("AEP_EDE_TEST_NOW");
}

#[test]
fn planted_config_blob_swaps_bad_prose_and_local_commits_change_nothing() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("planted");
    let d = seeded();
    let tr = tree(&d);
    let gd = tr.parent().unwrap().join("git");
    let trace = t.base.join("planted-ran");
    let prog = t.base.join("planted.sh");
    exe(
        &prog,
        &format!("#!/bin/sh\ntouch {}\ncat\n", trace.display()),
    );
    let mut cfg = fs::read_to_string(gd.join("config")).unwrap();
    cfg.push_str(&format!("[core]\n\tfsmonitor = {p}\n[filter \"x\"]\n\tclean = {p}\n[remote \"origin\"]\n\tpushurl = file:///nowhere\n", p = prog.display()));
    fs::write(gd.join("config"), cfg).unwrap();
    fs::create_dir_all(gd.join("info")).unwrap();
    fs::write(gd.join("info/attributes"), "* filter=x\n").unwrap();
    exe(
        &gd.join("hooks/pre-push"),
        &format!("#!/bin/sh\ntouch {}\n", trace.display()),
    );
    fs::write(tr.join("README.md"), b"# Demo\n\xff broken\n").unwrap();
    let s = aep_ede::scan(&d);
    assert_eq!(s.code, "scan_findings", "{}", s.render());
    assert!(
        s.note
            .contains("README.md: prose file that is not UTF-8 text"),
        "{}",
        s.note
    );
    fs::write(
        tr.join("README.md"),
        "# Demo\n\nThe first line of the demo.\n",
    )
    .unwrap();
    // Other bytes under the id of a new file.
    let git = format!("git --git-dir={}", gd.display());
    let real = sh(
        &t.base,
        &format!(
            "printf 'pub fn good() {{}}\\n' | {} hash-object --stdin",
            git
        ),
    );
    let evil = sh(
        &t.base,
        &format!(
            "printf 'pub fn evil() {{}}\\n' | {} hash-object -w --stdin",
            git
        ),
    );
    fs::create_dir_all(gd.join("objects").join(&real[..2])).unwrap();
    fs::copy(
        gd.join("objects").join(&evil[..2]).join(&evil[2..]),
        gd.join("objects").join(&real[..2]).join(&real[2..]),
    )
    .unwrap();
    fs::write(tr.join("good.rs"), "pub fn good() {}\n").unwrap();
    let s = aep_ede::scan(&d);
    assert!(
        s.note.contains("does not hold the bytes its id names"),
        "{}",
        s.render()
    );
    fs::remove_file(gd.join("objects").join(&real[..2]).join(&real[2..])).unwrap();
    sh(&tr, &format!("{} hash-object -w good.rs", git));
    // Local commits of the agent in the git folder of the draft.
    sh(&tr, &format!("{g} --work-tree={w} add -A && {g} --work-tree={w} -c user.name=a -c user.email=a@a commit -q -m local", g = git, w = tr.display()));
    let s = aep_ede::scan(&d);
    assert!(s.ok, "{}", s.render());
    let tip = sh(
        &t.base,
        &format!("git --git-dir={} rev-parse main", t.bare().display()),
    );
    let p = aep_ede::promote(&d, "Add good.rs");
    assert!(p.ok, "{}", p.render());
    assert_eq!(
        sh(
            &t.base,
            &format!(
                "git --git-dir={} rev-list --count {}..aep-ede/{}",
                t.bare().display(),
                tip,
                d
            )
        ),
        "1"
    );
    assert!(
        !trace.exists(),
        "a program planted in the git folder of the draft ran"
    );
}

#[test]
fn a_mode_change_is_scanned_and_one_verb_holds_a_draft() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("mode");
    let d = seeded();
    fs::write(tree(&d).join("run.sh"), "echo run\n").unwrap();
    let one = aep_ede::scan(&d);
    sh(&tree(&d), "chmod +x run.sh notes.txt");
    let two = aep_ede::scan(&d);
    assert!(one.ok && two.ok);
    assert_ne!(one.note, two.note, "a mode change gives a new scan id");
    let held = aep_ede::store::lock(&aep_ede::operator::load(), &d).unwrap();
    assert_eq!(aep_ede::scan(&d).code, "draft_busy");
    drop(held);
    assert!(aep_ede::expire(&d).ok);
    assert_eq!(aep_ede::status(&d).code, "expired");
    assert!(t.ledger().contains("kind: expire"));
}

#[test]
fn age_bounds_the_wall_and_the_sweep() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("ages");
    t.conf(
        &t.git_forge(),
        "draft_max_age_secs: 1000\nscan_max_age_secs: 100\n",
    );
    let t0 = 1_794_800_000u64;
    std::env::set_var("AEP_EDE_TEST_NOW", t0.to_string());
    let d = seeded();
    let early = aep_ede::promote(&d, "m");
    assert_eq!(early.code, "lifecycle_wall", "{}", early.render());
    assert!(
        early.note.contains("missing parents ede.scan"),
        "{}",
        early.note
    );
    fs::write(tree(&d).join("x.rs"), "pub fn x() {}\n").unwrap();
    assert!(aep_ede::scan(&d).ok);
    std::env::set_var("AEP_EDE_TEST_NOW", (t0 + 101).to_string());
    let late = aep_ede::promote(&d, "m");
    assert_eq!(late.code, "lifecycle_wall", "{}", late.render());
    assert!(late.note.contains("ede.scan_age"), "{}", late.note);
    std::env::set_var("AEP_EDE_TEST_NOW", (t0 + 1001).to_string());
    let old = aep_ede::scan(&d);
    assert!(old.note.contains("ede.draft_age"), "{}", old.render());
    let lines = aep_ede::sweep();
    assert!(
        lines.iter().any(|l| l == &format!("expired {}", d)),
        "{:?}",
        lines
    );
    assert_eq!(aep_ede::status(&d).code, "expired");
    assert!(!t.base.join("drafts/test-agent").exists(), "{:?}", lines);
    let op = aep_ede::operator::load();
    assert!(aep_ede::store::verify_ledger(&op).is_ok());
    let ledger = t.ledger();
    fs::write(
        t.base.join("records/ledger/ledger.rec"),
        ledger.replacen("kind: seed", "kind: sneak", 1),
    )
    .unwrap();
    assert!(aep_ede::store::verify_ledger(&op).is_err());
    std::env::remove_var("AEP_EDE_TEST_NOW");
}

/// The entries of the ledger text: the header and one block of lines per entry.
fn ledger_blocks(text: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut blocks: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.starts_with("  - seq: ") {
            blocks.push(String::new());
        }
        match blocks.last_mut() {
            Some(b) => {
                b.push_str(line);
                b.push('\n');
            }
            None => {
                header.push_str(line);
                header.push('\n');
            }
        }
    }
    (header, blocks)
}

/// The same entry without its hash and seal lines.
fn unsealed(block: &str) -> String {
    block
        .lines()
        .filter(|l| !l.starts_with("    hash: ") && !l.starts_with("    seal: "))
        .map(|l| format!("{l}\n"))
        .collect()
}

#[test]
fn the_ledger_refuses_every_edit_cut_inside_reorder_and_unsealed_entry() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let t = setup("ledger-tamper");
    let d = seeded();
    fs::write(tree(&d).join("x.rs"), "pub fn x() {}\n").unwrap();
    assert!(aep_ede::scan(&d).ok);
    let _second = seeded();
    let op = aep_ede::operator::load();
    let path = t.base.join("records/ledger/ledger.rec");
    let good = t.ledger();
    let (header, blocks) = ledger_blocks(&good);
    assert!(blocks.len() >= 3, "{good}");
    assert_eq!(
        aep_ede::store::verify_ledger(&op),
        Ok(blocks.len() as u64),
        "{good}"
    );
    let agent_line = blocks[1]
        .lines()
        .find(|l| l.starts_with("    agent: "))
        .unwrap()
        .to_string();
    let seal_of = |b: &str| {
        b.lines()
            .find(|l| l.starts_with("    seal: "))
            .unwrap()
            .to_string()
    };
    let join = |parts: &[&str]| format!("{header}{}", parts.concat());
    let hostile: Vec<(&str, String)> = vec![
        (
            "an edited field",
            good.replacen(&agent_line, "    agent: another-agent", 1),
        ),
        (
            "a seal copied from another entry",
            good.replacen(&seal_of(&blocks[1]), &seal_of(&blocks[0]), 1),
        ),
        (
            "a removed entry inside the chain",
            join(&[&blocks[0], &blocks[2]]),
        ),
        (
            "two entries in swapped order",
            join(&[&blocks[1], &blocks[0], &blocks[2]]),
        ),
        (
            "an unsealed entry between two sealed ones",
            join(&[&blocks[0], &unsealed(&blocks[1]), &blocks[1], &blocks[2]]),
        ),
        (
            "an unsealed entry after the last one",
            join(&[&blocks[0], &blocks[1], &blocks[2], &unsealed(&blocks[1])]),
        ),
        (
            "a stray line after the last entry",
            format!("{good}note: nothing to see\n"),
        ),
        (
            "a stray line inside an entry",
            good.replacen(&agent_line, &format!("{agent_line}\nextra line"), 1),
        ),
        (
            "an entry whose seal line is gone",
            good.replacen(&format!("{}\n", seal_of(&blocks[2])), "", 1),
        ),
        (
            "a changed header",
            good.replacen("json: prohibited", "json: allowed", 1),
        ),
    ];
    for (what, text) in hostile {
        fs::write(&path, &text).unwrap();
        assert!(
            aep_ede::store::verify_ledger(&op).is_err(),
            "{what} passed the ledger check:\n{text}"
        );
    }
    fs::write(&path, &good).unwrap();
    assert_eq!(aep_ede::store::verify_ledger(&op), Ok(blocks.len() as u64));
}

#[test]
fn the_variables_of_the_old_aep_ede_change_no_verdict() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let keys = [
        "AEP_EDE_ROOT",
        "AEP_EDE_PROFILE",
        "AEP_EDE_FORGE",
        "AEP_EDE_QUOTA",
        "AEP_EDE_GIT_REMOTE",
        "AEP_EDE_GIT_DIRECT",
        "GITHUB_TOKEN",
        "AEP_EDE_GITHUB_URL",
    ];
    let run = |hostile: bool| -> Vec<String> {
        let t = setup(if hostile { "env-hostile" } else { "env-plain" });
        if hostile {
            for (k, v) in keys.iter().zip([
                t.base.join("hostile").display().to_string(),
                t.base.join("hostile.gap").display().to_string(),
                "github".to_string(),
                "1".to_string(),
                "file:///nowhere".to_string(),
                "1".to_string(),
                "hostile".to_string(),
                "file:///nowhere".to_string(),
            ]) {
                std::env::set_var(k, v);
            }
        }
        let mut out = Vec::new();
        let s = aep_ede::seed("owner/demo", "main");
        out.push(s.code.clone());
        fs::write(tree(&s.draft).join("x.md"), "plain\n").unwrap();
        out.push(aep_ede::scan(&s.draft).code);
        let p = aep_ede::promote(&s.draft, "m");
        out.push(p.code.clone());
        out.push(
            p.note
                .split_whitespace()
                .take(1)
                .collect::<Vec<_>>()
                .join(" "),
        );
        for k in keys {
            std::env::remove_var(k);
        }
        out
    };
    let plain = run(false);
    assert_eq!(plain, run(true));
    assert_eq!(plain[2], "promoted");
}

#[test]
fn a_release_build_reads_no_control_from_the_environment() {
    let allowed = ["env::var(k)", "\"AEP_AGENT_ID\"", "\"AEP_AGENT_KEY\""];
    // Every source file, the module folders included.
    let mut files = Vec::new();
    let mut dirs = vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("src")];
    while let Some(d) = dirs.pop() {
        for e in fs::read_dir(&d).unwrap().flatten() {
            if e.path().is_dir() {
                dirs.push(e.path());
            } else if e.path().extension().and_then(|x| x.to_str()) == Some("rs") {
                files.push(e);
            }
        }
    }
    for e in files {
        let body = fs::read_to_string(e.path()).unwrap();
        let lines: Vec<&str> = body.lines().collect();
        for (i, l) in lines.iter().enumerate() {
            if !l.contains("env::var")
                || l.trim_start().starts_with("//")
                || allowed.iter().any(|a| l.contains(a))
            {
                continue;
            }
            let gated = lines[i.saturating_sub(10)..i]
                .iter()
                .any(|p| p.contains("cfg(feature = \"test-env\")"));
            assert!(
                gated,
                "{}:{} reads the environment outside a test build: {}",
                e.path().display(),
                i + 1,
                l.trim()
            );
        }
    }
}

fn unescape(v: &str) -> String {
    v.replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace("\\r", "\r")
        .replace("\\0", "\0")
        .replace("\\-", "-")
}

#[test]
fn identifier_vectors_hold() {
    let text = include_str!("../../identifier-vectors.rec");
    let mut count = 0;
    for line in text.lines() {
        let Some(line) = line.strip_prefix("  - ") else {
            continue;
        };
        let (left, want) = line.rsplit_once(" => ").unwrap();
        let (kind, value) = left.split_once(' ').unwrap();
        let value = unescape(value);
        let yes = |b: bool| {
            if b {
                "ok".to_string()
            } else {
                "no".to_string()
            }
        };
        let got = match kind {
            "draft_id" => yes(aep_ede::ident::draft_id_ok(&value)),
            "agent" => yes(aep_ede::ident::agent_ok(&value)),
            "session" => yes(aep_ede::ident::session_ok(&value)),
            "branch" => yes(aep_ede::ident::branch_ok(&value)),
            "rel" => yes(aep_ede::ident::rel_ok(&value)),
            "repo" => aep_ede::ident::repo(&value, "thePM001")
                .map(|r| r.canonical)
                .unwrap_or_else(|_| "no".to_string()),
            k => panic!("unknown vector kind {}", k),
        };
        assert_eq!(got, want, "{} {:?}", kind, value);
        count += 1;
    }
    assert!(count >= 60, "{}", count);
}
