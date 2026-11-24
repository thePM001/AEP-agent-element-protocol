//! The protected record root of aep-ede.
//!
//! The record root of the operator (owner the EDE user) holds what proves something:
//!
//! - drafts/<draft>.rec: the sealed record of each draft. The draft id inside equals
//!   the file name and the name of the draft folder. The state moves forward only:
//!   seeded, scanned, promoting, then promoted or expired. No verb leaves promoted or
//!   expired.
//! - ledger/ledger.rec: one chained, sealed entry per seed, scan, rescan, refresh,
//!   promote, expire and sweep. Each entry names the hash of the one before it.
//! - locks/<draft>.lock: one lock per draft for every verb.
//! - git-config/<draft>.config: the git configuration the seed wrote, put back before
//!   every git call of a verb.
//!
//! Every record write is a temporary file plus rename.

use crate::ident;
use crate::operator::Operator;
use crate::privilege;
use crate::seal;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

pub const RECORD_SCHEMA: &str = "aep.ede.draft-record.v2";
pub const LEDGER_SCHEMA: &str = "aep.ede.ledger.v1";
pub const STATEMENT_KIND: &str = "aep-ede-scan-v1";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Seeded,
    Scanned,
    Promoting,
    Promoted,
    Expired,
}

impl State {
    pub fn as_str(&self) -> &'static str {
        match self {
            State::Seeded => "seeded",
            State::Scanned => "scanned",
            State::Promoting => "promoting",
            State::Promoted => "promoted",
            State::Expired => "expired",
        }
    }
    pub fn parse(s: &str) -> Option<State> {
        Some(match s {
            "seeded" => State::Seeded,
            "scanned" => State::Scanned,
            "promoting" => State::Promoting,
            "promoted" => State::Promoted,
            "expired" => State::Expired,
            _ => return None,
        })
    }
    pub fn terminal(&self) -> bool {
        matches!(self, State::Promoted | State::Expired)
    }
}

/// The record of one draft.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub draft_id: String,
    pub agent: String,
    pub folder: PathBuf,
    pub repo: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub branch: String,
    pub base: String,
    pub seeded_unix: u64,
    pub state: State,
    pub scan_id: String,
    pub scan_tree: String,
    pub scan_list: String,
    pub scan_unix: u64,
    pub policy_digest: String,
    pub rebased_from: String,
    pub commit: String,
    pub landed: String,
    pub landed_unix: u64,
}

impl Record {
    pub fn new(draft_id: &str, agent: &str, folder: &Path, now: u64) -> Record {
        Record {
            draft_id: draft_id.into(),
            agent: agent.into(),
            folder: folder.to_path_buf(),
            repo: String::new(),
            repo_owner: String::new(),
            repo_name: String::new(),
            branch: String::new(),
            base: String::new(),
            seeded_unix: now,
            state: State::Seeded,
            scan_id: String::new(),
            scan_tree: String::new(),
            scan_list: String::new(),
            scan_unix: 0,
            policy_digest: String::new(),
            rebased_from: String::new(),
            commit: String::new(),
            landed: String::new(),
            landed_unix: 0,
        }
    }

    pub fn tree(&self) -> PathBuf {
        self.folder.join("tree")
    }
    pub fn git_dir(&self) -> PathBuf {
        self.folder.join("git")
    }

    fn fields(&self) -> Vec<(&'static str, String)> {
        vec![
            ("draft_id", self.draft_id.clone()),
            ("agent", self.agent.clone()),
            ("folder", self.folder.display().to_string()),
            ("repo", self.repo.clone()),
            ("repo_owner", self.repo_owner.clone()),
            ("repo_name", self.repo_name.clone()),
            ("branch", self.branch.clone()),
            ("base", self.base.clone()),
            ("seeded_unix", self.seeded_unix.to_string()),
            ("state", self.state.as_str().into()),
            ("scan_id", self.scan_id.clone()),
            ("scan_tree", self.scan_tree.clone()),
            ("scan_list", self.scan_list.clone()),
            ("scan_unix", self.scan_unix.to_string()),
            ("policy_digest", self.policy_digest.clone()),
            ("rebased_from", self.rebased_from.clone()),
            ("commit", self.commit.clone()),
            ("landed", self.landed.clone()),
            ("landed_unix", self.landed_unix.to_string()),
        ]
    }

