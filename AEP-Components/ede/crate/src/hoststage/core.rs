//! The core of provisional staging: the deploy manifest, the limits of the targets,
//! the stage record, the saved copies of the old targets, putting files in place,
//! the way back and the commands with a time limit. The same text serves the draft
//! environments that use it; only the import of the operator type differs.

use crate::operator::Operator;
use crate::{privilege, seal, store};
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// A user the manifest needs. A user that exists is left as it is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UserSpec {
    pub name: String,
    pub shell: String,
}

/// One file of the manifest: its source in the export of the promoted tree and its
/// target on the host with owner, group and mode.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileSpec {
    pub source: String,
    pub target: PathBuf,
    pub owner: String,
    pub group: String,
    pub mode: u32,
}

/// The deploy manifest of a promoted draft.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Manifest {
    pub build: String,
    pub check: String,
    pub users: Vec<UserSpec>,
    pub files: Vec<FileSpec>,
}

fn name_ok(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 32
        && (b[0].is_ascii_lowercase() || b[0] == b'_')
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-')
}

pub fn rel_ok(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('/')
        && Path::new(s)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn parse_mode(v: &str) -> Result<u32, String> {
    if v.is_empty() || v.len() > 5 || !v.bytes().all(|c| (b'0'..=b'7').contains(&c)) {
        return Err(format!("mode {} is not an octal mode", v));
    }
    let m = u32::from_str_radix(v, 8).map_err(|_| format!("mode {}", v))?;
    if m > 0o7777 {
        return Err(format!("mode {} is out of range", v));
    }
    Ok(m)
}

/// The plain absolute form of a path: absolute, without . or .. and without a trailing
/// slash. None for anything else.
pub fn plain(p: &Path) -> Option<PathBuf> {
    let s = p.to_str()?;
    if !s.starts_with('/')
        || s.ends_with('/')
        || s.contains("//")
        || s.chars().any(|c| c.is_control())
    {
        return None;
    }
    let mut out = PathBuf::from("/");
    for c in p.components() {
        match c {
            Component::RootDir => {}
            Component::Normal(n) => out.push(n),
            _ => return None,
        }
    }
    if out == Path::new("/") {
        return None;
    }
    Some(out)
}

/// Parse a deploy manifest. Unknown keys are refused, so a typo never passes in silence.
pub fn parse_manifest(text: &str, schema: &str) -> Result<Manifest, String> {
    let mut m = Manifest::default();
    let mut schema_ok = false;
    let mut section = String::new();
    let mut items: Vec<(String, Vec<(String, String)>)> = Vec::new();
    for raw in text.lines() {
        if raw.trim().is_empty() || raw.trim_start().starts_with('#') {
            continue;
        }
        if raw.chars().any(|c| c.is_control() && c != '\t') {
            return Err("the manifest holds a control character".into());
        }
        if !raw.starts_with(' ') && !raw.starts_with('\t') {
            let (k, v) = raw
                .split_once(':')
                .ok_or_else(|| format!("line without a key: {}", raw))?;
            let v = v.trim();
            section.clear();
            match k.trim() {
                "schema_id" => schema_ok = v == schema,
                "format" | "json" | "json_prohibited" | "note" | "ticket" => {}
                "build" => m.build = v.to_string(),
                "check" => m.check = v.to_string(),
                "users" | "files" => {
                    if !v.is_empty() {
                        return Err(format!("{} takes an indented list", k.trim()));
                    }
                    section = k.trim().to_string();
                }
                other => return Err(format!("unknown key {}", other)),
            }
            continue;
        }
        if section.is_empty() {
            return Err(format!(
                "indented line outside users and files: {}",
                raw.trim()
            ));
        }
        let t = raw.trim_start();
        let rest = match t.strip_prefix("- ") {
            Some(r) => {
                items.push((section.clone(), Vec::new()));
                r
            }
            None => t,
        };
        let item = match items.last_mut() {
            Some(i) if i.0 == section => i,
            _ => return Err(format!("a list entry of {} starts with -", section)),
        };
        let (k, v) = rest
            .split_once(':')
            .ok_or_else(|| format!("line without a key: {}", rest))?;
        item.1.push((k.trim().to_string(), v.trim().to_string()));
    }
    if !schema_ok {
        return Err(format!("schema_id must be {}", schema));
    }
    for (sec, fields) in items {
        let get = |k: &str| {
            fields
                .iter()
                .find(|(fk, _)| fk == k)
                .map(|(_, v)| v.clone())
        };
        let known: &[&str] = if sec == "users" {
            &["name", "shell"]
        } else {
            &["source", "target", "owner", "group", "mode"]
        };
        if let Some((k, _)) = fields.iter().find(|(k, _)| !known.contains(&k.as_str())) {
            return Err(format!("unknown key {} in {}", k, sec));
        }
        if sec == "users" {
            let name = get("name").unwrap_or_default();
            let shell = get("shell").unwrap_or_else(|| "/usr/sbin/nologin".into());
            if !name_ok(&name) {
                return Err(format!("user name {}", name));
            }
            if plain(Path::new(&shell)).is_none() {
                return Err(format!("shell of {} is not an absolute path", name));
            }
            m.users.push(UserSpec { name, shell });
        } else {
            let source = get("source").unwrap_or_default();
            let target = get("target").unwrap_or_default();
            let owner = get("owner").unwrap_or_else(|| "root".into());
            let group = get("group").unwrap_or_else(|| owner.clone());
            let mode = parse_mode(&get("mode").unwrap_or_default())?;
            if !rel_ok(&source) {
                return Err(format!(
                    "source {} is not a path inside the promoted tree",
                    source
                ));
            }
            if !name_ok(&owner) || !name_ok(&group) {
                return Err(format!("owner or group of {}", target));
            }
            m.files.push(FileSpec {
                source,
                target: PathBuf::from(target),
                owner,
                group,
                mode,
            });
        }
    }
    if m.check.is_empty() {
        return Err("a manifest needs a check".into());
    }
    if m.files.is_empty() && m.users.is_empty() {
        return Err("a manifest changes no file and no user".into());
    }
    Ok(m)
}

/// The places a stage may write and the places it never writes.
#[derive(Clone, Debug, Default)]
pub struct Limits {
    pub allowed: Vec<PathBuf>,
    pub refused: Vec<PathBuf>,
    pub refused_names: Vec<String>,
}

/// Every finding of the targets of a manifest against the limits of the operator.
pub fn judge(m: &Manifest, l: &Limits) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();
    for f in &m.files {
        let shown = f.target.display().to_string();
        let t = match plain(&f.target) {
            Some(t) => t,
            None => {
                out.push(format!("target {} is not a plain absolute path", shown));
                continue;
            }
        };
        if !l.allowed.iter().any(|a| t.starts_with(a) && t != *a) {
            out.push(format!(
                "target {} lies outside the stage targets of the operator",
                shown
            ));
        }
        if let Some(r) = l
            .refused
            .iter()
            .find(|r| t.starts_with(r) || r.starts_with(&t))
        {
            out.push(format!(
                "target {} touches the protected place {}",
                shown,
                r.display()
            ));
        }
        let name = t
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if let Some(n) = l.refused_names.iter().find(|n| name.contains(n.as_str())) {
            out.push(format!(
                "target {} is on the protected surface {}",
                shown, n
            ));
        }
        if seen.contains(&t) {
            out.push(format!("target {} appears twice", shown));
        }
        seen.push(t);
    }
    out
}

