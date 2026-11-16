//! Agent profiles of the EDE.
//!
//! An agent works in the EDE only under an agent profile: a GAP policy whose metadata
//! names the agent in agent_permission records and whose extensions.aep.ede_repos lists
//! the repositories it may change. Every verb passes the agent permission of the profile
//! with the action ede.<verb>, so a profile grants the verbs one by one.
//!
//! Profiles live in profiles/<agent>.gap of the operator folder, never at a path the
//! agent names. They are read with the GAP schema parser of AEP
//! (gap-schema-profile-v13), the same parser the kernel judges profiles with, so a line
//! inside a block scalar is text and never a record. A profile that does not parse grants
//! nothing.
//!
//! ```text
//! metadata:
//!   agent_permission:
//!     - agent_id: coding-agent
//!       action: ede.seed
//! extensions:
//!   aep:
//!     ede_repos:
//!       - owner/repo
//! ```

use crate::operator::Operator;
use crate::privilege;
use gap_schema_profile_v13::{
    agent_has_permission, parse_gap_source, permissions_from_doc, AgentPermission,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// The verbs a profile grants. diff, status and path read a draft under the grant of scan.
pub const VERBS: &[&str] = &["seed", "refresh", "scan", "promote", "expire", "stage"];

pub struct Profile {
    pub agent_id: String,
    pub path: PathBuf,
    pub records: Vec<AgentPermission>,
    pub repos: Vec<String>,
}

/// The agent_permission records and the ede_repos list of a GAP profile.
pub fn parse(text: &str) -> Result<(Vec<AgentPermission>, Vec<String>), String> {
    let mut doc = Value::Null;
    let mut err = String::new();
    parse_gap_source(text, &mut doc, &mut err);
    if !err.is_empty() {
        return Err(err);
    }
    let mut records = Vec::new();
    permissions_from_doc(&doc, &mut records);
    let repos = doc
        .get("extensions")
        .and_then(|e| e.get("aep"))
        .and_then(|a| a.get("ede_repos"))
        .and_then(|r| r.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    Ok((records, repos))
}

/// The profile of an agent from the operator folder.
pub fn load(op: &Operator, agent_id: &str) -> Result<Profile, String> {
    if !crate::ident::agent_ok(agent_id) {
        return Err("the agent id is outside its grammar".into());
    }
    let path = op.profiles_dir().join(format!("{}.gap", agent_id));
    let text = {
        let _r = privilege::raise();
        fs::read_to_string(&path)
    }
    .map_err(|_| {
        format!(
            "the operator keeps no profile for {} at {}",
            agent_id,
            path.display()
        )
    })?;
    let (records, repos) = parse(&text).map_err(|e| {
        format!(
            "the profile {} does not parse and grants nothing: {}",
            path.display(),
            e
        )
    })?;
    Ok(Profile {
        agent_id: agent_id.to_string(),
        path,
        records,
        repos,
    })
}

impl Profile {
    /// The agent permission for ede.<verb> and the repository scope (canonical owner/name).
    pub fn allow(&self, verb: &str, repo: &str) -> Result<(), String> {
        let action = format!("ede.{}", verb);
        let mut granted = false;
        agent_has_permission(&self.agent_id, &action, &self.records, &mut granted);
        if !granted {
            return Err(format!(
                "the profile {} does not grant {} to {}",
                self.path.display(),
                action,
                self.agent_id
            ));
        }
        if !repo.is_empty()
            && !self
                .repos
                .iter()
                .any(|r| r == "*" || r.to_ascii_lowercase() == repo)
        {
            return Err(format!(
                "the profile {} does not list {} in ede_repos",
                self.path.display(),
                repo
            ));
        }
        Ok(())
    }

    pub fn summary(&self) -> String {
        let granted: Vec<&str> = VERBS
            .iter()
            .copied()
            .filter(|v| {
                let mut g = false;
                agent_has_permission(&self.agent_id, &format!("ede.{}", v), &self.records, &mut g);
                g
            })
            .collect();
        format!(
            "agent {} profile {} grants {} for {}",
            self.agent_id,
            self.path.display(),
            if granted.is_empty() {
                "nothing".to_string()
            } else {
                granted.join(" ")
            },
            if self.repos.is_empty() {
                "no repository".to_string()
            } else {
                self.repos.join(" ")
            }
        )
    }
}

/// The text of a new profile for an agent and its repositories.
pub fn template(agent_id: &str, repos: &[String]) -> String {
    let mut s = String::new();
    s.push_str("address:\n  domain: dev.aep.ede\n");
    s.push_str(&format!("  id: {}-coding.v1\n\n", agent_id));
    s.push_str("pattern: |\n");
    s.push_str(&format!(
        "  Agent profile of {} for enforced draft environments.\n",
        agent_id
    ));
    s.push_str("  The agent changes the listed repositories only through aep-ede drafts.\n\n");
    s.push_str("action:\n  type: template\n  content: |\n");
    s.push_str("    Change the repositories listed in extensions.aep.ede_repos only through aep-ede drafts.\n\n");
    s.push_str("weight: 1.0\n\ncomposition:\n  type: atomic\n\nmetadata:\n");
    s.push_str("  provenance: \"aep-ede profile init\"\n");
    s.push_str("  version: \"1.0.0\"\n  stability: stable\n  aspect: procedural\n");
    s.push_str("  agent_permission:\n");
    for v in VERBS {
        s.push_str(&format!(
            "    - agent_id: {}\n      action: ede.{}\n",
            agent_id, v
        ));
    }
    s.push_str("\nextensions:\n  aep:\n    ede_repos:\n");
    for r in repos {
        s.push_str(&format!("      - {}\n", r));
    }
    s
}

/// Write a new profile into the operator folder. Only the operator (root or the EDE user)
/// writes profiles; an existing profile is kept.
pub fn init(op: &Operator, agent_id: &str, repos: &[String]) -> Result<PathBuf, String> {
    let uid = privilege::caller_uid();
    let ede = privilege::uid_of(&op.ede_user);
    if uid != 0 && Some(uid) != ede {
        return Err(
            "only the operator writes profiles: run profile init as root or as the EDE user".into(),
        );
    }
    if !crate::ident::agent_ok(agent_id) {
        return Err("name the agent with lower case letters, digits and hyphens".into());
    }
    if repos.is_empty() {
        return Err(
            "name at least one repository as owner/repo. A * stands for every repository".into(),
        );
    }
    for r in repos {
        if r != "*" && crate::ident::repo(r, "x").is_err() {
            return Err(format!("{} is no repository name", r));
        }
    }
    let _r = privilege::raise();
    let dir = op.profiles_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.gap", agent_id));
    if path.exists() {
        return Err(format!(
            "{} exists: edit it or remove it first",
            path.display()
        ));
    }
    crate::store::atomic_write(&path, template(agent_id, repos).as_bytes(), 0o644)?;
    Ok(path)
}

/// Register the public key of an agent. Only the operator registers keys.
pub fn register(op: &Operator, agent_id: &str, public_hex: &str) -> Result<PathBuf, String> {
    let uid = privilege::caller_uid();
    let ede = privilege::uid_of(&op.ede_user);
    if uid != 0 && Some(uid) != ede {
        return Err("only the operator registers agent keys".into());
    }
    if !crate::ident::agent_ok(agent_id) {
        return Err("the agent id is outside its grammar".into());
    }
    let key =
        hex::decode(public_hex.trim()).map_err(|_| "the public key is not hex".to_string())?;
    if key.is_empty() {
        return Err("the public key is empty".into());
    }
    let _r = privilege::raise();
    let path = op.agents_dir().join(format!("{}.pub", agent_id));
    crate::store::atomic_write(&path, format!("{}\n", hex::encode(key)).as_bytes(), 0o644)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_inside_a_block_scalar_grants_nothing() {
        let text = "address:\n  domain: dev.aep.ede\n  id: x.v1\npattern: |\n  agent_permission:\n    - agent_id: evil\n      action: ede.promote\naction:\n  type: template\n  content: x\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: t\n  version: \"1.0.0\"\n  stability: stable\n  agent_permission:\n    - agent_id: good\n      action: ede.scan\nextensions:\n  aep:\n    ede_repos:\n      - owner/repo\n";
        let (records, repos) = parse(text).unwrap_or_default();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].agent_id, "good");
        assert_eq!(repos, vec!["owner/repo".to_string()]);
        assert!(parse("pattern: [unclosed\n").is_err());
    }
}
