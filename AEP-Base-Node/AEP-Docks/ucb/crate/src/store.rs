use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskManifestV1 {
    pub manifest_version: String,
    pub id: String,
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub intent: serde_json::Value,
    #[serde(default)]
    pub agentmesh: Option<serde_json::Value>,
    #[serde(default)]
    pub egress: Option<serde_json::Value>,
    #[serde(default)]
    pub mcp: Option<serde_json::Value>,
    #[serde(default)]
    pub provisional: bool,
    #[serde(default)]
    pub synthesized_by: String,
    #[serde(default)]
    pub promotion_required: Vec<String>,
    #[serde(default)]
    pub created_at_unix: u64,
    #[serde(default)]
    pub manifest_digest: String,
    #[serde(default)]
    pub signature: Option<String>,
    /// JSON pointers into the action payload whose values must carry a UCM receipt.
    /// Empty means the manifest declares no computed field; it is then left out of the
    /// serialized form, so the digest of every existing manifest remains the same.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub computed_fields: Vec<String>,
}

pub struct ManifestStore {
    dir: PathBuf,
}

impl ManifestStore {
    pub fn new(dir: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn path_for(&self, agent_id: &str) -> PathBuf {
        let safe: String = agent_id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub fn save(&self, manifest: &TaskManifestV1) -> std::io::Result<()> {
        let path = self.path_for(&manifest.agent_id);
        let mut persist = manifest.clone();
        persist.manifest_digest = crate::manifest::compute_manifest_digest(&persist);
        let text = serde_json::to_string_pretty(&persist)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        fs::write(path, format!("{text}\n"))
    }

    pub fn load(&self, agent_id: &str) -> Option<TaskManifestV1> {
        let path = self.path_for(agent_id);
        let text = fs::read_to_string(path).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}