/// The old and the new state of one target.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetState {
    pub path: PathBuf,
    pub existed: bool,
    pub old_sha: String,
    pub old_uid: u32,
    pub old_gid: u32,
    pub old_mode: u32,
    pub new_sha: String,
    pub uid: u32,
    pub gid: u32,
    pub mode: u32,
}

/// A user the stage created, with the group when the stage created that too.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreatedUser {
    pub name: String,
    pub uid: u32,
    pub gid: u32,
    pub group_created: bool,
}

/// The sealed record of the stage of one draft.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StageRecord {
    pub draft_id: String,
    pub owner: String,
    pub manifest: String,
    pub manifest_sha: String,
    pub state: String,
    pub staged_unix: u64,
    pub deadline_unix: u64,
    pub ended_unix: u64,
    pub check_exit: i64,
    pub note: String,
    pub users: Vec<CreatedUser>,
    pub targets: Vec<TargetState>,
}

/// The states in which a stage holds its targets.
pub fn holds(state: &str) -> bool {
    matches!(state, "staged" | "checked" | "failed")
}

fn one_line(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

impl StageRecord {
    pub fn body(&self, schema: &str) -> String {
        let mut s = format!(
            "schema_id: {}\nformat: aep-record\njson: prohibited\n",
            schema
        );
        for (k, v) in [
            ("draft_id", self.draft_id.clone()),
            ("owner", self.owner.clone()),
            ("manifest", self.manifest.clone()),
            ("manifest_sha", self.manifest_sha.clone()),
            ("state", self.state.clone()),
            ("staged_unix", self.staged_unix.to_string()),
            ("deadline_unix", self.deadline_unix.to_string()),
            ("ended_unix", self.ended_unix.to_string()),
            ("check_exit", self.check_exit.to_string()),
            ("note", self.note.clone()),
        ] {
            s.push_str(&format!("{}: {}\n", k, one_line(&v)));
        }
        for u in &self.users {
            s.push_str(&format!(
                "user: {} {} {} {}\n",
                u.uid, u.gid, u.group_created as u8, u.name
            ));
        }
        for t in &self.targets {
            s.push_str(&format!(
                "target: {} {} {} {} {:o} {} {} {} {:o} {}\n",
                t.existed as u8,
                if t.old_sha.is_empty() {
                    "-"
                } else {
                    &t.old_sha
                },
                t.old_uid,
                t.old_gid,
                t.old_mode,
                t.new_sha,
                t.uid,
                t.gid,
                t.mode,
                t.path.display()
            ));
        }
        s
    }

    pub fn parse(text: &str, schema: &str) -> Result<StageRecord, String> {
        let mut r = StageRecord::default();
        let mut schema_ok = false;
        let num = |v: &str| v.parse::<u64>().map_err(|_| format!("number {}", v));
        let id = |v: &str| v.parse::<u32>().map_err(|_| format!("id {}", v));
        let oct = |v: &str| u32::from_str_radix(v, 8).map_err(|_| format!("mode {}", v));
        for line in text.lines() {
            let (k, v) = match line.split_once(": ") {
                Some(x) => x,
                None => (line.trim_end_matches(':'), ""),
            };
            match k {
                "schema_id" => schema_ok = v == schema,
                "format" | "json" => {}
                "draft_id" => r.draft_id = v.into(),
                "owner" => r.owner = v.into(),
                "manifest" => r.manifest = v.into(),
                "manifest_sha" => r.manifest_sha = v.into(),
                "state" => r.state = v.into(),
                "staged_unix" => r.staged_unix = num(v)?,
                "deadline_unix" => r.deadline_unix = num(v)?,
                "ended_unix" => r.ended_unix = num(v)?,
                "check_exit" => {
                    r.check_exit = v.parse::<i64>().map_err(|_| format!("check_exit {}", v))?
                }
                "note" => r.note = v.into(),
                "user" => {
                    let f: Vec<&str> = v.splitn(4, ' ').collect();
                    if f.len() != 4 {
                        return Err(format!("user line {}", v));
                    }
                    r.users.push(CreatedUser {
                        uid: id(f[0])?,
                        gid: id(f[1])?,
                        group_created: f[2] == "1",
                        name: f[3].into(),
                    });
                }
                "target" => {
                    let f: Vec<&str> = v.splitn(10, ' ').collect();
                    if f.len() != 10 {
                        return Err(format!("target line {}", v));
                    }
                    r.targets.push(TargetState {
                        existed: f[0] == "1",
                        old_sha: if f[1] == "-" {
                            String::new()
                        } else {
                            f[1].into()
                        },
                        old_uid: id(f[2])?,
                        old_gid: id(f[3])?,
                        old_mode: oct(f[4])?,
                        new_sha: f[5].into(),
                        uid: id(f[6])?,
                        gid: id(f[7])?,
                        mode: oct(f[8])?,
                        path: PathBuf::from(f[9]),
                    });
                }
                "" => {}
                other => return Err(format!("unknown key {}", other)),
            }
        }
        if !schema_ok {
            return Err("the stage record names another schema".into());
        }
        Ok(r)
    }
}

// ---------------------------------------------------------------- the stage area

/// The folder of the stage records and the saved copies in the record root.
pub fn stage_area(record_root: &Path) -> PathBuf {
    record_root.join("host-stage")
}

fn saved_path(record_root: &Path, draft: &str, index: usize) -> PathBuf {
    stage_area(record_root)
        .join(draft)
        .join(format!("{}.saved", index))
}

fn ensure_area(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("{}: {}", dir.display(), e))
}

