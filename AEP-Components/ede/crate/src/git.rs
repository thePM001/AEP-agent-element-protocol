//! Git of aep-ede.
//!
//! A draft holds a work tree (<folder>/tree) and, beside it and outside it, its git
//! folder (<folder>/git). The tree holds no .git entry. Every git call names both
//! folders, starts with an empty environment, without the system and global
//! configuration and with hooks, file monitors, attribute files, external diff programs
//! and pagers switched off. Before each verb the configuration the seed wrote is put back
//! from the record root and the info folder is emptied, so a planted entry never reaches
//! a git call of aep-ede.
//!
//! Scan judges the blobs of the git tree it writes, never the files of the work tree.
//! Promote lands that tree as exactly one commit on the fetched tip.

use crate::seal;
use crate::store::Record;
use std::fs;
use std::path::Path;
use std::process::Command;

/// The settings every git call of aep-ede carries.
const SAFE: &[&str] = &[
    "core.hooksPath=/dev/null",
    "core.fsmonitor=false",
    "core.untrackedCache=false",
    "core.attributesFile=/dev/null",
    "core.excludesFile=/dev/null",
    "core.autocrlf=false",
    "core.symlinks=true",
    "core.sshCommand=false",
    "core.pager=cat",
    "safe.directory=*",
    "gc.auto=0",
    "maintenance.auto=false",
    "commit.gpgSign=false",
    "protocol.ext.allow=never",
];

/// One changed path between two trees with the mode and blob id of its new side.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub path: String,
    pub delete: bool,
    pub mode: String,
    pub id: String,
}

fn base_command(env: &[(String, String)]) -> Command {
    let mut c = Command::new("git");
    c.env_clear();
    c.env("PATH", crate::child_path());
    for k in ["HOME", "LANG", "LC_ALL", "TMPDIR"] {
        if let Ok(v) = std::env::var(k) {
            c.env(k, v);
        }
    }
    c.env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "aep-ede")
        .env("GIT_AUTHOR_EMAIL", "aep-ede@localhost")
        .env("GIT_COMMITTER_NAME", "aep-ede")
        .env("GIT_COMMITTER_EMAIL", "aep-ede@localhost");
    // The token of a forge reaches git only through the environment of this one process.
    for (k, v) in env {
        c.env(k, v);
    }
    for kv in SAFE {
        c.arg("-c").arg(kv);
    }
    c
}

fn run(mut c: Command, what: &str) -> Result<Vec<u8>, String> {
    crate::privilege::assert_lowered(what)?;
    let o = c.output().map_err(|e| format!("{}: {}", what, e))?;
    if o.status.success() {
        Ok(o.stdout)
    } else {
        Err(format!(
            "{}: {}",
            what,
            String::from_utf8_lossy(&o.stderr).trim()
        ))
    }
}

/// git on a draft with optional forge environment.
pub fn git_env(r: &Record, env: &[(String, String)], args: &[&str]) -> Result<Vec<u8>, String> {
    let mut c = base_command(env);
    c.arg("--git-dir")
        .arg(r.git_dir())
        .arg("--work-tree")
        .arg(r.tree())
        .args(args);
    run(c, &format!("git {}", args.first().unwrap_or(&"")))
}

pub fn git(r: &Record, args: &[&str]) -> Result<String, String> {
    git_env(r, &[], args).map(|b| String::from_utf8_lossy(&b).to_string())
}

pub fn hex40(s: &str) -> bool {
    s.len() == 40
        && s.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Clone `url` into the folders of a new draft and check out `branch`. Ok carries the
/// base commit and the configuration the clone wrote.
pub fn clone(
    r: &Record,
    env: &[(String, String)],
    url: &str,
    branch: &str,
) -> Result<(String, Vec<u8>), String> {
    let mut c = base_command(env);
    c.arg("clone")
        .arg("-q")
        .arg("--no-checkout")
        .arg(format!("--separate-git-dir={}", r.git_dir().display()))
        .arg("--branch")
        .arg(branch)
        .arg("--")
        .arg(url)
        .arg(r.tree());
    run(c, "git clone")?;
    let _ = fs::remove_file(r.tree().join(".git"));
    let config = fs::read(r.git_dir().join("config")).map_err(|e| format!("git config: {}", e))?;
    let base = git(
        r,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{}^{{commit}}", branch),
        ],
    )?
    .trim()
    .to_string();
    if !hex40(&base) {
        return Err(format!("the branch {} has no commit", branch));
    }
    git(r, &["checkout", "-q", "-B", "ede-work", &base])?;
    Ok((base, config))
}

