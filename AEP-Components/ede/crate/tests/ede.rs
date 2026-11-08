//! Tests of aep-ede against local bare repositories and a local stand-in for the GitHub API.

use aep_ede::forge::{Forge, GitForge, GitHubForge};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};

static LOCK: Mutex<()> = Mutex::new(());

fn sh(dir: &Path, cmd: &str) -> String {
    let o = Command::new("bash").arg("-c").arg(cmd).current_dir(dir).output().unwrap();
    assert!(o.status.success(), "{}: {}", cmd, String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

/// A fresh root with a bare repository <root>/remote/owner/demo.git holding README.md and notes.txt.
fn setup(name: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("aep-ede-test-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&base);
    fs::create_dir_all(&base).unwrap();
    std::env::set_var("AEP_EDE_ROOT", base.join("drafts"));
    std::env::set_var("GIT_CONFIG_COUNT", "1");
    std::env::set_var("GIT_CONFIG_KEY_0", "core.hooksPath");
    std::env::set_var("GIT_CONFIG_VALUE_0", "/dev/null");
    let bare = base.join("remote/owner/demo.git");
    fs::create_dir_all(&bare).unwrap();
    sh(&bare, "git init -q --bare -b main .");
    let w = base.join("w");
    fs::create_dir_all(&w).unwrap();
    fs::write(w.join("README.md"), "# Demo\n\nThe first line of the demo.\n").unwrap();
    fs::write(w.join("notes.txt"), "alpha\nbeta\n").unwrap();
    sh(&w, &format!("git init -q -b main . && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init && git push -q {} main", bare.display()));
    base
}

fn git_forge(base: &Path) -> GitForge {
    GitForge { remote_base: format!("file://{}/remote", base.display()), direct: false }
}

fn land_outside(base: &Path, file: &str, body: &str) {
    let w = base.join(format!("outside-{}", file));
    let _ = fs::remove_dir_all(&w);
    sh(base, &format!("git clone -q file://{}/remote/owner/demo.git {}", base.display(), w.display()));
    fs::write(w.join(file), body).unwrap();
    sh(&w, "git -c user.name=o -c user.email=o@o commit -q -am outside && git push -q origin main");
}

fn tree(draft: &str) -> PathBuf {
    PathBuf::from(aep_ede::status(draft).note.split_whitespace().nth(1).unwrap())
}

#[test]
fn git_forge_seeds_scans_and_promotes_to_a_branch() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = setup("git");
    let forge = git_forge(&base);
    let s = aep_ede::seed(&forge, "owner/demo", "main");
    assert!(s.ok, "{}", s.render());
    let t = tree(&s.draft);
    let push = Command::new("git").arg("-C").arg(&t).args(["push", "origin", "HEAD:main"]).output().unwrap();
    assert!(!push.status.success(), "a push from the draft must fail");
    assert_eq!(aep_ede::scan(&s.draft).code, "scan_empty");
    fs::write(t.join("README.md"), "# Demo\n\nThe first line of the demo.\nA second line \u{2014} with a dash.\n").unwrap();
    fs::write(t.join("src.rs"), "pub fn f() {}\n").unwrap();
    fs::remove_file(t.join("notes.txt")).unwrap();
    let w = aep_ede::scan(&s.draft);
    assert_eq!(w.code, "scan_writing", "{}", w.render());
    assert!(w.note.contains("README.md:4:"), "{}", w.note);
    fs::write(t.join("README.md"), "# Demo\n\nThe first line of the demo.\nA second line without a dash.\n").unwrap();
    let ok = aep_ede::scan(&s.draft);
    assert!(ok.ok, "{}", ok.render());
    assert!(ok.note.starts_with("3 changes:"), "{}", ok.note);
    fs::write(t.join("src.rs"), "pub fn f() { sneak() }\n").unwrap();
    assert_eq!(aep_ede::promote(&forge, &s.draft, "m").code, "promote_changed_since_scan");
    assert!(aep_ede::scan(&s.draft).ok);
    assert_eq!(aep_ede::promote(&forge, &s.draft, "").code, "promote_message");
    let p = aep_ede::promote(&forge, &s.draft, "Add src.rs and drop notes");
    assert!(p.ok, "{}", p.render());
    let branch = format!("aep-ede/{}", s.draft);
    assert!(p.note.starts_with(&format!("branch {}", branch)), "{}", p.note);
    let bare = base.join("remote/owner/demo.git");
    assert_eq!(sh(&base, &format!("git --git-dir={} show {}:src.rs", bare.display(), branch)), "pub fn f() { sneak() }");
    assert_eq!(sh(&base, &format!("git --git-dir={} log --format=%s -1 {}", bare.display(), branch)), "Add src.rs and drop notes");
    assert_eq!(sh(&base, &format!("git --git-dir={} log --format=%s -1 main", bare.display())), "init", "main is untouched");
    assert!(aep_ede::expire(&s.draft).ok);
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn promote_rebases_on_a_moved_branch_and_refuses_a_conflict() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = setup("tip");
    let forge = GitForge { remote_base: format!("file://{}/remote", base.display()), direct: true };
    let s = aep_ede::seed(&forge, "owner/demo", "main");
    let t = tree(&s.draft);
    fs::write(t.join("new.rs"), "pub fn n() {}\n").unwrap();
    land_outside(&base, "notes.txt", "alpha\nbeta\ngamma\n");
    assert!(aep_ede::scan(&s.draft).ok);
    let p = aep_ede::promote(&forge, &s.draft, "Add new.rs");
    assert!(p.ok, "{}", p.render());
    let bare = base.join("remote/owner/demo.git");
    assert_eq!(sh(&base, &format!("git --git-dir={} show main:notes.txt", bare.display())), "alpha\nbeta\ngamma");
    assert_eq!(sh(&base, &format!("git --git-dir={} show main:new.rs", bare.display())), "pub fn n() {}");

    let s2 = aep_ede::seed(&forge, "owner/demo", "main");
    let t2 = tree(&s2.draft);
    fs::write(t2.join("notes.txt"), "alpha\nmine\n").unwrap();
    land_outside(&base, "notes.txt", "alpha\ntheirs\n");
    assert!(aep_ede::scan(&s2.draft).ok);
    let c = aep_ede::promote(&forge, &s2.draft, "Change notes");
    assert_eq!(c.code, "tip_conflict", "{}", c.render());
    assert!(c.note.contains("notes.txt"), "{}", c.note);
    assert_eq!(fs::read_to_string(t2.join("notes.txt")).unwrap(), "alpha\nmine\n", "the work survives a conflict");
    let _ = fs::remove_dir_all(&base);
}

/// A one request stand-in for the GitHub API. It records the request and answers 201.
fn api_stub() -> (String, Arc<Mutex<String>>, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("localhost:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(String::new()));
    let keep = seen.clone();
    let h = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
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
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                    .unwrap_or(0);
                if buf.len() >= head_end + 4 + len {
                    break;
                }
            }
        }
        *keep.lock().unwrap() = String::from_utf8_lossy(&buf).to_string();
        let body = "{\"html_url\": \"https://github.com/owner/demo/pull/7\", \"number\": 7}";
        let resp = format!("HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        s.write_all(resp.as_bytes()).unwrap();
    });
    (format!("http://localhost:{}", port), seen, h)
}