    pub fn body(&self) -> Result<String, String> {
        let mut s = format!(
            "schema_id: {}\nformat: aep-record\njson: prohibited\n",
            RECORD_SCHEMA
        );
        for (k, v) in self.fields() {
            if !ident::value_ok(&v) {
                return Err(format!("{} holds a control character", k));
            }
            s.push_str(&format!("{}: {}\n", k, v));
        }
        Ok(s)
    }

    fn parse(body: &str) -> Result<Record, String> {
        let mut got: Vec<(String, String)> = Vec::new();
        for line in body.lines() {
            if let Some((k, v)) = line.split_once(": ") {
                if got.iter().any(|(gk, _)| gk == k) {
                    return Err(format!("the record names {} twice", k));
                }
                got.push((k.to_string(), v.to_string()));
            }
        }
        let f = |k: &str| {
            got.iter()
                .find(|(gk, _)| gk == k)
                .map(|(_, v)| v.clone())
                .unwrap_or_default()
        };
        let n = |k: &str| f(k).parse::<u64>().unwrap_or(0);
        if f("schema_id") != RECORD_SCHEMA {
            return Err("not a draft record of aep-ede".into());
        }
        Ok(Record {
            draft_id: f("draft_id"),
            agent: f("agent"),
            folder: PathBuf::from(f("folder")),
            repo: f("repo"),
            repo_owner: f("repo_owner"),
            repo_name: f("repo_name"),
            branch: f("branch"),
            base: f("base"),
            seeded_unix: n("seeded_unix"),
            state: State::parse(&f("state")).ok_or("state")?,
            scan_id: f("scan_id"),
            scan_tree: f("scan_tree"),
            scan_list: f("scan_list"),
            scan_unix: n("scan_unix"),
            policy_digest: f("policy_digest"),
            rebased_from: f("rebased_from"),
            commit: f("commit"),
            landed: f("landed"),
            landed_unix: n("landed_unix"),
        })
    }
}

/// Write `body` to `path` through a temporary file in the same folder and a rename.
pub fn atomic_write(path: &Path, body: &[u8], mode: u32) -> Result<(), String> {
    let dir = path.parent().ok_or("no folder")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("no name")?;
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        name,
        hex::encode(ident::random_bytes::<8>()?)
    ));
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&tmp)
            .map_err(|e| format!("{}: {}", tmp.display(), e))?;
        if let Err(e) = f.write_all(body).and_then(|_| f.sync_all()) {
            let _ = fs::remove_file(&tmp);
            return Err(format!("{}: {}", tmp.display(), e));
        }
    }
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: {}", path.display(), e));
    }
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

fn ensure_dir(p: &Path, mode: u32) -> Result<(), String> {
    fs::create_dir_all(p).map_err(|e| format!("{}: {}", p.display(), e))?;
    fs::set_permissions(p, fs::Permissions::from_mode(mode))
        .map_err(|e| format!("{}: {}", p.display(), e))
}

/// The folders of the record root.
pub fn ensure_layout(op: &Operator) -> Result<(), String> {
    let _r = privilege::raise();
    ensure_dir(&op.record_root, 0o700)?;
    for d in [
        op.drafts_dir(),
        op.ledger_dir(),
        op.locks_dir(),
        op.git_config_dir(),
    ] {
        ensure_dir(&d, 0o700)?;
    }
    Ok(())
}

fn record_path(op: &Operator, draft_id: &str) -> PathBuf {
    op.drafts_dir().join(format!("{}.rec", draft_id))
}

