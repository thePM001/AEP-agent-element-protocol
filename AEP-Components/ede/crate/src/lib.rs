//! aep-ede: enforced draft environments for coding agents.
//!
//! A coding agent changes a repository only through a draft:
//!
//! 1. seed: a clone of the repository at a branch. The git folder sits beside the tree
//!    of the draft, never inside it. A sealed record in the record root of the operator
//!    names the draft, the agent, the repository, the branch and the base commit.
//! 2. The agent edits the tree of the draft.
//! 3. diff: the change set against the base commit, new files included.
//! 4. scan: git writes the tree object of the draft and scan judges its blobs. The added
//!    lines of prose files pass the writing walls of AEP Admit (collect all, every
//!    finding at once). Symbolic links, submodules, blobs that do not hold the bytes
//!    their ids name, prose that is not UTF-8 text and drafts above their quota are
//!    refused. The scan binds the tree id, the full listing with modes and the times of
//!    seed and scan into one statement whose sha256 is the scan id.
//! 5. promote: the scan must be inside its age bound. promote fetches the tip of the
//!    branch. When the branch moved it merges the scanned tree onto the tip and scans
//!    the merged tree again. It lands exactly that tree as one commit on the tip, with
//!    the trailers AEP-Agent, AEP-EDE-Draft, AEP-EDE-Scan and AEP-EDE-Base.
//!
//! Every verb proves the identity of the agent with a frame signed by its registered
//! key (identity.rs), passes its agent profile from the operator folder (profile.rs),
//! holds the lock of the draft and asks the EDE lifecycle wall of dynAEP.

pub mod forge;
pub mod git;
pub mod ident;
pub mod identity;
pub mod operator;
pub mod privilege;
pub mod profile;
pub mod seal;
pub mod store;

use operator::Operator;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use store::{Record, State};

const PROSE: &[&str] = &[".md", ".markdown", ".txt", ".rst", ".adoc"];
const SHIPPED_LATTICE: &str = include_str!("../../../dynAEP/registries/aep-lattice.yaml");

/// The answer of every verb.
pub struct Report {
    pub ok: bool,
    pub code: String,
    pub draft: String,
    pub note: String,
}

impl Report {
    fn allow(code: &str, draft: &str, note: &str) -> Self {
        Report {
            ok: true,
            code: code.into(),
            draft: draft.into(),
            note: note.into(),
        }
    }
    fn deny(code: &str, draft: &str, note: &str) -> Self {
        Report {
            ok: false,
            code: code.into(),
            draft: draft.into(),
            note: note
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .collect(),
        }
    }
    pub fn render(&self) -> String {
        let mut s = format!(
            "verdict: {}\ncode: aep.ede.{}\ndraft: {}\n",
            if self.ok { "allow" } else { "deny" },
            self.code,
            self.draft
        );
        if !self.note.is_empty() {
            s.push_str(&format!("note: {}\n", self.note));
        }
        s
    }
}

/// The search path of every child process. A release build never takes the path of its
/// caller, so a program the agent put first on its path never stands in for git.
pub fn child_path() -> String {
    #[cfg(feature = "test-env")]
    {
        if let Ok(p) = std::env::var("PATH") {
            return p;
        }
    }
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin".to_string()
}

/// The unix second of now. Test builds read AEP_EDE_TEST_NOW.
pub fn unix_now() -> u64 {
    #[cfg(feature = "test-env")]
    {
        if let Some(n) = std::env::var("AEP_EDE_TEST_NOW")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            return n;
        }
    }
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The context of one verb.
pub struct Ctx {
    pub op: Operator,
    pub now: u64,
}

impl Ctx {
    pub fn load() -> Ctx {
        privilege::init();
        Ctx {
            op: operator::load(),
            now: unix_now(),
        }
    }

    fn preamble(&self) -> Result<(), Report> {
        if let Some(why) = &self.op.broken {
            return Err(Report::deny("operator", "", why));
        }
        store::ensure_layout(&self.op).map_err(|e| Report::deny("record_root", "", &e))
    }