#[test]
fn github_forge_pushes_a_branch_and_opens_a_pull_request() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = setup("gh");
    let web = format!("file://{}/remote", base.display());
    let no_token = GitHubForge { web: web.clone(), api: "http://localhost:9".into(), token: String::new() };
    let s = aep_ede::seed(&no_token, "owner/demo", "main");
    assert!(s.ok, "{}", s.render());
    fs::write(tree(&s.draft).join("pr.rs"), "pub fn pr() {}\n").unwrap();
    assert!(aep_ede::scan(&s.draft).ok);
    let refused = aep_ede::promote(&no_token, &s.draft, "Open a pull request");
    assert_eq!(refused.code, "promote_land", "{}", refused.render());
    assert!(refused.note.contains("GITHUB_TOKEN"), "{}", refused.note);
    assert!(aep_ede::scan(&s.draft).ok, "a refused land keeps the work");
    let (api, seen, h) = api_stub();
    let forge = GitHubForge { web, api, token: "test-token-value".into() };
    assert!(forge.git_env().iter().any(|(k, v)| k == "GIT_CONFIG_VALUE_0" && v.starts_with("Authorization: Basic ")));
    let p = aep_ede::promote(&forge, &s.draft, "Open a pull request\n\nIt adds pr.rs.");
    h.join().unwrap();
    assert!(p.ok, "{}", p.render());
    assert!(p.note.starts_with("pull request https://github.com/owner/demo/pull/7"), "{}", p.note);
    let req = seen.lock().unwrap().clone();
    assert!(req.starts_with("POST /repos/owner/demo/pulls "), "{}", req);
    assert!(req.contains("Authorization: Bearer test-token-value"), "{}", req);
    let branch = format!("aep-ede/{}", s.draft);
    assert!(req.contains(&format!("\"head\":\"{}\"", branch)) && req.contains("\"base\":\"main\""), "{}", req);
    assert!(req.contains("\"title\":\"Open a pull request\"") && req.contains("\"body\":\"It adds pr.rs.\""), "{}", req);
    let bare = base.join("remote/owner/demo.git");
    assert_eq!(sh(&base, &format!("git --git-dir={} show {}:pr.rs", bare.display(), branch)), "pub fn pr() {}");
    assert!(!tree(&s.draft).parent().unwrap().join("github-headers").exists(), "the header file with the token is gone");
    let _ = fs::remove_dir_all(&base);
}

#[test]
fn added_lines_ignore_text_already_there() {
    let added = aep_ede::added_lines("a\nb\nb\n", "a\nb\nx\nb\nb\n");
    assert_eq!(added, vec![(3, "x".to_string()), (5, "b".to_string())]);
    assert_eq!(aep_ede::forge::base64(b"x-access-token:abc"), "eC1hY2Nlc3MtdG9rZW46YWJj");
    assert_eq!(aep_ede::forge::json_field("{\"html_url\": \"u\"}", "html_url").as_deref(), Some("u"));
}