pub fn save(op: &Operator, r: &Record) -> Result<(), String> {
    if !ident::draft_id_ok(&r.draft_id) {
        return Err("draft id outside its grammar".into());
    }
    let body = r.body()?;
    let sealed = format!("{}seal: {}\n", body, seal::seal(op, body.as_bytes())?);
    let _r = privilege::raise();
    atomic_write(&record_path(op, &r.draft_id), sealed.as_bytes(), 0o600)
}

/// Create the record of a new draft. It fails when a record of that id exists.
pub fn create(op: &Operator, r: &Record) -> Result<(), String> {
    {
        let _r = privilege::raise();
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(record_path(op, &r.draft_id))
            .map_err(|e| format!("record {}: {}", r.draft_id, e))?;
    }
    save(op, r)
}

/// Why a draft cannot be used.
#[derive(Debug, PartialEq, Eq)]
pub enum LoadError {
    Grammar,
    Missing,
    Forged,
    Folder,
    Broken(String),
}

impl LoadError {
    pub fn code(&self) -> &'static str {
        match self {
            LoadError::Grammar => "draft_id_grammar",
            LoadError::Missing => "draft_missing",
            LoadError::Forged => "draft_record_forged",
            LoadError::Folder => "draft_folder",
            LoadError::Broken(_) => "draft_record_broken",
        }
    }
}

/// Load a record: the id follows its grammar, the seal verifies, the id inside equals the
/// name of the record and of the folder, and the folder sits under the state root of the
/// agent it names.
pub fn load(op: &Operator, draft_id: &str) -> Result<Record, LoadError> {
    if !ident::draft_id_ok(draft_id) {
        return Err(LoadError::Grammar);
    }
    let text = {
        let _r = privilege::raise();
        fs::read_to_string(record_path(op, draft_id)).map_err(|_| LoadError::Missing)?
    };
    let idx = text.rfind("\nseal: ").ok_or(LoadError::Forged)?;
    let body = &text[..idx + 1];
    if !seal::verify(op, body.as_bytes(), text[idx + 7..].trim()) {
        return Err(LoadError::Forged);
    }
    let r = Record::parse(body).map_err(LoadError::Broken)?;
    if r.draft_id != draft_id {
        return Err(LoadError::Forged);
    }
    if r.folder != op.state_root.join(&r.agent).join(draft_id) {
        return Err(LoadError::Folder);
    }
    if !r.state.terminal() && !r.folder.is_dir() {
        return Err(LoadError::Folder);
    }
    Ok(r)
}

/// Every draft id with a record.
pub fn all_ids(op: &Operator) -> Vec<String> {
    let _r = privilege::raise();
    let mut out: Vec<String> = fs::read_dir(op.drafts_dir())
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    e.file_name()
                        .to_str()
                        .and_then(|n| n.strip_suffix(".rec"))
                        .map(|s| s.to_string())
                })
                .filter(|n| ident::draft_id_ok(n))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// The lock of one draft, held for the whole verb.
pub struct DraftLock {
    file: fs::File,
}

impl Drop for DraftLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

/// Take the lock of a draft at once or refuse.
pub fn lock(op: &Operator, draft_id: &str) -> Result<DraftLock, String> {
    if !ident::draft_id_ok(draft_id) {
        return Err("draft id outside its grammar".into());
    }
    let _r = privilege::raise();
    let p = op.locks_dir().join(format!("{}.lock", draft_id));
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&p)
        .map_err(|e| format!("{}: {}", p.display(), e))?;
    if file.try_lock().is_err() {
        return Err(format!("another verb holds the draft {}", draft_id));
    }
    Ok(DraftLock { file })
}

/// The facts a scan id binds (item 9).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Statement {
    pub draft_id: String,
    pub agent: String,
    pub session: String,
    pub repo: String,
    pub branch: String,
    pub base: String,
    pub tree: String,
    pub list: String,
    pub policy: String,
    pub ci_manifest: String,
    pub seeded_unix: u64,
    pub scan_unix: u64,
}