    fn lattice(
        &self,
    ) -> Result<std::collections::HashMap<String, aep_dynaep::LatticeNode>, String> {
        let text = match &self.op.lattice {
            Some(p) => {
                let _r = privilege::raise();
                fs::read_to_string(p).map_err(|e| format!("lattice {}: {}", p.display(), e))?
            }
            None => SHIPPED_LATTICE.to_string(),
        };
        aep_dynaep::load_lattice_yaml(&text).map_err(|e| e.to_string())
    }

    /// Ask the EDE lifecycle wall of dynAEP about one verb.
    pub fn wall(&self, verb: &str, r: Option<&Record>) -> Result<(), String> {
        let mut satisfied = BTreeSet::new();
        if let Some(r) = r {
            satisfied.insert("ede.seed".to_string());
            if matches!(r.state, State::Scanned | State::Promoting | State::Promoted) {
                satisfied.insert("ede.scan".to_string());
            }
            // aep-ede runs no CI of its own: the required checks of the forge decide the
            // merge, so verify counts as done.
            satisfied.insert("ede.verify".to_string());
        }
        let req = aep_dynaep::ede::EdeRequest {
            verb: verb.to_string(),
            state: r
                .map(|r| r.state.as_str().to_string())
                .unwrap_or_else(|| "none".into()),
            satisfied,
            now: self.now,
            seeded: r.map(|r| r.seeded_unix).unwrap_or(0),
            scanned: r.map(|r| r.scan_unix).unwrap_or(0),
            sealed: 0,
            draft_max: self.op.draft_max_age_secs,
            scan_max: self.op.scan_max_age_secs,
            seal_max: self.op.seal_max_age_secs,
        };
        let result = aep_dynaep::ede::ede_wall(&self.lattice()?, &req);
        if result.allow {
            Ok(())
        } else {
            Err(format!(
                "the dynAEP lifecycle wall refused ede.{}: {}",
                verb,
                result
                    .closed
                    .iter()
                    .map(|w| format!("{} {}", w.id, w.reason))
                    .collect::<Vec<_>>()
                    .join(" | ")
            ))
        }
    }

    /// A draft a verb works on: its lock, a valid record, the proven agent that seeded it,
    /// the grant of its profile and the lifecycle wall.
    fn open(
        &self,
        draft: &str,
        verb: &str,
        grant: &str,
        ask_wall: bool,
    ) -> Result<(Record, store::DraftLock, profile::Profile), Report> {
        let lock = store::lock(&self.op, draft).map_err(|e| {
            let code = if ident::draft_id_ok(draft) {
                "draft_busy"
            } else {
                "draft_id_grammar"
            };
            Report::deny(code, draft, &e)
        })?;
        let r = store::load(&self.op, draft).map_err(|e| {
            let note = match &e {
                store::LoadError::Broken(m) => m.clone(),
                _ => String::new(),
            };
            Report::deny(e.code(), draft, &note)
        })?;
        let agent = identity::caller(&self.op, verb, draft, &r.repo, self.now)
            .map_err(|e| Report::deny("identity", draft, &e))?;
        if agent != r.agent {
            return Err(Report::deny(
                "draft_foreign_agent",
                draft,
                &format!("the draft belongs to the agent {}", r.agent),
            ));
        }
        let prof = profile::load(&self.op, &agent)
            .map_err(|e| Report::deny("profile_missing", draft, &e))?;
        prof.allow(grant, &r.repo)
            .map_err(|e| Report::deny("profile_refused", draft, &e))?;
        if r.state.terminal() {
            return Err(Report::deny(
                &format!("draft_{}", r.state.as_str()),
                draft,
                "no verb leaves this state: seed a new draft",
            ));
        }
        if ask_wall {
            self.wall(verb, Some(&r))
                .map_err(|e| Report::deny("lifecycle_wall", draft, &e))?;
        }
        Ok((r, lock, prof))
    }

    fn event(&self, kind: &str, r: &Record, detail: &str) {
        let _ = store::ledger(&self.op, kind, r, detail, self.now);
    }
}

fn is_prose(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    PROSE.iter().any(|ext| lower.ends_with(ext))
}