/// Put back the configuration of the seed and empty the info folder.
pub fn restore(r: &Record, config: &[u8]) -> Result<(), String> {
    let gd = r.git_dir();
    if !gd.is_dir() {
        return Err("the git folder of the draft is missing".into());
    }
    fs::write(gd.join("config"), config).map_err(|e| format!("git config: {}", e))?;
    let _ = fs::remove_dir_all(gd.join("info"));
    let _ = fs::remove_file(gd.join("objects").join("info").join("alternates"));
    let _ = fs::remove_file(gd.join("objects").join("info").join("http-alternates"));
    let _ = fs::remove_file(r.tree().join(".git"));
    Ok(())
}

/// Fetch the tip of the branch of a draft from its forge.
pub fn fetch_tip(r: &Record, env: &[(String, String)], url: &str) -> Result<String, String> {
    let spec = format!("+refs/heads/{}:refs/remotes/origin/{}", r.branch, r.branch);
    git_env(r, env, &["fetch", "-q", "--no-tags", "--", url, &spec])?;
    let tip = git(
        r,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/remotes/origin/{}^{{commit}}", r.branch),
        ],
    )?
    .trim()
    .to_string();
    if !hex40(&tip) {
        return Err("the fetch named no tip".into());
    }
    Ok(tip)
}

/// Stage the work tree and write its git tree object.
pub fn write_tree(r: &Record) -> Result<String, String> {
    git(r, &["add", "-A", "--", "."])?;
    let id = git(r, &["write-tree"])?.trim().to_string();
    if !hex40(&id) {
        return Err(format!("write-tree gave no tree id: {}", id));
    }
    Ok(id)
}

/// The sha256 of the full listing of a tree with modes, ids and paths.
pub fn listing(r: &Record, tree: &str) -> Result<String, String> {
    Ok(seal::sha256_hex(&git_env(
        r,
        &[],
        &["ls-tree", "-r", "-z", "--full-tree", tree],
    )?))
}

