//! aep-ede: enforced draft environments for coding agents.
//!
//! A coding agent changes a repository only through a draft:
//!
//! 1. seed: a clone of the repository at a ref, with no push URL. The draft
//!    records the base commit.
//! 2. The agent edits the tree of the draft.
//! 3. diff: the change set against the base commit, new files included.
//! 4. scan: every change set is judged before it lands. The added lines of
//!    prose files pass the writing walls of AEP Admit (collect all, every finding
//!    at once). Symbolic links, submodules and drafts above their quota are
//!    refused. The digest of the change set is recorded.
//! 5. promote: the change set must equal the scanned one. The draft fetches the
//!    tip of its branch, rebases the work inside the draft (a conflict is refused
//!    with every path named), commits it and lands it through its forge.
//!
//! The forge decides what landing means: a pull request on GitHub, a branch on a
//! plain git remote. See the forge module.

pub mod forge;
pub mod profile;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub const QUOTA_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const PROSE: &[&str] = &[".md", ".markdown", ".txt", ".rst", ".adoc"];

/// The answer of every verb.
pub struct Report {
    pub ok: bool,
    pub code: String,
    pub draft: String,
    pub note: String,
}

impl Report {
    fn allow(code: &str, draft: &str, note: &str) -> Self {
        Report { ok: true, code: code.into(), draft: draft.into(), note: note.into() }
    }
    fn deny(code: &str, draft: &str, note: &str) -> Self {
        Report { ok: false, code: code.into(), draft: draft.into(), note: note.into() }
    }
    pub fn render(&self) -> String {
        let mut s = format!("verdict: {}\ncode: aep.ede.{}\ndraft: {}\n", if self.ok { "allow" } else { "deny" }, self.code, self.draft);
        if !self.note.is_empty() {
            s.push_str(&format!("note: {}\n", self.note));
        }
        s
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Put(String),
    Delete(String),
}

impl Change {
    pub fn path(&self) -> &str {
        match self {
            Change::Put(p) | Change::Delete(p) => p,
        }
    }
}

/// The root that holds the drafts: AEP_EDE_ROOT, then $HOME/.aep-ede.
pub fn root() -> PathBuf {
    if let Ok(v) = std::env::var("AEP_EDE_ROOT") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into())).join(".aep-ede")
}

fn draft_dir(draft: &str) -> Option<PathBuf> {
    if draft.is_empty() || draft.contains('/') || draft.contains("..") {
        return None;
    }
    let d = root().join(draft);
    if d.join("manifest").is_file() {
        Some(d)
    } else {
        None
    }
}

pub fn tree_dir(d: &Path) -> PathBuf {
    d.join("tree")
}