/// Save the old copy of one target in the record root.
pub fn save_copy(
    record_root: &Path,
    draft: &str,
    index: usize,
    bytes: &[u8],
) -> Result<(), String> {
    let _r = privilege::raise();
    ensure_area(&stage_area(record_root))?;
    ensure_area(&stage_area(record_root).join(draft))?;
    store::atomic_write(&saved_path(record_root, draft, index), bytes, 0o600)
}

/// Read a saved copy back.
pub fn load_copy(record_root: &Path, draft: &str, index: usize) -> Result<Vec<u8>, String> {
    let _r = privilege::raise();
    let p = saved_path(record_root, draft, index);
    fs::read(&p).map_err(|e| format!("{}: {}", p.display(), e))
}

/// Drop the saved copies of a draft once its stage is confirmed or reverted.
pub fn clear_copies(record_root: &Path, draft: &str) {
    let _r = privilege::raise();
    let _ = fs::remove_dir_all(stage_area(record_root).join(draft));
}

fn record_file(record_root: &Path, draft: &str) -> PathBuf {
    stage_area(record_root).join(format!("{}.rec", draft))
}

/// Write the stage record of a draft, sealed with the key of the draft environment.
pub fn write_record(
    op: &Operator,
    record_root: &Path,
    r: &StageRecord,
    schema: &str,
) -> Result<(), String> {
    let body = r.body(schema);
    let sealed = format!("{}seal: {}\n", body, seal::seal(op, body.as_bytes())?);
    let _r = privilege::raise();
    ensure_area(&stage_area(record_root))?;
    store::atomic_write(
        &record_file(record_root, &r.draft_id),
        sealed.as_bytes(),
        0o600,
    )
}