fn list_note(list: &[git::Entry]) -> String {
    let mut s = format!("{} changes:", list.len());
    for c in list.iter().take(60) {
        s.push_str(&format!(
            " {} {}",
            if c.delete { "delete" } else { "put" },
            c.path
        ));
    }
    if list.len() > 60 {
        s.push_str(" and more");
    }
    s
}

fn restore(ctx: &Ctx, r: &Record) -> Result<(), String> {
    let config = store::load_git_config(&ctx.op, &r.draft_id)?;
    git::restore(r, &config)
}

/// Mint a draft id and create its folder with an exclusive create, retrying on a clash.
fn new_draft_folder(ctx: &Ctx, agent: &str) -> Result<(String, PathBuf), String> {
    let parent = ctx.op.state_root.join(agent);
    fs::create_dir_all(&parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    for _ in 0..16 {
        let id = ident::mint_draft_id(ctx.now)?;
        #[cfg(feature = "test-env")]
        let id = test_clash(id);
        let folder = parent.join(&id);
        match fs::create_dir(&folder) {
            Ok(()) => return Ok((id, folder)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{}: {}", folder.display(), e)),
        }
    }
    Err("no free draft id after 16 tries".into())
}

#[cfg(feature = "test-env")]
fn test_clash(id: String) -> String {
    use std::sync::atomic::{AtomicBool, Ordering};
    static USED: AtomicBool = AtomicBool::new(false);
    match std::env::var("AEP_EDE_TEST_CLASH") {
        Ok(v) if !v.is_empty() && !USED.swap(true, Ordering::SeqCst) => v,
        _ => id,
    }
}

/// Seed a draft with a clone of `repo` at `reference`.
pub fn seed(repo: &str, reference: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let owner = if ctx.op.default_owner.is_empty() {
        "-"
    } else {
        ctx.op.default_owner.as_str()
    };
    let repo = match ident::repo(repo, owner) {
        Ok(r) => r,
        Err(e) => return Report::deny("seed_repo", "", &e),
    };
    let branch = if reference.is_empty() {
        "main"
    } else {
        reference
    };
    if !ident::branch_ok(branch) {
        return Report::deny(
            "seed_branch",
            "",
            "the branch name is outside the grammar of git branch names",
        );
    }
    let agent = match identity::caller(&ctx.op, "seed", "", &repo.canonical, ctx.now) {
        Ok(a) => a,
        Err(e) => return Report::deny("identity", "", &e),
    };
    let prof = match profile::load(&ctx.op, &agent) {
        Ok(p) => p,
        Err(e) => return Report::deny("profile_missing", "", &e),
    };
    if let Err(e) = prof.allow("seed", &repo.canonical) {
        return Report::deny("profile_refused", "", &e);
    }
    if let Err(e) = ctx.wall("seed", None) {
        return Report::deny("lifecycle_wall", "", &e);
    }
    let (draft, folder) = match new_draft_folder(&ctx, &agent) {
        Ok(x) => x,
        Err(e) => return Report::deny("seed_mkdir", "", &e),
    };
    let forge = forge::of(&ctx.op);
    let mut r = Record::new(&draft, &agent, &folder, ctx.now);
    r.repo = repo.canonical.clone();
    r.repo_owner = repo.owner.clone();
    r.repo_name = repo.name.clone();
    r.branch = branch.to_string();
    // Only the folder this seed created is ever removed on a failure.
    let undo = |code: &str, note: &str| {
        let _ = fs::remove_dir_all(&folder);
        Report::deny(code, "", note)
    };
    let (base, config) = match git::clone(&r, &forge.git_env(), &forge.url(&repo), branch) {
        Ok(x) => x,
        Err(e) => return undo("seed_clone", &e),
    };
    r.base = base.clone();
    if let Err(e) = store::save_git_config(&ctx.op, &draft, &config) {
        return undo("seed_record", &e);
    }
    if let Err(e) = store::create(&ctx.op, &r) {
        return undo("seed_record", &e);
    }
    ctx.event("seed", &r, &format!("{} at {}", branch, base));
    Report::allow(
        "seeded",
        &draft,
        &format!(
            "work in {} then run aep-ede scan {}",
            r.tree().display(),
            draft
        ),
    )
}

pub fn diff(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, _) = match ctx.open(draft, "diff", "scan", false) {
        Ok(x) => x,
        Err(e) => return e,
    };
    let listed = restore(&ctx, &r)
        .and_then(|_| git::write_tree(&r))
        .and_then(|t| git::tree_changes(&r, &r.base, &t));
    match listed {
        Ok(l) => Report::allow("diff", draft, &list_note(&l)),
        Err(e) => Report::deny("diff_refused", draft, &e),
    }
}

/// Every finding of a change set from `from` to `tree`.
fn findings(r: &Record, from: &str, tree: &str, list: &[git::Entry]) -> Vec<String> {
    let mut out = Vec::new();
    for e in list {
        if e.delete {
            continue;
        }
        match e.mode.as_str() {
            "120000" => {
                out.push(format!("{}: symbolic link", e.path));
                continue;
            }
            "160000" => {
                out.push(format!("{}: submodule", e.path));
                continue;
            }
            _ => {}
        }
        let bytes = match git::blob(r, &e.id) {
            Ok(b) => b,
            Err(x) => {
                out.push(format!("{}: {}", e.path, x));
                continue;
            }
        };
        if !is_prose(&e.path) {
            continue;
        }
        if std::str::from_utf8(&bytes).is_err() {
            out.push(format!("{}: prose file that is not UTF-8 text", e.path));
            continue;
        }
        match git::added_lines(r, from, tree, &e.path) {
            Ok(lines) => {
                for (n, line) in lines {
                    for w in aep_admit::compile_writing_walls(&line) {
                        if w.closed {
                            out.push(format!("{}:{}: {} {}", e.path, n, w.id, w.reason));
                        }
                    }
                }
            }
            Err(x) => out.push(format!("{}: {}", e.path, x)),
        }
    }
    out
}

fn policy_digest(prof: &profile::Profile) -> String {
    let mut b = format!(
        "aep-ede {} writing walls of aep-admit\n",
        env!("CARGO_PKG_VERSION")
    )
    .into_bytes();
    let _r = privilege::raise();
    b.extend(fs::read(&prof.path).unwrap_or_default());
    seal::sha256_hex(&b)
}

pub fn scan(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (mut r, _lock, prof) = match ctx.open(draft, "scan", "scan", true) {
        Ok(x) => x,
        Err(e) => return e,
    };
    let used = git::du_bytes(&r.folder);
    if used > ctx.op.quota_bytes {
        return Report::deny(
            "scan_quota",
            draft,
            &format!(
                "the draft holds {} bytes and its quota is {}",
                used, ctx.op.quota_bytes
            ),
        );
    }
    if let Err(e) = restore(&ctx, &r) {
        return Report::deny("scan_tree", draft, &e);
    }
    let tree = match git::write_tree(&r) {
        Ok(t) => t,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    let list = match git::tree_changes(&r, &r.base, &tree) {
        Ok(l) => l,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    if list.is_empty() {
        return Report::deny("scan_empty", draft, "the draft has no change");
    }
    let f = findings(&r, &r.base, &tree, &list);
    if !f.is_empty() {
        return Report::deny(
            "scan_findings",
            draft,
            &format!("{} findings: {}", f.len(), f.join(" | ")),
        );
    }
    let listed = match git::listing(&r, &tree) {
        Ok(l) => l,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    r.state = State::Scanned;
    r.scan_tree = tree;
    r.scan_list = listed;
    r.scan_unix = ctx.now;
    r.policy_digest = policy_digest(&prof);
    r.scan_id = store::Statement::of_record(&r).id();
    if let Err(e) = store::save(&ctx.op, &r) {
        return Report::deny("scan_record", draft, &e);
    }
    ctx.event(
        "scan",
        &r,
        &format!("tree {} with {} changes", r.scan_tree, list.len()),
    );
    Report::allow(
        "scanned",
        draft,
        &format!("{} | scan {}", list_note(&list), r.scan_id),
    )
}

/// The trailers every landed commit carries.
pub fn trailers(msg: &str, r: &Record) -> String {
    format!(
        "{}\n\nAEP-Agent: {}\nAEP-EDE-Draft: {}\nAEP-EDE-Scan: {}\nAEP-EDE-Base: {}",
        msg.trim_end(),
        r.agent,
        r.draft_id,
        r.scan_id,
        r.base
    )
}

pub fn promote(draft: &str, message: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (mut r, _lock, prof) = match ctx.open(draft, "promote", "promote", true) {
        Ok(x) => x,
        Err(e) => return e,
    };
    if !matches!(r.state, State::Scanned | State::Promoting) {
        return Report::deny("promote_not_scanned", draft, "run aep-ede scan first");
    }
    if r.scan_id.is_empty() || r.scan_id != store::Statement::of_record(&r).id() {
        return Report::deny(
            "promote_scan_forged",
            draft,
            "the scan id does not match the scanned statement",
        );
    }
    if ctx.now.saturating_sub(r.seeded_unix) > ctx.op.draft_max_age_secs {
        return Report::deny(
            "draft_too_old",
            draft,
            "the draft is older than its bound: seed a new draft",
        );
    }
    if ctx.now.saturating_sub(r.scan_unix) > ctx.op.scan_max_age_secs {
        return Report::deny(
            "scan_too_old",
            draft,
            "the scan is older than its bound: scan again",
        );
    }
    if message.trim().is_empty() {
        return Report::deny("promote_message", draft, "promote needs -m <message>");
    }
    if message.chars().any(|c| c.is_control() && c != '\n') {
        return Report::deny(
            "promote_message",
            draft,
            "the message holds a control character other than a line break",
        );
    }
    if let Err(e) = restore(&ctx, &r) {
        return Report::deny("promote_tree", draft, &e);
    }
    match git::listing(&r, &r.scan_tree) {
        Ok(d) if d == r.scan_list => {}
        Ok(_) => {
            return Report::deny(
                "promote_scan_forged",
                draft,
                "the scanned tree no longer lists what the scan recorded",
            )
        }
        Err(e) => return Report::deny("promote_scan_forged", draft, &e),
    }
    let forge = forge::of(&ctx.op);
    let repo = ident::Repo {
        canonical: r.repo.clone(),
        owner: r.repo_owner.clone(),
        name: r.repo_name.clone(),
    };
    let url = forge.url(&repo);
    let env = forge.git_env();
    let tip = match git::fetch_tip(&r, &env, &url) {
        Ok(t) => t,
        Err(e) => return Report::deny("tip_fetch", draft, &e),
    };
    let mut rescanned = String::new();
    if tip != r.base {
        let merged = match git::merge_onto(&r, &r.base, &r.scan_tree, &tip) {
            Ok(t) => t,
            Err(Ok(paths)) => {
                return Report::deny(
                    "tip_conflict",
                    draft,
                    &format!(
                        "{} moved and these paths conflict with the work: {}",
                        r.branch,
                        paths.join(" ")
                    ),
                )
            }
            Err(Err(e)) => return Report::deny("tip_merge", draft, &e),
        };
        let list = match git::tree_changes(&r, &tip, &merged) {
            Ok(l) if !l.is_empty() => l,
            Ok(_) => return Report::deny("promote_empty", draft, "the work is already on the tip"),
            Err(e) => return Report::deny("scan_tree", draft, &e),
        };
        let f = findings(&r, &tip, &merged, &list);
        if !f.is_empty() {
            return Report::deny("promote_rescan_findings", draft, &format!("the rescan of the tree merged onto the moved branch refused it: {} findings: {}", f.len(), f.join(" | ")));
        }
        r.rebased_from = r.base.clone();
        r.base = tip.clone();
        r.scan_list = match git::listing(&r, &merged) {
            Ok(l) => l,
            Err(e) => return Report::deny("scan_tree", draft, &e),
        };
        r.scan_tree = merged;
        r.scan_unix = ctx.now;
        r.policy_digest = policy_digest(&prof);
        r.scan_id = store::Statement::of_record(&r).id();
        rescanned = format!(" | rescanned on {}", tip);
        if let Err(e) = store::save(&ctx.op, &r) {
            return Report::deny("scan_record", draft, &e);
        }
        ctx.event(
            "rescan",
            &r,
            &format!("tree {} on {} from {}", r.scan_tree, r.base, r.rebased_from),
        );
    }
    if let Err(e) = forge.ready() {
        return Report::deny("promote_land", draft, &e);
    }
    let message = trailers(message, &r);
    let commit = match git::landing_commit(&r, &r.scan_tree, &tip, &message, r.scan_unix) {
        Ok(c) => c,
        Err(e) => return Report::deny("promote_commit", draft, &e),
    };
    r.state = State::Promoting;
    if let Err(e) = store::save(&ctx.op, &r) {
        return Report::deny("promote_record", draft, &e);
    }
    let target = forge.target(&r.branch, draft);
    let own = target == format!("aep-ede/{}", draft);
    if let Err(e) = git::push(&r, &env, &url, &commit, &target, own) {
        return back_to_scanned(&ctx, r, Report::deny("promote_land", draft, &e));
    }
    let landed = match forge.after_push(&repo, &r.branch, &target, &message) {
        Ok(w) => w,
        Err(e) => return back_to_scanned(&ctx, r, Report::deny("promote_land", draft, &e)),
    };
    r.state = State::Promoted;
    r.commit = commit.clone();
    r.landed = landed.clone();
    r.landed_unix = ctx.now;
    if let Err(e) = store::save(&ctx.op, &r) {
        return Report::deny(
            "promote_record",
            draft,
            &format!("landed {} but the record was not written: {}", commit, e),
        );
    }
    ctx.event("promote", &r, &format!("{} commit {}", landed, commit));
    Report::allow(
        "promoted",
        draft,
        &format!(
            "{} with commit {} | scan {}{}",
            landed, commit, r.scan_id, rescanned
        ),
    )
}

fn back_to_scanned(ctx: &Ctx, mut r: Record, rep: Report) -> Report {
    r.state = State::Scanned;
    let _ = store::save(&ctx.op, &r);
    rep
}

/// Bring the draft onto the tip of its branch. The work remains uncommitted on the new
/// base. A conflict changes nothing. A refresh ends any scan.
pub fn refresh(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (mut r, _lock, _) = match ctx.open(draft, "refresh", "refresh", true) {
        Ok(x) => x,
        Err(e) => return e,
    };
    if let Err(e) = restore(&ctx, &r) {
        return Report::deny("tip_fetch", draft, &e);
    }
    let forge = forge::of(&ctx.op);
    let repo = ident::Repo {
        canonical: r.repo.clone(),
        owner: r.repo_owner.clone(),
        name: r.repo_name.clone(),
    };
    let tip = match git::fetch_tip(&r, &forge.git_env(), &forge.url(&repo)) {
        Ok(t) => t,
        Err(e) => return Report::deny("tip_fetch", draft, &e),
    };
    if tip == r.base {
        return Report::allow("at_tip", draft, &format!("base {}", tip));
    }
    let work = match git::write_tree(&r) {
        Ok(t) => t,
        Err(e) => return Report::deny("scan_tree", draft, &e),
    };
    let base_tree = git::git(&r, &["rev-parse", &format!("{}^{{tree}}", r.base)])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let target = if work == base_tree {
        format!("{}^{{tree}}", tip)
    } else {
        match git::merge_onto(&r, &r.base, &work, &tip) {
            Ok(t) => t,
            Err(Ok(paths)) => {
                return Report::deny(
                    "tip_conflict",
                    draft,
                    &format!(
                        "{} moved and these paths conflict with the work: {}",
                        r.branch,
                        paths.join(" ")
                    ),
                )
            }
            Err(Err(e)) => return Report::deny("tip_merge", draft, &e),
        }
    };
    let moved = git::git(&r, &["read-tree", "--reset", "-u", &target])
        .and_then(|_| git::git(&r, &["update-ref", "refs/heads/ede-work", &tip]))
        .and_then(|_| git::git(&r, &["symbolic-ref", "HEAD", "refs/heads/ede-work"]))
        .and_then(|_| git::git(&r, &["reset", "-q"]));
    if let Err(e) = moved {
        return Report::deny("tip_reset", draft, &e);
    }
    r.rebased_from = r.base.clone();
    r.base = tip.clone();
    r.state = State::Seeded;
    r.scan_id.clear();
    r.scan_tree.clear();
    r.scan_list.clear();
    r.scan_unix = 0;
    if let Err(e) = store::save(&ctx.op, &r) {
        return Report::deny("tip_record", draft, &e);
    }
    ctx.event(
        "refresh",
        &r,
        &format!("base {} from {}", tip, r.rebased_from),
    );
    Report::allow("refreshed", draft, &format!("base {}", tip))
}

pub fn status(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let r = match store::load(&ctx.op, draft) {
        Ok(r) => r,
        Err(e) => return Report::deny(e.code(), draft, ""),
    };
    let agent = match identity::caller(&ctx.op, "status", draft, &r.repo, ctx.now) {
        Ok(a) => a,
        Err(e) => return Report::deny("identity", draft, &e),
    };
    if agent != r.agent {
        return Report::deny(
            "draft_foreign_agent",
            draft,
            &format!("the draft belongs to the agent {}", r.agent),
        );
    }
    Report::allow(
        r.state.as_str(),
        draft,
        &format!(
            "tree {} repo {} base {} scan {}",
            r.tree().display(),
            r.repo,
            r.base,
            r.scan_id
        ),
    )
}

/// Expire a draft: the folder goes, the record remains as a tombstone and the ledger names it.
pub fn expire(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, _) = match ctx.open(draft, "expire", "expire", true) {
        Ok(x) => x,
        Err(e) => return e,
    };
    match tombstone(&ctx, r, "expire", "expired by its agent") {
        Ok(()) => Report::allow("expired", draft, ""),
        Err(e) => Report::deny("expire_record", draft, &e),
    }
}

fn tombstone(ctx: &Ctx, mut r: Record, kind: &str, why: &str) -> Result<(), String> {
    if r.folder.starts_with(&ctx.op.state_root)
        && r.folder.file_name().and_then(|n| n.to_str()) == Some(r.draft_id.as_str())
    {
        let _ = fs::remove_dir_all(&r.folder);
    }
    r.state = State::Expired;
    store::save(&ctx.op, &r)?;
    ctx.event(kind, &r, why);
    Ok(())
}

/// The sweep of the operator: drafts past their age bound expire with a tombstone and
/// empty agent folders go. Only root or the EDE user runs it.
pub fn sweep() -> Vec<String> {
    let ctx = Ctx::load();
    let mut out = Vec::new();
    if let Some(why) = &ctx.op.broken {
        out.push(format!("refused: {}", why));
        return out;
    }
    let uid = privilege::caller_uid();
    if uid != 0 && Some(uid) != privilege::uid_of(&ctx.op.ede_user) {
        out.push("refused: only the EDE user or root runs the sweep".into());
        return out;
    }
    if let Err(e) = store::ensure_layout(&ctx.op) {
        out.push(format!("refused: {}", e));
        return out;
    }
    for id in store::all_ids(&ctx.op) {
        let Ok(lock) = store::lock(&ctx.op, &id) else {
            out.push(format!("busy {}", id));
            continue;
        };
        let r = match store::load(&ctx.op, &id) {
            Ok(r) => r,
            Err(e) => {
                out.push(format!("unreadable {} {}", id, e.code()));
                continue;
            }
        };
        if !r.state.terminal() && ctx.now.saturating_sub(r.seeded_unix) > ctx.op.draft_max_age_secs
        {
            match tombstone(&ctx, r, "sweep", "past the draft age bound") {
                Ok(()) => out.push(format!("expired {}", id)),
                Err(e) => out.push(format!("failed {} {}", id, e)),
            }
        }
        drop(lock);
    }
    if let Ok(rd) = fs::read_dir(&ctx.op.state_root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir()
                && fs::read_dir(&p)
                    .map(|mut r| r.next().is_none())
                    .unwrap_or(false)
            {
                let _ = fs::remove_dir(&p);
                out.push(format!("removed empty {}", p.display()));
            }
        }
    }
    out
}

/// The path of the tree of a draft, for callers outside this crate.
pub fn tree_dir(folder: &Path) -> PathBuf {
    folder.join("tree")
}