fn read_manifest(d: &Path) -> Vec<(String, String)> {
    fs::read_to_string(d.join("manifest"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once(": ").map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

fn field(d: &Path, key: &str) -> String {
    read_manifest(d).into_iter().find(|(k, _)| k == key).map(|(_, v)| v).unwrap_or_default()
}

fn set_fields(d: &Path, updates: &[(&str, &str)]) -> Result<(), String> {
    let mut m = read_manifest(d);
    for (k, v) in updates {
        match m.iter_mut().find(|(mk, _)| mk == k) {
            Some(slot) => slot.1 = v.to_string(),
            None => m.push((k.to_string(), v.to_string())),
        }
    }
    let body: String = m.iter().map(|(k, v)| format!("{}: {}\n", k, v)).collect();
    fs::write(d.join("manifest"), body).map_err(|e| e.to_string())
}

fn git(tree: &Path, env: &[(String, String)], args: &[&str]) -> Result<String, String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(tree).arg("-c").arg("core.hooksPath=/dev/null").args(args).env("GIT_TERMINAL_PROMPT", "0");
    for (k, v) in env {
        c.env(k, v);
    }
    let o = c.output().map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}

/// The git object hash of some bytes. Git does the hashing, so the crate needs no
/// hash code of its own.
fn hash_bytes(data: &[u8]) -> Result<String, String> {
    use std::io::Write as _;
    let mut child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("stdin")?.write_all(data).map_err(|e| e.to_string())?;
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

fn new_draft_id(repo: &str) -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tag = hash_bytes(format!("{}-{}-{}", repo, now, std::process::id()).as_bytes()).unwrap_or_default();
    format!("ede-{}-{}", now / 1_000_000_000, &tag[..12.min(tag.len())])
}

/// Seed a draft with a clone of `repo` at `reference`.
pub fn seed(forge: &dyn forge::Forge, repo: &str, reference: &str) -> Report {
    if repo.is_empty() || repo.contains("..") || repo.contains(' ') {
        return Report::deny("seed_repo", "", "name the repository as owner/name");
    }
    let prof = match profile::load() {
        Ok(p) => p,
        Err(e) => return Report::deny("profile_missing", "", &e),
    };
    if let Err(e) = prof.allow("seed", repo) {
        return Report::deny("profile_refused", "", &e);
    }
    let branch = if reference.is_empty() { "main" } else { reference };
    let draft = new_draft_id(repo);
    let d = root().join(&draft);
    if fs::create_dir_all(&d).is_err() {
        return Report::deny("seed_mkdir", &draft, &d.display().to_string());
    }
    let tree = tree_dir(&d);
    let url = forge.clone_url(repo);
    let mut c = Command::new("git");
    c.arg("clone").arg("-q").arg("--branch").arg(branch).arg(&url).arg(&tree).env("GIT_TERMINAL_PROMPT", "0");
    for (k, v) in forge.git_env() {
        c.env(k, v);
    }
    match c.output() {
        Ok(o) if o.status.success() => {}
        Ok(o) => {
            let _ = fs::remove_dir_all(&d);
            return Report::deny("seed_clone", "", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or("clone failed"));
        }
        Err(e) => {
            let _ = fs::remove_dir_all(&d);
            return Report::deny("seed_clone", "", &e.to_string());
        }
    }
    let _ = git(&tree, &[], &["remote", "set-url", "--push", "origin", "push-refused-only-aep-ede-promote-lands-work"]);
    let _ = git(&tree, &[], &["config", "user.name", "aep-ede"]);
    let _ = git(&tree, &[], &["config", "user.email", "aep-ede@localhost"]);
    let base = match git(&tree, &[], &["rev-parse", "HEAD"]) {
        Ok(s) => s.trim().to_string(),
        Err(e) => return Report::deny("seed_base", &draft, &e),
    };
    let _ = git(&tree, &[], &["checkout", "-q", "-B", "ede-work", &base]);
    let fields = [
        ("draft", draft.as_str()),
        ("agent", prof.agent_id.as_str()),
        ("forge", forge.name()),
        ("repo", repo),
        ("branch", branch),
        ("base", base.as_str()),
        ("state", "seeded"),
    ];
    let body: String = fields.iter().map(|(k, v)| format!("{}: {}\n", k, v)).collect();
    if fs::write(d.join("manifest"), body).is_err() {
        return Report::deny("seed_manifest", &draft, "");
    }
    Report::allow("seeded", &draft, &format!("work in {} then run aep-ede scan {}", tree.display(), draft))
}

/// The change set of a draft against its base commit.
pub fn changes(d: &Path) -> Result<Vec<Change>, String> {
    let tree = tree_dir(d);
    let base = field(d, "base");
    git(&tree, &[], &["add", "-A"])?;
    let raw = git(&tree, &[], &["diff", "--cached", "--raw", "--no-renames", "-z", &base])?;
    let mut out = Vec::new();
    let mut parts = raw.split('\0').filter(|s| !s.is_empty());
    while let Some(meta) = parts.next() {
        let path = parts.next().ok_or("diff parse")?.to_string();
        let f: Vec<&str> = meta.trim_start_matches(':').split_whitespace().collect();
        if f.len() < 5 {
            return Err("diff parse".into());
        }
        if f[4].starts_with('D') {
            out.push(Change::Delete(path));
            continue;
        }
        match f[1] {
            "120000" => return Err(format!("symbolic link {}", path)),
            "160000" => return Err(format!("submodule {}", path)),
            _ => out.push(Change::Put(path)),
        }
    }
    out.sort_by(|a, b| a.path().cmp(b.path()));
    Ok(out)
}

fn list_note(list: &[Change]) -> String {
    let mut s = format!("{} changes:", list.len());
    for c in list.iter().take(60) {
        match c {
            Change::Put(p) => s.push_str(&format!(" put {}", p)),
            Change::Delete(p) => s.push_str(&format!(" delete {}", p)),
        }
    }
    s
}

fn change_digest(d: &Path, list: &[Change]) -> Result<String, String> {
    let tree = tree_dir(d);
    let mut blob = String::new();
    for c in list {
        match c {
            Change::Put(p) => {
                let bytes = fs::read(tree.join(p)).map_err(|e| format!("{}: {}", p, e))?;
                blob.push_str(&format!("P\t{}\t{}\n", p, hash_bytes(&bytes)?));
            }
            Change::Delete(p) => blob.push_str(&format!("D\t{}\n", p)),
        }
    }
    hash_bytes(blob.as_bytes())
}

fn du_bytes(p: &Path) -> u64 {
    fn walk(p: &Path) -> u64 {
        let m = match fs::symlink_metadata(p) {
            Ok(m) => m,
            Err(_) => return 0,
        };
        if m.is_dir() {
            fs::read_dir(p).map(|rd| rd.flatten().map(|e| walk(&e.path())).sum()).unwrap_or(0)
        } else {
            m.len()
        }
    }
    walk(p)
}

/// The lines of `new` that `old` does not have, in order.
pub fn added_lines(old: &str, new: &str) -> Vec<(usize, String)> {
    let mut seen: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for l in old.lines() {
        *seen.entry(l).or_insert(0) += 1;
    }
    let mut out = Vec::new();
    for (i, l) in new.lines().enumerate() {
        match seen.get_mut(l) {
            Some(n) if *n > 0 => *n -= 1,
            _ => out.push((i + 1, l.to_string())),
        }
    }
    out
}

/// Every closed writing wall on the added lines of prose files.
fn writing_findings(d: &Path, list: &[Change]) -> Vec<String> {
    let tree = tree_dir(d);
    let base = field(d, "base");
    let mut out = Vec::new();
    for c in list {
        let p = match c {
            Change::Put(p) => p,
            Change::Delete(_) => continue,
        };
        let lower = p.to_ascii_lowercase();
        if !PROSE.iter().any(|ext| lower.ends_with(ext)) {
            continue;
        }
        let new = fs::read_to_string(tree.join(p)).unwrap_or_default();
        let old = git(&tree, &[], &["show", &format!("{}:{}", base, p)]).unwrap_or_default();
        for (n, line) in added_lines(&old, &new) {
            for w in aep_admit::compile_writing_walls(&line) {
                if w.closed {
                    out.push(format!("{}:{}: {} {}", p, n, w.id, w.reason));
                }
            }
        }
    }
    out
}

pub fn diff(draft: &str) -> Report {
    let d = match draft_dir(draft) {
        Some(d) => d,
        None => return Report::deny("draft_missing", draft, ""),
    };
    match changes(&d) {
        Ok(l) => Report::allow("diff", draft, &list_note(&l)),
        Err(e) => Report::deny("diff_refused", draft, &e),
    }
}

pub fn scan(draft: &str) -> Report {
    let d = match draft_dir(draft) {
        Some(d) => d,
        None => return Report::deny("draft_missing", draft, ""),
    };
    if let Err(r) = agent_gate(&d, draft, "scan") {
        return r;
    }
    let quota = std::env::var("AEP_EDE_QUOTA").ok().and_then(|v| v.parse().ok()).unwrap_or(QUOTA_BYTES);
    let used = du_bytes(&d);
    if used > quota {
        return Report::deny("scan_quota", draft, &format!("the draft holds {} bytes and its quota is {}", used, quota));
    }
    let list = match changes(&d) {
        Ok(l) => l,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    if list.is_empty() {
        return Report::deny("scan_empty", draft, "the draft has no change");
    }
    let findings = writing_findings(&d, &list);
    if !findings.is_empty() {
        return Report::deny("scan_writing", draft, &format!("{} findings: {}", findings.len(), findings.join(" | ")));
    }
    let digest = match change_digest(&d, &list) {
        Ok(x) => x,
        Err(e) => return Report::deny("scan_digest", draft, &e),
    };
    let count = list.len().to_string();
    if let Err(e) = set_fields(&d, &[("state", "scanned"), ("digest", &digest), ("changes", &count)]) {
        return Report::deny("scan_manifest", draft, &e);
    }
    Report::allow("scanned", draft, &list_note(&list))
}

/// Bring the draft onto the tip of its branch. The work is rebased inside the
/// draft and remains uncommitted on the new base.
fn sync_to_tip(d: &Path, forge: &dyn forge::Forge) -> Result<(), Report> {
    let draft = field(d, "draft");
    let tree = tree_dir(d);
    let branch = field(d, "branch");
    let base = field(d, "base");
    git(&tree, &forge.git_env(), &["fetch", "-q", "origin", &branch]).map_err(|e| Report::deny("tip_fetch", &draft, &e))?;
    let tip = git(&tree, &[], &["rev-parse", "FETCH_HEAD"]).map_err(|e| Report::deny("tip_fetch", &draft, &e))?.trim().to_string();
    if tip == base {
        return Ok(());
    }
    let dirty = !changes(d).map_err(|e| Report::deny("scan_tree", &draft, &e))?.is_empty();
    if dirty {
        git(&tree, &[], &["commit", "-q", "--no-verify", "-m", "ede work"]).map_err(|e| Report::deny("tip_commit", &draft, &e))?;
        if git(&tree, &[], &["rebase", "-q", &tip]).is_err() {
            let conflicts = git(&tree, &[], &["diff", "--name-only", "--diff-filter=U"]).unwrap_or_default();
            let _ = git(&tree, &[], &["rebase", "--abort"]);
            let _ = git(&tree, &[], &["reset", "-q", "--mixed", &base]);
            let paths: Vec<&str> = conflicts.lines().filter(|l| !l.is_empty()).collect();
            return Err(Report::deny("tip_conflict", &draft, &format!("{} moved and these paths conflict with the work: {}", branch, paths.join(" "))));
        }
        git(&tree, &[], &["reset", "-q", "--mixed", &tip]).map_err(|e| Report::deny("tip_reset", &draft, &e))?;
    } else {
        git(&tree, &[], &["checkout", "-q", "-B", "ede-work", &tip]).map_err(|e| Report::deny("tip_checkout", &draft, &e))?;
    }
    set_fields(d, &[("base", &tip)]).map_err(|e| Report::deny("tip_manifest", &draft, &e))?;
    Ok(())
}

pub fn refresh(forge: &dyn forge::Forge, draft: &str) -> Report {
    let d = match draft_dir(draft) {
        Some(d) => d,
        None => return Report::deny("draft_missing", draft, ""),
    };
    match sync_to_tip(&d, forge) {
        Ok(()) => Report::allow("at_tip", draft, &format!("base {}", field(&d, "base"))),
        Err(r) => r,
    }
}

pub fn promote(forge: &dyn forge::Forge, draft: &str, message: &str) -> Report {
    let d = match draft_dir(draft) {
        Some(d) => d,
        None => return Report::deny("draft_missing", draft, ""),
    };
    let prof = match agent_gate(&d, draft, "promote") {
        Ok(p) => p,
        Err(r) => return r,
    };
    if field(&d, "state") != "scanned" {
        return Report::deny("promote_not_scanned", draft, "run aep-ede scan first");
    }
    if message.trim().is_empty() {
        return Report::deny("promote_message", draft, "promote needs -m <message>");
    }
    let message = format!("{}\n\nAEP-Agent: {}", message.trim_end(), prof.agent_id);
    let message = message.as_str();
    let list = match changes(&d) {
        Ok(l) => l,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    match change_digest(&d, &list) {
        Ok(x) if x == field(&d, "digest") => {}
        Ok(_) => return Report::deny("promote_changed_since_scan", draft, "the tree changed after the scan: scan again"),
        Err(e) => return Report::deny("promote_digest", draft, &e),
    }
    if let Err(r) = sync_to_tip(&d, forge) {
        return r;
    }
    let tree = tree_dir(&d);
    let base = field(&d, "base");
    let repo = field(&d, "repo");
    let branch = field(&d, "branch");
    if let Err(e) = git(&tree, &[], &["add", "-A"]).and_then(|_| git(&tree, &[], &["commit", "-q", "--no-verify", "-m", message])) {
        return Report::deny("promote_commit", draft, &e);
    }
    let _ = git(&tree, &[], &["remote", "remove", "ede-land"]);
    if let Err(e) = git(&tree, &[], &["remote", "add", "ede-land", &forge.clone_url(&repo)]) {
        let _ = git(&tree, &[], &["reset", "-q", "--mixed", &base]);
        return Report::deny("promote_remote", draft, &e);
    }
    let landed = forge.land(&tree, &repo, &branch, draft, message);
    let _ = git(&tree, &[], &["remote", "remove", "ede-land"]);
    match landed {
        Ok(what) => {
            let commit = git(&tree, &[], &["rev-parse", "HEAD"]).unwrap_or_default().trim().to_string();
            let _ = set_fields(&d, &[("state", "promoted"), ("landed", &what), ("commit", &commit)]);
            Report::allow("promoted", draft, &format!("{} with {}", what, list_note(&list)))
        }
        Err(e) => {
            let _ = git(&tree, &[], &["reset", "-q", "--mixed", &base]);
            Report::deny("promote_land", draft, &e)
        }
    }
}

pub fn status(draft: &str) -> Report {
    match draft_dir(draft) {
        Some(d) => Report::allow(
            &field(&d, "state"),
            draft,
            &format!("tree {} repo {} base {} forge {}", tree_dir(&d).display(), field(&d, "repo"), field(&d, "base"), field(&d, "forge")),
        ),
        None => Report::deny("draft_missing", draft, ""),
    }
}

pub fn expire(draft: &str) -> Report {
    match draft_dir(draft) {
        Some(d) => {
            let _ = fs::remove_dir_all(&d);
            Report::allow("expired", draft, "")
        }
        None => Report::deny("draft_missing", draft, ""),
    }
}

/// The profile of the running agent, checked for ede.<verb> on the repository of
/// the draft. A draft belongs to the agent that seeded it.
fn agent_gate(d: &Path, draft: &str, verb: &str) -> Result<profile::Profile, Report> {
    let prof = profile::load().map_err(|e| Report::deny("profile_missing", draft, &e))?;
    prof.allow(verb, &field(d, "repo")).map_err(|e| Report::deny("profile_refused", draft, &e))?;
    let owner = field(d, "agent");
    if owner != prof.agent_id {
        return Err(Report::deny("draft_foreign_agent", draft, &format!("the draft belongs to the agent {}", owner)));
    }
    Ok(prof)
}