/// The stage record of a draft: None when there is none, Err when its seal fails.
pub fn read_record(
    op: &Operator,
    record_root: &Path,
    draft: &str,
    schema: &str,
) -> Result<Option<StageRecord>, String> {
    let text = {
        let _r = privilege::raise();
        match fs::read_to_string(record_file(record_root, draft)) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("stage record {}: {}", draft, e)),
        }
    };
    let idx = text
        .rfind("\nseal: ")
        .ok_or_else(|| format!("the stage record of {} has no seal", draft))?;
    let body = &text[..idx + 1];
    if !seal::verify(op, body.as_bytes(), text[idx + 7..].trim()) {
        return Err(format!(
            "the stage record of {} carries a forged seal",
            draft
        ));
    }
    let r = StageRecord::parse(body, schema)?;
    if r.draft_id != draft {
        return Err(format!("the stage record of {} names another draft", draft));
    }
    Ok(Some(r))
}

/// The drafts with a stage record.
pub fn all_records(record_root: &Path) -> Vec<String> {
    let _r = privilege::raise();
    let mut out: Vec<String> = fs::read_dir(stage_area(record_root))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    e.file_name()
                        .to_str()
                        .and_then(|n| n.strip_suffix(".rec"))
                        .map(|n| n.to_string())
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

/// Hold the stage lock of the host: one stage at a time judges and changes targets.
pub struct HostLock {
    file: fs::File,
}

impl Drop for HostLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub fn host_lock(record_root: &Path) -> Result<HostLock, String> {
    let _r = privilege::raise();
    ensure_area(&stage_area(record_root))?;
    let p = stage_area(record_root).join("host.lock");
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(&p)
        .map_err(|e| format!("{}: {}", p.display(), e))?;
    file.lock().map_err(|e| format!("host stage lock: {}", e))?;
    Ok(HostLock { file })
}

// ---------------------------------------------------------------- the host

/// The bytes, owner, group and mode of a target; None when it does not exist. A
/// symbolic link or anything other than a plain file is refused.
/// The bytes, owner, group and mode of a file.
pub type Held = (Vec<u8>, u32, u32, u32);

/// A file to put in place: target, bytes, owner, group and mode.
pub type Planned = (PathBuf, Vec<u8>, u32, u32, u32);

pub fn read_target(p: &Path) -> Result<Option<Held>, String> {
    let m = match fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {}", p.display(), e)),
    };
    if !m.file_type().is_file() {
        return Err(format!("{} is not a plain file", p.display()));
    }
    let bytes = fs::read(p).map_err(|e| format!("{}: {}", p.display(), e))?;
    Ok(Some((bytes, m.uid(), m.gid(), m.mode() & 0o7777)))
}