impl Statement {
    /// Each field as its length in decimal, a colon and the bytes, in a fixed order.
    pub fn canonical(&self) -> Vec<u8> {
        let mut out = Vec::new();
        for v in [
            STATEMENT_KIND.to_string(),
            self.draft_id.clone(),
            self.agent.clone(),
            self.session.clone(),
            self.repo.clone(),
            self.branch.clone(),
            self.base.clone(),
            self.tree.clone(),
            self.list.clone(),
            self.policy.clone(),
            self.ci_manifest.clone(),
            self.seeded_unix.to_string(),
            self.scan_unix.to_string(),
        ] {
            out.extend_from_slice(v.len().to_string().as_bytes());
            out.push(b':');
            out.extend_from_slice(v.as_bytes());
        }
        out
    }

    pub fn id(&self) -> String {
        seal::sha256_hex(&self.canonical())
    }

    /// The statement of a record. aep-ede knows no session and no CI manifest: both are
    /// empty fields of the one form of the identifier specification.
    pub fn of_record(r: &Record) -> Statement {
        Statement {
            draft_id: r.draft_id.clone(),
            agent: r.agent.clone(),
            session: String::new(),
            repo: r.repo.clone(),
            branch: r.branch.clone(),
            base: r.base.clone(),
            tree: r.scan_tree.clone(),
            list: r.scan_list.clone(),
            policy: r.policy_digest.clone(),
            ci_manifest: String::new(),
            seeded_unix: r.seeded_unix,
            scan_unix: r.scan_unix,
        }
    }
}

const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn clean(v: &str) -> String {
    v.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

/// Append one chained, sealed entry under the ledger lock.
pub fn ledger(
    op: &Operator,
    kind: &str,
    r: &Record,
    detail: &str,
    at: u64,
) -> Result<String, String> {
    let _r = privilege::raise();
    ensure_dir(&op.ledger_dir(), 0o700)?;
    let lf = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(op.ledger_dir().join("ledger.lock"))
        .map_err(|e| e.to_string())?;
    lf.lock().map_err(|e| e.to_string())?;
    let path = op.ledger_dir().join("ledger.rec");
    let text = fs::read_to_string(&path).unwrap_or_default();
    let mut seq = 0u64;
    let mut prev = GENESIS.to_string();
    for line in text.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("- seq: ") {
            seq = v.parse().unwrap_or(seq);
        } else if let Some(v) = t.strip_prefix("hash: ") {
            prev = v.to_string();
        }
    }
    let body = format!(
        "  - seq: {}\n    at: {}\n    kind: {}\n    draft_id: {}\n    agent: {}\n    repo: {}\n    scan_id: {}\n    detail: {}\n    prev: {}\n",
        seq + 1,
        at,
        clean(kind),
        clean(&r.draft_id),
        clean(&r.agent),
        clean(&r.repo),
        clean(&r.scan_id),
        clean(detail),
        prev
    );
    let hash = seal::sha256_hex(format!("{}{}", prev, body).as_bytes());
    let sealv = seal::seal(op, hash.as_bytes())?;
    let mut out = if text.is_empty() {
        ledger_header()
    } else {
        String::new()
    };
    out.push_str(&body);
    out.push_str(&format!("    hash: {}\n    seal: {}\n", hash, sealv));
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(out.as_bytes())
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())?;
    let _ = lf.unlock();
    Ok(hash)
}

/// The first lines of the ledger file, written once when the file is created.
fn ledger_header() -> String {
    format!(
        "schema_id: {}\nformat: aep-record\njson: prohibited\nentries:\n",
        LEDGER_SCHEMA
    )
}

/// The fields of one ledger entry after its sequence number, in the order `ledger` writes
/// them. The hash and the seal close the entry.
const LEDGER_FIELDS: [&str; 8] = [
    "at", "kind", "draft_id", "agent", "repo", "scan_id", "detail", "prev",
];