/// The changes from `from` to `to`.
pub fn tree_changes(r: &Record, from: &str, to: &str) -> Result<Vec<Entry>, String> {
    let raw = git_env(
        r,
        &[],
        &[
            "diff-tree",
            "-r",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            "--raw",
            from,
            to,
        ],
    )?;
    let text = String::from_utf8(raw).map_err(|_| "a changed path is not UTF-8".to_string())?;
    let mut out = Vec::new();
    let mut parts = text.split('\0').filter(|s| !s.is_empty());
    while let Some(meta) = parts.next() {
        let path = parts.next().ok_or("diff parse")?.to_string();
        let f: Vec<&str> = meta.trim_start_matches(':').split_whitespace().collect();
        if f.len() < 5 {
            return Err("diff parse".into());
        }
        if !crate::ident::rel_ok(&path) {
            return Err("a changed path is outside the grammar of draft paths".into());
        }
        out.push(Entry {
            path,
            delete: f[4].starts_with('D'),
            mode: f[1].to_string(),
            id: f[3].to_string(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// The bytes of a blob, checked against its id.
pub fn blob(r: &Record, id: &str) -> Result<Vec<u8>, String> {
    if !hex40(id) {
        return Err(format!("blob id {}", id));
    }
    let bytes = git_env(r, &[], &["cat-file", "blob", id])?;
    if seal::git_blob_id(&bytes) != id {
        return Err(format!(
            "the blob {} does not hold the bytes its id names",
            id
        ));
    }
    Ok(bytes)
}

/// The added lines of `path` from `from` to `to`, each with its line number in the new
/// blob, read from the hunks of a diff without context (baseline B5): a line counts as
/// added where it now stands, also when the same text stood elsewhere before.
pub fn added_lines(
    r: &Record,
    from: &str,
    to: &str,
    path: &str,
) -> Result<Vec<(usize, String)>, String> {
    let raw = git_env(
        r,
        &[],
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--unified=0",
            from,
            to,
            "--",
            path,
        ],
    )?;
    Ok(parse_added(&String::from_utf8_lossy(&raw)))
}

/// The added lines of a diff without context.
pub fn parse_added(diff: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut next = 0usize;
    let mut in_hunk = false;
    for line in diff.lines() {
        if let Some(h) = line.strip_prefix("@@ ") {
            // @@ -a,b +c,d @@
            let plus = h
                .split_whitespace()
                .find(|w| w.starts_with('+'))
                .unwrap_or("+0");
            next = plus
                .trim_start_matches('+')
                .split(',')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            continue;
        }
        if let Some(t) = line.strip_prefix('+') {
            out.push((next, t.to_string()));
            next += 1;
        } else if line.starts_with(' ') {
            next += 1;
        }
    }
    out
}

/// Merge `tree` (the work on `base`) onto `tip`. Ok carries the merged tree, Err the
/// conflicting paths or an error.
pub fn merge_onto(
    r: &Record,
    base: &str,
    tree: &str,
    tip: &str,
) -> Result<String, Result<Vec<String>, String>> {
    let work = git(r, &["commit-tree", tree, "-p", base, "-m", "ede work"])
        .map_err(Err)?
        .trim()
        .to_string();
    let mut c = base_command(&[]);
    c.arg("--git-dir")
        .arg(r.git_dir())
        .arg("--work-tree")
        .arg(r.tree());
    c.args([
        "merge-tree",
        "--write-tree",
        "--name-only",
        "--no-messages",
        &format!("--merge-base={}", base),
        tip,
        &work,
    ]);
    crate::privilege::assert_lowered("git merge-tree").map_err(Err)?;
    let o = c.output().map_err(|e| Err(e.to_string()))?;
    let text = String::from_utf8_lossy(&o.stdout).to_string();
    let mut lines = text.lines();
    let merged = lines.next().unwrap_or("").trim().to_string();
    match o.status.code() {
        Some(0) if hex40(&merged) => Ok(merged),
        Some(1) => Err(Ok(lines
            .filter(|l| !l.trim().is_empty())
            .map(|l| l.trim().to_string())
            .collect())),
        _ => Err(Err(format!(
            "git merge-tree: {}",
            String::from_utf8_lossy(&o.stderr).trim()
        ))),
    }
}

/// The landing commit: the scanned tree on the fetched tip, one commit.
pub fn landing_commit(
    r: &Record,
    tree: &str,
    tip: &str,
    message: &str,
    second: u64,
) -> Result<String, String> {
    // The commit is dated at the scan second, so a retry of the same promote builds the
    // same commit.
    let date = format!("@{} +0000", second);
    let env = vec![
        ("GIT_AUTHOR_DATE".to_string(), date.clone()),
        ("GIT_COMMITTER_DATE".to_string(), date),
    ];
    let c = String::from_utf8_lossy(&git_env(
        r,
        &env,
        &["commit-tree", tree, "-p", tip, "-m", message],
    )?)
    .trim()
    .to_string();
    if !hex40(&c) {
        return Err("commit-tree gave no commit".into());
    }
    Ok(c)
}

/// Push one commit to a branch of the forge. `own` marks the branch aep-ede/<draft> of
/// the draft itself, which a retry of the promote may move; a base branch is never forced.
pub fn push(
    r: &Record,
    env: &[(String, String)],
    url: &str,
    commit: &str,
    branch: &str,
    own: bool,
) -> Result<(), String> {
    let spec = format!(
        "{}{}:refs/heads/{}",
        if own { "+" } else { "" },
        commit,
        branch
    );
    git_env(r, env, &["push", "-q", "--no-verify", "--", url, &spec]).map(|_| ())
}

/// Bytes used under `path`, symbolic links not followed.
pub fn du_bytes(p: &Path) -> u64 {
    fn walk(p: &Path) -> u64 {
        let m = match fs::symlink_metadata(p) {
            Ok(m) => m,
            Err(_) => return 0,
        };
        if m.is_dir() {
            fs::read_dir(p)
                .map(|rd| rd.flatten().map(|e| walk(&e.path())).sum())
                .unwrap_or(0)
        } else {
            m.len()
        }
    }
    walk(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn added_lines_count_by_position() {
        let d = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1,2 @@\n+one\n+two\n@@ -5 +7,0 @@\n-gone\n@@ -9,0 +10 @@\n+moved here\n";
        assert_eq!(
            parse_added(d),
            vec![
                (1, "one".to_string()),
                (2, "two".to_string()),
                (10, "moved here".to_string())
            ]
        );
    }
}