fn tmp_name(p: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("target");
    p.with_file_name(format!(
        ".{}.stage-{}-{}.tmp",
        name,
        std::process::id(),
        nanos
    ))
}

/// Put one file in place: a temporary file in the folder of the target with owner,
/// group and mode, then a rename. The folder must exist.
pub fn put_file(p: &Path, bytes: &[u8], uid: u32, gid: u32, mode: u32) -> Result<(), String> {
    let dir = p
        .parent()
        .ok_or_else(|| format!("{} has no folder", p.display()))?;
    if !dir.is_dir() {
        return Err(format!("the folder {} does not exist", dir.display()));
    }
    let tmp = tmp_name(p);
    let res = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| format!("{}: {}", tmp.display(), e))?;
        f.write_all(bytes)
            .and_then(|_| f.sync_all())
            .map_err(|e| format!("{}: {}", tmp.display(), e))?;
        std::os::unix::fs::chown(&tmp, Some(uid), Some(gid))
            .map_err(|e| format!("owner of {}: {}", p.display(), e))?;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(mode))
            .map_err(|e| format!("mode of {}: {}", p.display(), e))?;
        fs::rename(&tmp, p).map_err(|e| format!("{}: {}", p.display(), e))
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res
}

/// The id of a name in a passwd or group file.
pub fn id_in(table: &str, name: &str) -> Option<u32> {
    table.lines().find_map(|l| {
        let mut f = l.split(':');
        if f.next() == Some(name) {
            let _ = f.next();
            f.next().and_then(|v| v.parse().ok())
        } else {
            None
        }
    })
}

fn used_ids(table: &str) -> Vec<u32> {
    table
        .lines()
        .filter_map(|l| l.split(':').nth(2).and_then(|v| v.parse().ok()))
        .collect()
}

/// A free system id for a new user and its group: from 999 down to 100, unused as a uid
/// and as a gid and not refused by `avoid`.
pub fn pick_id(passwd: &str, group: &str, avoid: &dyn Fn(u32) -> bool) -> Option<u32> {
    let (u, g) = (used_ids(passwd), used_ids(group));
    (100..1000u32)
        .rev()
        .find(|id| !u.contains(id) && !g.contains(id) && !avoid(*id))
}

/// The programs and tables of user handling, from the operator.
#[derive(Clone, Debug)]
pub struct UserTools {
    pub dir: PathBuf,
    pub passwd: PathBuf,
    pub group: PathBuf,
    pub path: String,
}

impl UserTools {
    fn run(&self, tool: &str, args: &[&str]) -> Result<(), String> {
        privilege::assert_lowered(tool)?;
        let o = Command::new(self.dir.join(tool))
            .args(args)
            .env_clear()
            .env("PATH", &self.path)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("{}: {}", tool, e))?;
        if o.status.success() {
            Ok(())
        } else {
            Err(format!(
                "{} {}: {}",
                tool,
                args.join(" "),
                String::from_utf8_lossy(&o.stderr).trim()
            ))
        }
    }

    pub fn tables(&self) -> (String, String) {
        (
            fs::read_to_string(&self.passwd).unwrap_or_default(),
            fs::read_to_string(&self.group).unwrap_or_default(),
        )
    }

    /// Create the users of the manifest that do not exist. Every created user lands in
    /// `out` at once, so a failure later can still remove it.
    pub fn create(
        &self,
        users: &[UserSpec],
        avoid: &dyn Fn(u32) -> bool,
        out: &mut Vec<CreatedUser>,
    ) -> Result<(), String> {
        for u in users {
            let (passwd, group) = self.tables();
            if id_in(&passwd, &u.name).is_some() {
                continue;
            }
            let id = pick_id(&passwd, &group, avoid).ok_or("no free system id")?;
            let idt = id.to_string();
            let (gid, group_created) = match id_in(&group, &u.name) {
                Some(g) => (g, false),
                None => {
                    self.run("groupadd", &["-r", "-g", &idt, &u.name])?;
                    (id, true)
                }
            };
            if group_created {
                out.push(CreatedUser {
                    name: u.name.clone(),
                    uid: 0,
                    gid,
                    group_created: true,
                });
            }
            self.run(
                "useradd",
                &[
                    "-r", "-M", "-s", &u.shell, "-u", &idt, "-g", &u.name, &u.name,
                ],
            )?;
            match out.last_mut() {
                Some(c) if c.name == u.name => c.uid = id,
                _ => out.push(CreatedUser {
                    name: u.name.clone(),
                    uid: id,
                    gid,
                    group_created: false,
                }),
            }
            let (passwd, _) = self.tables();
            if id_in(&passwd, &u.name) != Some(id) {
                return Err(format!("the user {} did not get the id {}", u.name, id));
            }
        }
        Ok(())
    }

    /// Remove the users and groups the stage created, newest first.
    pub fn remove(&self, created: &[CreatedUser]) -> Vec<String> {
        let mut errs = Vec::new();
        for c in created.iter().rev() {
            let (passwd, group) = self.tables();
            if c.uid != 0 && id_in(&passwd, &c.name) == Some(c.uid) {
                if let Err(e) = self.run("userdel", &[&c.name]) {
                    errs.push(e);
                }
            }
            if c.group_created && id_in(&group, &c.name) == Some(c.gid) {
                if let Err(e) = self.run("groupdel", &[&c.name]) {
                    errs.push(e);
                }
            }
        }
        errs
    }
}

