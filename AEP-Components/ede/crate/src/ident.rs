//! EDE identifiers.
//!
//! One identifier specification serves every draft environment of AEP. It is written in the readme
//! of this component (section Identifiers) and its vectors
//! (identifier-vectors.rec of this component).
//!
//! - Draft id: ede-<unix seconds>-<32 lower hex> from 128 random bits of the kernel.
//! - Agent id: lower case letters, digits and single hyphens, 1 to 64.
//! - Session id: letters, digits and hyphens, 1 to 64, starting with a letter or digit.
//! - Repository: owner/name compared in lower case. Each part is 1 to 100 of letters,
//!   digits, dot, underscore and hyphen, starts with a letter or digit and does not end
//!   with .git. A bare name takes the owner of the operator.
//! - Branch: what git check-ref-format accepts for refs/heads/<branch>, without a
//!   leading hyphen.
//! - No record value carries a control character.

use std::fs;
use std::io::Read;
use std::process::Command;

fn is_lower_alnum(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit()
}

/// ede-<unix seconds>-<32 lower hex>.
pub fn draft_id_ok(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("ede-") else {
        return false;
    };
    let Some((secs, hex)) = rest.split_once('-') else {
        return false;
    };
    !secs.is_empty()
        && secs.len() <= 20
        && secs.chars().all(|c| c.is_ascii_digit())
        && !(secs.len() > 1 && secs.starts_with('0'))
        && hex.len() == 32
        && hex
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// N bytes of the kernel random source.
pub fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut b = [0u8; N];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut b))
        .map_err(|e| format!("kernel random source: {}", e))?;
    Ok(b)
}

/// A new draft id for the second `now`.
pub fn mint_draft_id(now: u64) -> Result<String, String> {
    Ok(format!(
        "ede-{}-{}",
        now,
        hex::encode(random_bytes::<16>()?)
    ))
}

/// Lower case letters, digits and single hyphens, 1 to 64.
pub fn agent_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| is_lower_alnum(c) || c == '-')
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
}

/// Letters, digits and hyphens, 1 to 64, starting with a letter or digit.
pub fn session_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && id
            .chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
}

/// One part of owner/name.
pub fn repo_part_ok(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 100
        && p.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
        && p.chars()
            .next()
            .map(|c| c.is_ascii_alphanumeric())
            .unwrap_or(false)
        && !p.to_ascii_lowercase().ends_with(".git")
        && !p.contains("..")
}

/// A repository in its forms: the canonical owner/name in lower case for every
/// comparison and the owner and the name as given.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Repo {
    pub canonical: String,
    pub owner: String,
    pub name: String,
}

impl Repo {
    pub fn full(&self) -> String {
        format!("{}/{}", self.owner, self.name)
    }
}

pub fn repo(raw: &str, default_owner: &str) -> Result<Repo, String> {
    if raw.chars().any(|c| c.is_control()) {
        return Err("the repository name holds a control character".into());
    }
    let (owner, name) = match raw.split_once('/') {
        Some((o, n)) => (o, n),
        None => (default_owner, raw),
    };
    if !repo_part_ok(owner) || !repo_part_ok(name) {
        return Err(format!("name the repository as owner/name: {}", raw));
    }
    Ok(Repo {
        canonical: format!(
            "{}/{}",
            owner.to_ascii_lowercase(),
            name.to_ascii_lowercase()
        ),
        owner: owner.to_string(),
        name: name.to_string(),
    })
}

/// A branch name that git accepts and that cannot be read as an option.
pub fn branch_ok(b: &str) -> bool {
    if b.is_empty()
        || b.len() > 200
        || b.starts_with('-')
        || b.contains("@{")
        || b.chars().any(|c| c.is_control() || c == ' ')
    {
        return false;
    }
    // check-ref-format of the full ref name is a pure syntax check: it needs no
    // repository and never resolves anything.
    Command::new("git")
        .arg("check-ref-format")
        .arg(format!("refs/heads/{}", b))
        .env_clear()
        .env("PATH", crate::child_path())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// No control character, so a value never breaks a record line.
pub fn value_ok(v: &str) -> bool {
    !v.chars().any(|c| c.is_control())
}

/// A path inside a draft: relative, no parent step, no empty part, no .git part and no
/// control character.
pub fn rel_ok(rel: &str) -> bool {
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || !value_ok(rel) {
        return false;
    }
    rel.split('/')
        .all(|p| !p.is_empty() && p != "." && p != ".." && p != ".git")
}
