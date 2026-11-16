//! The operator folder of aep-ede.
//!
//! No control of aep-ede comes from the environment of the agent. The operator folder
//! (/etc/aep-ede, owner the EDE user) holds:
//!
//! - operator.conf: key: value lines for the forge, the state root, the record root,
//!   the quota, the age bounds, the proxy of the forge and the lattice of the
//!   lifecycle wall.
//! - profiles/<agent>.gap: the agent profiles (GAP policies).
//! - agents/<agent>.pub: the registered ML-DSA-65 public key of each agent in hex.
//! - github-token: the token of the GitHub forge, mode 0600.
//! - ede.key: the EDE key that seals every record, mode 0600, made on first use.
//!
//! Test builds (feature test-env) read the folder from AEP_EDE_TEST_OPERATOR.

use std::fs;
use std::path::{Path, PathBuf};

pub const OPERATOR_DIR: &str = "/etc/aep-ede";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ForgeKind {
    GitHub,
    Git,
}

#[derive(Clone, Debug)]
pub struct Operator {
    /// Why the folder cannot be used. Every verb refuses while this is set.
    pub broken: Option<String>,
    pub dir: PathBuf,
    pub ede_user: String,
    pub state_root: PathBuf,
    pub record_root: PathBuf,
    pub forge: ForgeKind,
    pub git_remote: String,
    pub git_direct: bool,
    pub github_url: String,
    pub github_api: String,
    /// The proxy of the forge for git and for the API, never one from the environment.
    pub https_proxy: Option<String>,
    pub default_owner: String,
    pub quota_bytes: u64,
    pub draft_max_age_secs: u64,
    pub scan_max_age_secs: u64,
    pub seal_max_age_secs: u64,
    /// The lattice of the lifecycle wall; empty for the lattice of dynAEP that ships with
    /// this crate.
    pub lattice: Option<PathBuf>,
}

impl Operator {
    fn defaults(dir: PathBuf) -> Operator {
        Operator {
            broken: None,
            dir,
            ede_user: "aep-ede".into(),
            state_root: "/var/lib/aep-ede/drafts".into(),
            record_root: "/var/lib/aep-ede/records".into(),
            forge: ForgeKind::GitHub,
            git_remote: String::new(),
            git_direct: false,
            github_url: "https://github.com".into(),
            github_api: "https://api.github.com".into(),
            https_proxy: None,
            default_owner: String::new(),
            quota_bytes: 8 * 1024 * 1024 * 1024,
            draft_max_age_secs: 7 * 86400,
            scan_max_age_secs: 86400,
            seal_max_age_secs: 86400,
            lattice: None,
        }
    }

    pub fn profiles_dir(&self) -> PathBuf {
        self.dir.join("profiles")
    }
    pub fn agents_dir(&self) -> PathBuf {
        self.dir.join("agents")
    }
    pub fn key_path(&self) -> PathBuf {
        self.dir.join("ede.key")
    }
    pub fn token_path(&self) -> PathBuf {
        self.dir.join("github-token")
    }
    pub fn drafts_dir(&self) -> PathBuf {
        self.record_root.join("drafts")
    }
    pub fn ledger_dir(&self) -> PathBuf {
        self.record_root.join("ledger")
    }
    pub fn locks_dir(&self) -> PathBuf {
        self.record_root.join("locks")
    }
    pub fn git_config_dir(&self) -> PathBuf {
        self.record_root.join("git-config")
    }
}

/// The operator folder.
pub fn dir() -> PathBuf {
    #[cfg(feature = "test-env")]
    {
        if let Ok(v) = std::env::var("AEP_EDE_TEST_OPERATOR") {
            if !v.is_empty() {
                return PathBuf::from(v);
            }
        }
    }
    PathBuf::from(OPERATOR_DIR)
}

fn number(key: &str, v: &str) -> Result<u64, String> {
    v.parse::<u64>()
        .map_err(|_| format!("{} is not a number: {}", key, v))
}

fn path(key: &str, v: &str) -> Result<PathBuf, String> {
    if !v.starts_with('/') || v.split('/').any(|p| p == "..") {
        return Err(format!("{} is not an absolute path: {}", key, v));
    }
    Ok(PathBuf::from(v))
}

fn switch(key: &str, v: &str) -> Result<bool, String> {
    match v {
        "on" => Ok(true),
        "off" => Ok(false),
        _ => Err(format!("{} is on or off, not {}", key, v)),
    }
}

/// Parse operator.conf. An unknown key is refused, so a typo never leaves a control at
/// its default in silence.
pub fn parse(dir: &Path, body: &str) -> Result<Operator, String> {
    let mut op = Operator::defaults(dir.to_path_buf());
    for raw in body.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (k, v) = line
            .split_once(':')
            .ok_or_else(|| format!("line without a key: {}", line))?;
        let (k, v) = (k.trim(), v.trim());
        if v.chars().any(|c| c.is_control()) {
            return Err(format!("{} holds a control character", k));
        }
        match k {
            "schema_id" | "format" | "json" | "note" => {}
            "ede_user" => op.ede_user = v.to_string(),
            "state_root" => op.state_root = path(k, v)?,
            "record_root" => op.record_root = path(k, v)?,
            "forge" => {
                op.forge = match v {
                    "github" => ForgeKind::GitHub,
                    "git" => ForgeKind::Git,
                    _ => return Err(format!("forge is github or git, not {}", v)),
                }
            }
            "git_remote" => op.git_remote = v.to_string(),
            "git_direct" => op.git_direct = switch(k, v)?,
            "github_url" => op.github_url = v.to_string(),
            "github_api" => op.github_api = v.to_string(),
            "https_proxy" => op.https_proxy = Some(v.to_string()),
            "default_owner" => {
                if !crate::ident::repo_part_ok(v) {
                    return Err(format!("default_owner {}", v));
                }
                op.default_owner = v.to_string();
            }
            "quota_bytes" => op.quota_bytes = number(k, v)?,
            "draft_max_age_secs" => op.draft_max_age_secs = number(k, v)?,
            "scan_max_age_secs" => op.scan_max_age_secs = number(k, v)?,
            "seal_max_age_secs" => op.seal_max_age_secs = number(k, v)?,
            "lattice" => op.lattice = Some(path(k, v)?),
            other => return Err(format!("unknown key {}", other)),
        }
    }
    if op.forge == ForgeKind::Git && op.git_remote.is_empty() {
        return Err("the git forge needs git_remote".into());
    }
    if op.draft_max_age_secs == 0 || op.scan_max_age_secs == 0 || op.seal_max_age_secs == 0 {
        return Err("an age bound is zero".into());
    }
    if op.record_root.starts_with(&op.state_root) || op.state_root.starts_with(&op.record_root) {
        return Err("record_root and state_root must not hold each other".into());
    }
    Ok(op)
}

/// The operator of this process. A missing or broken folder comes back with `broken` set
/// and closes every verb.
pub fn load() -> Operator {
    let d = dir();
    let body = {
        let _r = crate::privilege::raise();
        fs::read_to_string(d.join("operator.conf"))
    };
    match body {
        Ok(b) => match parse(&d, &b) {
            Ok(o) => o,
            Err(e) => {
                let mut o = Operator::defaults(d.clone());
                o.broken = Some(format!("{}/operator.conf: {}", d.display(), e));
                o
            }
        },
        Err(e) => {
            let mut o = Operator::defaults(d.clone());
            o.broken = Some(format!("{}/operator.conf: {}", d.display(), e));
            o
        }
    }
}