/// Put the files of a stage in place. Every target lands in `out` with its old state
/// before it changes, so a failure can be reverted to the last byte.
pub fn apply(
    record_root: &Path,
    draft: &str,
    files: &[Planned],
    out: &mut Vec<TargetState>,
) -> Result<(), String> {
    for (path, bytes, uid, gid, mode) in files {
        let old = read_target(path)?;
        let index = out.len();
        let mut t = TargetState {
            path: path.clone(),
            existed: old.is_some(),
            old_sha: String::new(),
            old_uid: 0,
            old_gid: 0,
            old_mode: 0,
            new_sha: seal::sha256_hex(bytes),
            uid: *uid,
            gid: *gid,
            mode: *mode,
        };
        if let Some((ob, ou, og, om)) = &old {
            save_copy(record_root, draft, index, ob)?;
            t.old_sha = seal::sha256_hex(ob);
            t.old_uid = *ou;
            t.old_gid = *og;
            t.old_mode = *om;
        }
        out.push(t);
        put_file(path, bytes, *uid, *gid, *mode)?;
    }
    Ok(())
}

/// Put every target back as it was, newest first, and prove it. Returns the errors.
pub fn revert(record_root: &Path, draft: &str, targets: &[TargetState]) -> Vec<String> {
    let mut errs = Vec::new();
    for (i, t) in targets.iter().enumerate().rev() {
        if t.existed {
            match load_copy(record_root, draft, i) {
                Ok(b) if seal::sha256_hex(&b) == t.old_sha => {
                    if let Err(e) = put_file(&t.path, &b, t.old_uid, t.old_gid, t.old_mode) {
                        errs.push(e);
                    }
                }
                Ok(_) => errs.push(format!(
                    "the saved copy of {} does not hold its old bytes",
                    t.path.display()
                )),
                Err(e) => errs.push(e),
            }
        } else if let Err(e) = fs::remove_file(&t.path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                errs.push(format!("{}: {}", t.path.display(), e));
            }
        }
    }
    for t in targets {
        let now = read_target(&t.path);
        let back = match (&now, t.existed) {
            (Ok(None), false) => true,
            (Ok(Some((b, u, g, m))), true) => {
                seal::sha256_hex(b) == t.old_sha
                    && *u == t.old_uid
                    && *g == t.old_gid
                    && *m == t.old_mode
            }
            _ => false,
        };
        if !back {
            errs.push(format!("{} is not back in its old state", t.path.display()));
        }
    }
    errs
}

