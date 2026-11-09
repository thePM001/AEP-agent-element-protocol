//! Agent profiles of the EDE.
//!
//! An agent works in the EDE only under an agent profile: a GAP policy whose
//! metadata names the agent in agent_permission records and whose
//! extensions.aep.ede_repos lists the repositories it may change. Every verb
//! passes the agent permission wall of AEP
//! Admit with the action ede.<verb>, so a profile grants seed, scan and promote
//! one by one. A draft belongs to the agent that seeded it.
//!
//! The agent identity comes from AEP_AGENT_ID. The profile comes from
//! AEP_EDE_PROFILE. Without it the profile is <root>/profiles/<agent>.gap.
//!
//! ```text
//! metadata:
//!   agent_permission:
//!     - agent_id: my-coding-agent
//!       action: ede.seed
//!     - agent_id: my-coding-agent
//!       action: ede.scan
//!     - agent_id: my-coding-agent
//!       action: ede.promote
//! extensions:
//!   aep:
//!     ede_repos:
//!       - owner/repo
//! ```

use aep_admit::{compile_agent_permission_wall, AgentPermission};
use std::fs;
use std::path::PathBuf;

pub const VERBS: &[&str] = &["seed", "scan", "promote"];

pub struct Profile {
    pub agent_id: String,
    pub path: PathBuf,
    pub records: Vec<AgentPermission>,
    pub repos: Vec<String>,
}

const HOW: &str =
    "create one with aep-ede profile init <agent-id> <owner/repo> and set AEP_AGENT_ID";

fn indent(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

fn value(line: &str, key: &str) -> Option<String> {
    let t = line.trim().trim_start_matches("- ").trim();
    let rest = t.strip_prefix(key)?.trim_start().strip_prefix(':')?;
    Some(rest.trim().trim_matches('"').trim_matches('\'').to_string())
}

/// The agent_permission records and the ede_repos list of a GAP profile.
pub fn parse(text: &str) -> (Vec<AgentPermission>, Vec<String>) {
    let mut records = Vec::new();
    let mut repos = Vec::new();
    let mut block: Option<(&str, usize)> = None;
    let mut agent = String::new();
    for line in text.lines() {
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let ind = indent(line);
        if let Some((name, at)) = block {
            if (ind <= at && !line.trim_start().starts_with('-')) || ind < at {
                block = None;
            } else if name == "agent_permission" {
                if let Some(a) = value(line, "agent_id") {
                    agent = a;
                    continue;
                }
                if let Some(act) = value(line, "action") {
                    if !agent.is_empty() {
                        records.push(AgentPermission {
                            agent_id: agent.clone(),
                            action: act,
                        });
                    }
                    continue;
                }
                continue;
            } else {
                let item = line
                    .trim()
                    .trim_start_matches('-')
                    .trim()
                    .trim_matches('"')
                    .to_string();
                if !item.is_empty() {
                    repos.push(item);
                }
                continue;
            }
        }
        let t = line.trim();
        if t == "agent_permission:" {
            block = Some(("agent_permission", ind));
            agent.clear();
        } else if t == "ede_repos:" {
            block = Some(("ede_repos", ind));
        } else if let Some(inline) = t.strip_prefix("ede_repos:") {
            let inline = inline.trim().trim_start_matches('[').trim_end_matches(']');
            repos.extend(
                inline
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .filter(|s| !s.is_empty()),
            );
        }
    }
    (records, repos)
}

/// The profile of the agent that runs this process.
pub fn load() -> Result<Profile, String> {
    let agent_id = std::env::var("AEP_AGENT_ID")
        .unwrap_or_default()
        .trim()
        .to_string();
    if agent_id.is_empty() {
        return Err(format!(
            "AEP_AGENT_ID is empty: every agent works in the EDE under its own profile, {}",
            HOW
        ));
    }
    let path = match std::env::var("AEP_EDE_PROFILE") {
        Ok(v) if !v.is_empty() => PathBuf::from(v),
        _ => crate::root()
            .join("profiles")
            .join(format!("{}.gap", agent_id)),
    };
    let text = fs::read_to_string(&path)
        .map_err(|_| format!("no agent profile at {}: {}", path.display(), HOW))?;
    let (records, repos) = parse(&text);
    Ok(Profile {
        agent_id,
        path,
        records,
        repos,
    })
}

impl Profile {
    /// The agent permission wall for ede.<verb> and the repository scope.
    pub fn allow(&self, verb: &str, repo: &str) -> Result<(), String> {
        let action = format!("ede.{}", verb);
        let wall = compile_agent_permission_wall(&self.agent_id, &action, &self.records);
        if wall.closed {
            return Err(format!(
                "the profile {} does not grant {} to {} ({}): add an agent_permission record with agent_id {} and action {}",
                self.path.display(),
                action,
                self.agent_id,
                wall.reason,
                self.agent_id,
                action
            ));
        }
        if !repo.is_empty() && !self.repos.iter().any(|r| r == "*" || r == repo) {
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
                !compile_agent_permission_wall(&self.agent_id, &format!("ede.{}", v), &self.records)
                    .closed
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

/// Write a new profile under <root>/profiles. An existing profile is kept.
pub fn init(agent_id: &str, repos: &[String]) -> Result<PathBuf, String> {
    if agent_id.is_empty() || agent_id.contains('/') || agent_id.contains(' ') {
        return Err("name the agent with one word, for example my-coding-agent".into());
    }
    if repos.is_empty() {
        return Err(
            "name at least one repository as owner/repo. A * stands for every repository".into(),
        );
    }
    let dir = crate::root().join("profiles");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.gap", agent_id));
    if path.exists() {
        return Err(format!(
            "{} exists: edit it or remove it first",
            path.display()
        ));
    }
    fs::write(&path, template(agent_id, repos)).map_err(|e| e.to_string())?;
    Ok(path)
}