/// Check the chain. The file is the header followed by complete entries and nothing else:
/// each entry carries the next sequence number, every field in its place, the hash of the
/// entry before it, a hash that covers it and a seal that verifies. Any other line, an
/// entry without its hash or seal or a header that differs is refused, so no unsealed
/// text can sit between, inside or after the sealed entries. Returns the number of
/// entries.
///
/// A cut of the last entries leaves a chain that verifies. The draft records name the
/// state of each draft independently of the ledger.
pub fn verify_ledger(op: &Operator) -> Result<u64, String> {
    let text = {
        let _r = privilege::raise();
        fs::read_to_string(op.ledger_dir().join("ledger.rec")).unwrap_or_default()
    };
    if text.is_empty() {
        return Ok(0);
    }
    let Some(body) = text.strip_prefix(&ledger_header()) else {
        return Err("the ledger header is not the one aep-ede writes".into());
    };
    if !body.is_empty() && !body.ends_with('\n') {
        return Err("the ledger ends inside a line".into());
    }
    let mut lines = body.lines();
    let mut prev = GENESIS.to_string();
    let mut count = 0u64;
    while let Some(first) = lines.next() {
        let n = count + 1;
        if first != format!("  - seq: {}", n) {
            return Err(format!(
                "entry {} does not open with its sequence number",
                n
            ));
        }
        let mut cur = format!("{}\n", first);
        for field in LEDGER_FIELDS {
            let line = lines.next().unwrap_or_default();
            if !line.starts_with(&format!("    {}: ", field)) {
                return Err(format!("entry {} lacks its field {} in place", n, field));
            }
            if field == "prev" && line != format!("    prev: {}", prev) {
                return Err(format!("entry {} does not name the hash before it", n));
            }
            cur.push_str(line);
            cur.push('\n');
        }
        let Some(h) = lines.next().and_then(|l| l.strip_prefix("    hash: ")) else {
            return Err(format!("entry {} carries no hash", n));
        };
        if seal::sha256_hex(format!("{}{}", prev, cur).as_bytes()) != h {
            return Err(format!("entry {} changed after it was written", n));
        }
        let Some(s) = lines.next().and_then(|l| l.strip_prefix("    seal: ")) else {
            return Err(format!("entry {} carries no seal", n));
        };
        if !seal::verify(op, h.as_bytes(), s) {
            return Err(format!("entry {} carries a forged seal", n));
        }
        prev = h.to_string();
        count = n;
    }
    Ok(count)
}

pub fn save_git_config(op: &Operator, draft_id: &str, config: &[u8]) -> Result<(), String> {
    let _r = privilege::raise();
    atomic_write(
        &op.git_config_dir().join(format!("{}.config", draft_id)),
        config,
        0o600,
    )
}

pub fn load_git_config(op: &Operator, draft_id: &str) -> Result<Vec<u8>, String> {
    let _r = privilege::raise();
    fs::read(op.git_config_dir().join(format!("{}.config", draft_id)))
        .map_err(|e| format!("git configuration of {}: {}", draft_id, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_statement_form_is_the_one_of_the_specification() {
        let s = Statement {
            draft_id: "ede-1-00000000000000000000000000000000".into(),
            agent: "a".into(),
            session: String::new(),
            repo: "o/r".into(),
            branch: "main".into(),
            base: "b".into(),
            tree: "t".into(),
            list: "l".into(),
            policy: "p".into(),
            ci_manifest: String::new(),
            seeded_unix: 1,
            scan_unix: 2,
        };
        assert_eq!(
            String::from_utf8(s.canonical()).unwrap_or_default(),
            "15:aep-ede-scan-v138:ede-1-000000000000000000000000000000001:a0:3:o/r4:main1:b1:t1:l1:p0:1:11:2"
        );
    }
}