/// Run a shell command with a time limit. The answer is the exit code and the last
/// line of its output.
pub fn run_timed(mut c: Command, secs: u64) -> Result<(i32, String), String> {
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = c.spawn().map_err(|e| format!("start: {}", e))?;
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let ro = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(s) = so.as_mut() {
            let _ = s.read_to_end(&mut b);
        }
        b
    });
    let re = std::thread::spawn(move || {
        let mut b = Vec::new();
        if let Some(s) = se.as_mut() {
            let _ = s.read_to_end(&mut b);
        }
        b
    });
    let until = Instant::now() + Duration::from_secs(secs.max(1));
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("no end within {} s", secs));
            }
            Err(e) => return Err(format!("wait: {}", e)),
        }
    };
    let out = ro.join().unwrap_or_default();
    let err = re.join().unwrap_or_default();
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out),
        String::from_utf8_lossy(&err)
    );
    let last = text
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string();
    Ok((status.code().unwrap_or(-1), one_line(&last)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: &str = "test.deploy-manifest.v1";

    #[test]
    fn a_manifest_parses_and_every_bad_line_is_refused() {
        let text = format!(
            "schema_id: {}\nbuild: make\ncheck: test -x /opt/x/bin/tool\nusers:\n  - name: svc-user\n    shell: /usr/sbin/nologin\nfiles:\n  - source: out/tool\n    target: /opt/x/bin/tool\n    owner: svc-user\n    mode: 4755\n",
            S
        );
        let m = parse_manifest(&text, S).unwrap();
        assert_eq!(
            m.users,
            vec![UserSpec {
                name: "svc-user".into(),
                shell: "/usr/sbin/nologin".into()
            }]
        );
        assert_eq!(m.files[0].group, "svc-user");
        assert_eq!(m.files[0].mode, 0o4755);
        for bad in [
            text.replace(S, "other"),
            text.replace("check: test -x /opt/x/bin/tool\n", ""),
            text.replace("out/tool", "../tool"),
            text.replace("out/tool", "/etc/shadow"),
            text.replace("4755", "9755"),
            text.replace("svc-user\n    shell", "Svc\n    shell"),
            text.replace("    mode: 4755\n", "    mode: 4755\n    color: red\n"),
            text.replace("build: make", "bulid: make"),
        ] {
            assert!(parse_manifest(&bad, S).is_err(), "{}", bad);
        }
    }

    #[test]
    fn targets_outside_the_list_or_on_a_protected_place_are_findings() {
        let l = Limits {
            allowed: vec![PathBuf::from("/opt/x")],
            refused: vec![PathBuf::from("/opt/x/records")],
            refused_names: vec!["push-button".into()],
        };
        let file = |t: &str| FileSpec {
            source: "a".into(),
            target: t.into(),
            owner: "root".into(),
            group: "root".into(),
            mode: 0o644,
        };
        let m = Manifest {
            check: "true".into(),
            files: vec![
                file("/opt/x/bin/ok"),
                file("/etc/passwd"),
                file("/opt/x/records/key"),
                file("/opt/x/push-button.sh"),
                file("/opt/x/../etc/x"),
                file("/opt/x/bin/ok"),
                file("/opt/x"),
            ],
            ..Default::default()
        };
        let f = judge(&m, &l);
        assert_eq!(f.len(), 7, "{:?}", f);
        assert!(
            f.iter()
                .all(|x| !x.starts_with("target /opt/x/bin/ok lies")),
            "{:?}",
            f
        );
    }

    #[test]
    fn a_stage_record_round_trips_with_spaces_in_a_path() {
        let r = StageRecord {
            draft_id: "ede-1-00000000000000000000000000000001".into(),
            owner: "coding-agent".into(),
            manifest: "deploy/host.rec".into(),
            manifest_sha: "ab".into(),
            state: "checked".into(),
            staged_unix: 10,
            deadline_unix: 20,
            ended_unix: 0,
            check_exit: 0,
            note: "line one\nline two".into(),
            users: vec![CreatedUser {
                name: "svc".into(),
                uid: 990,
                gid: 990,
                group_created: true,
            }],
            targets: vec![TargetState {
                path: "/opt/x/a b".into(),
                existed: true,
                old_sha: "aa".into(),
                old_uid: 1,
                old_gid: 2,
                old_mode: 0o640,
                new_sha: "bb".into(),
                uid: 0,
                gid: 0,
                mode: 0o4755,
            }],
        };
        let back = StageRecord::parse(&r.body(S), S).unwrap();
        assert_eq!(back.note, "line one line two");
        assert_eq!(back.targets, r.targets);
        assert_eq!(back.users, r.users);
    }

    #[test]
    fn a_free_id_skips_used_and_avoided_ids() {
        let passwd = "a:x:999:999::/:/bin/false\n";
        let group = "b:x:998:\n";
        assert_eq!(pick_id(passwd, group, &|_| false), Some(997));
        assert_eq!(pick_id(passwd, group, &|id| id == 997), Some(996));
    }
}
