// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
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
        let mut value = serde_json::to_value(&persist).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
        if let Some(obj) = value.as_object_mut() {
            let mut trust = serde_json::Map::new();
            trust.insert(String::from("tier"), serde_json::Value::String(String::from("none")));
            trust.insert(String::from("max_trust_score"), serde_json::Value::from(0u64));
            obj.insert(String::from("trust"), serde_json::Value::Object(trust));
        }
        let text = serde_json::to_string_pretty(&value).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, e)
        })?;
        fs::write(path, format!("{text}\n"))
    }

    pub fn load(&self, agent_id: &str) -> Option<TaskManifestV1> {
        let path = self.path_for(agent_id);
        let text = fs::read_to_string(path).ok()?;
        let mut value: serde_json::Value = serde_json::from_str(&text).ok()?;
        if let Some(obj) = value.as_object_mut() {
            obj.remove("trust");
            obj.remove("trust_score");
            obj.remove("trust_tier");
            obj.remove("trust_ring");
            obj.remove("max_trust_score");
        }
        serde_json::from_value(value).ok()
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }
}

pub fn value_has_trust_fields(value: &serde_json::Value) -> bool {
    let Some(obj) = value.as_object() else {
        return false;
    };
    obj.contains_key("trust")
        || obj.contains_key("trust_score")
        || obj.contains_key("trust_tier")
        || obj.contains_key("trust_ring")
        || obj.contains_key("max_trust_score")
}
