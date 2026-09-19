// Agent Control Hub: Base Node kernel extension.
// GAP profile language lives in AEP-Components/gap. This crate binds those
// instructions into kernel-owned session, mount and agent-permission state.
// The daemon loads this crate. It is not a compiler re-export.

use serde::Deserialize;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use thiserror::Error;

pub const COMPONENT_ID: &str = "aep-agent-control-hub";

#[derive(Debug, Error)]
pub enum HubError {
    #[error("gap root missing: {0}")]
    GapRootMissing(String),
    #[error("gap read failed: {0}")]
    GapRead(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HubSession {
    pub profile_id: String,
    pub name: String,
    pub wrap: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HubMount {
    pub profile_id: String,
    pub path_template: String,
    pub policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HubAgentPermission {
    pub agent_id: String,
    pub action: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentControlHub {
    pub sessions: Vec<HubSession>,
    pub mounts: Vec<HubMount>,
    pub permissions: Vec<HubAgentPermission>,
}

impl AgentControlHub {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn load_from_gap(gap_root: &Path) -> Result<Self, HubError> {
        let reference = gap_root.join("policies").join("reference");
        if !reference.is_dir() {
            return Err(HubError::GapRootMissing(reference.display().to_string()));
        }
        let mut hub = Self::empty();
        let entries = match fs::read_dir(&reference) {
            Ok(v) => v,
            Err(e) => {
                return Err(HubError::GapRead(format!("{}: {e}", reference.display())));
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(v) => v,
                Err(e) => return Err(HubError::GapRead(e.to_string())),
            };
            let path = entry.path();
            let os_name = path.file_name();
            let name = match os_name {
                Some(s) => match s.to_str() {
                    Some(n) => n,
                    None => "",
                },
                None => "",
            };
            if !name.starts_with("caw-") {
                continue;
            }
            if !name.ends_with(".gap") {
                continue;
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) => {
                    return Err(HubError::GapRead(format!("{}: {e}", path.display())));
                }
            };
            bind_gap_text(&mut hub, &text);
        }
        Ok(hub)
    }

    pub fn session(&self, profile_id: &str) -> Option<&HubSession> {
        for s in &self.sessions {
            if s.profile_id == profile_id {
                return Some(s);
            }
        }
        None
    }

    pub fn mounts_for(&self, profile_id: &str) -> Vec<&HubMount> {
        let mut out = Vec::new();
        for m in &self.mounts {
            if m.profile_id == profile_id {
                out.push(m);
            }
        }
        out
    }

    pub fn agent_may(&self, agent_id: &str, action: &str) -> bool {
        for p in &self.permissions {
            if p.agent_id == agent_id {
                if p.action == action {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_loaded(&self) -> bool {
        !self.sessions.is_empty()
    }
}

pub fn resolve_gap_root() -> PathBuf {
    match std::env::var("AEP_GAP_ROOT") {
        Ok(raw) => {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed);
            }
        }
        Err(_) => {}
    }
    PathBuf::from("AEP-Components/gap")
}

fn bind_gap_text(hub: &mut AgentControlHub, text: &str) {
    let mut current_profile = String::new();
    let mut current_wrap = String::from("caw");
    let mut pending_agent: Option<String> = None;
    let mut pending_path: Option<String> = None;
    let mut in_permissions = false;
    let mut in_mounts = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if line.starts_with("kind:") {
            in_mounts = false;
            in_permissions = false;
            pending_path = None;
            pending_agent = None;
            let kind = value_after(line);
            if kind == "aep.caw.profile" {
                current_profile.clear();
            }
            continue;
        }
        if line.starts_with("profile_id:") {
            current_profile = value_after(line);
            if !current_profile.is_empty() {
                let mut exists = false;
                for s in &hub.sessions {
                    if s.profile_id == current_profile {
                        exists = true;
                    }
                }
                if !exists {
                    hub.sessions.push(HubSession {
                        profile_id: current_profile.clone(),
                        name: current_profile.clone(),
                        wrap: current_wrap.clone(),
                    });
                }
            }
            continue;
        }
        if line.starts_with("name:") {
            if !current_profile.is_empty() {
                let name = value_after(line);
                for s in &mut hub.sessions {
                    if s.profile_id == current_profile {
                        if !name.is_empty() {
                            s.name = name.clone();
                        }
                    }
                }
            }
            continue;
        }
        if line.starts_with("wrap:") {
            current_wrap = value_after(line);
            if current_wrap.is_empty() {
                current_wrap = String::from("caw");
            }
            for s in &mut hub.sessions {
                if s.profile_id == current_profile {
                    s.wrap = current_wrap.clone();
                }
            }
            continue;
        }
        if line.starts_with("agent_permission:") {
            in_permissions = true;
            in_mounts = false;
            continue;
        }
        if line.starts_with("mounts:") {
            in_mounts = true;
            in_permissions = false;
            continue;
        }
        if line.starts_with("subprotocols:") {
            in_permissions = false;
            in_mounts = false;
            continue;
        }
        if line.starts_with("types:") {
            in_permissions = false;
            in_mounts = false;
            continue;
        }
        if line.starts_with("address:") {
            in_permissions = false;
            in_mounts = false;
            continue;
        }
        if in_permissions {
            let stripped = line.strip_prefix("- agent_id:");
            if let Some(rest) = stripped {
                pending_agent = Some(unquote(rest.trim()));
                continue;
            }
            if line.starts_with("agent_id:") {
                pending_agent = Some(value_after(line));
                continue;
            }
            if line.starts_with("action:") {
                if let Some(agent_id) = pending_agent.take() {
                    let action = value_after(line);
                    if !agent_id.is_empty() {
                        if !action.is_empty() {
                            let row = HubAgentPermission { agent_id: agent_id, action: action };
                            let mut exists = false;
                            for p in &hub.permissions {
                                if p == &row {
                                    exists = true;
                                }
                            }
                            if !exists {
                                hub.permissions.push(row);
                            }
                        }
                    }
                }
                continue;
            }
        }
        if in_mounts {
            let stripped = line.strip_prefix("- path:");
            if let Some(rest) = stripped {
                pending_path = Some(unquote(rest.trim()));
                continue;
            }
            if line.starts_with("path:") {
                pending_path = Some(value_after(line));
                continue;
            }
            if line.starts_with("policy:") {
                if let Some(path_template) = pending_path.take() {
                    let policy = value_after(line);
                    let mut profile_id = current_profile.clone();
                    if profile_id.is_empty() {
                        profile_id = String::from("mount-policy");
                    }
                    if !path_template.is_empty() {
                        if !policy.is_empty() {
                            hub.mounts.push(HubMount {
                                profile_id: profile_id,
                                path_template: path_template,
                                policy: policy,
                            });
                        }
                    }
                }
                continue;
            }
        }
    }
}

fn value_after(line: &str) -> String {
    match line.split_once(':') {
        Some((_k, rest)) => unquote(rest.trim()),
        None => String::new(),
    }
}

fn unquote(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2 {
        let bytes = t.as_bytes();
        let first = bytes[0];
        let last = bytes[t.len() - 1];
        if first == 34 {
            if last == 34 {
                return t[1..t.len() - 1].to_string();
            }
        }
        if first == 39 {
            if last == 39 {
                return t[1..t.len() - 1].to_string();
            }
        }
    }
    t.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_gap() -> String {
        let mut s = String::new();
        s.push_str("metadata:\n");
        s.push_str("  wrap: caw\n");
        s.push_str("  agent_permission:\n");
        s.push_str("    - agent_id: grok-build\n");
        s.push_str("      action: compile\n");
        s.push_str("---\n");
        s.push_str("kind: aep.caw.profile\n");
        s.push_str("profile_id: coding-agent\n");
        s.push_str("name: coding-agent\n");
        s.push_str("mounts:\n");
        s.push_str("  - path: \x22${PROJECT_ROOT}\x22\n");
        s.push_str("    policy: workspace-rw\n");
        s
    }
    #[test]
    fn binds_session_mount_and_permission_from_gap_text() {
        let mut hub = AgentControlHub::empty();
        bind_gap_text(&mut hub, &sample_gap());
        assert!(hub.is_loaded());
        match hub.session("coding-agent") {
            Some(s) => {
                assert_eq!(s.profile_id, "coding-agent");
                assert_eq!(s.wrap, "caw");
            }
            None => panic!("missing session"),
        }
        let mounts = hub.mounts_for("coding-agent");
        assert_eq!(mounts.len(), 1);
        assert_eq!(mounts[0].policy, "workspace-rw");
        assert!(hub.agent_may("grok-build", "compile"));
    }
    #[test]
    fn load_from_gap_reads_caw_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let reference = dir.path().join("policies").join("reference");
        match std::fs::create_dir_all(&reference) {
            Ok(_) => {}
            Err(e) => panic!("{}", e),
        }
        let file_path = reference.join("caw-coding-agent.gap");
        match std::fs::write(&file_path, sample_gap()) {
            Ok(_) => {}
            Err(e) => panic!("{}", e),
        }
        match AgentControlHub::load_from_gap(dir.path()) {
            Ok(hub) => {
                assert!(hub.is_loaded());
                assert!(hub.agent_may("grok-build", "compile"));
            }
            Err(e) => panic!("{}", e),
        }
    }
    #[test]
    fn load_from_gap_missing_dir_is_err() {
        let dir = tempfile::tempdir().expect("tempdir");
        match AgentControlHub::load_from_gap(dir.path()) {
            Ok(_) => panic!("expected missing dir"),
            Err(HubError::GapRootMissing(_)) => {}
            Err(_) => panic!("wrong error"),
        }
    }
    #[test]
    fn loads_seed_gap_profiles_when_tree_present() {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let gap = manifest_dir.join("..").join("..").join("..").join("AEP-Components").join("gap");
        if gap.join("policies").join("reference").is_dir() == false {
            return;
        }
        match AgentControlHub::load_from_gap(&gap) {
            Ok(hub) => {
                assert!(hub.sessions.len() >= 4);
                assert!(hub.agent_may("grok-build", "compile"));
            }
            Err(e) => panic!("{}", e),
        }
    }
}
