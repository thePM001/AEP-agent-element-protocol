//! AEP Task Manifest v1 registry and dock enforcement.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};
use tracing::warn;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SynthesizedBy {
    Provided,
    CcaPlan,
    GapConstrained,
    SchemaConstrained,
    LlmStructured,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskManifestTrust {
    pub tier: String,
    pub max_trust_score: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskManifestV1 {
    pub manifest_version: String,
    pub id: String,
    pub agent_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub intent: serde_json::Value,
    pub trust: TaskManifestTrust,
    #[serde(default)]
    pub agentmesh: Option<serde_json::Value>,
    #[serde(default)]
    pub provisional: bool,
    pub synthesized_by: String,
    #[serde(default)]
    pub promotion_required: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ManifestRegistry {
    dir: PathBuf,
    strict: bool,
    cache: HashMap<String, TaskManifestV1>,
    last_reload: Option<Instant>,
    reload_interval: Duration,
    last_stamp_mtime: Option<SystemTime>,
}

impl ManifestRegistry {
    fn reload_interval_from_env() -> Duration {
        std::env::var("AEP_MANIFEST_RELOAD_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::ZERO)
    }

    pub fn from_env() -> Self {
        let dir = std::env::var("AEP_TASK_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/data/aep/ucb/manifests"));
        let strict = std::env::var("AEP_DOCK_STRICT_IDENTITY")
            .map(|v| v != "0" && !v.eq_ignore_ascii_case("false"))
            .unwrap_or(true);
        let mut reg = Self {
            dir,
            strict,
            cache: HashMap::new(),
            last_reload: None,
            reload_interval: Self::reload_interval_from_env(),
            last_stamp_mtime: None,
        };
        reg.reload();
        reg
    }

    pub fn strict(&self) -> bool {
        self.strict
    }

    fn stamp_mtime(&self) -> Option<SystemTime> {
        let path = self.dir.join(".reload-stamp");
        fs::metadata(&path).ok().and_then(|m| m.modified().ok())
    }

    fn stamp_changed(&mut self) -> bool {
        let Some(mtime) = self.stamp_mtime() else {
            return true;
        };
        if self.last_stamp_mtime != Some(mtime) {
            self.last_stamp_mtime = Some(mtime);
            return true;
        }
        false
    }

    pub fn reload_if_stale(&mut self) {
        if self.stamp_changed() {
            self.reload();
            return;
        }
        if self.reload_interval.is_zero() {
            self.reload();
            return;
        }
        if self
            .last_reload
            .is_some_and(|t| t.elapsed() < self.reload_interval)
        {
            return;
        }
        self.reload();
    }

    pub fn reload(&mut self) {
        self.cache.clear();
        self.last_reload = Some(Instant::now());
        if !self.dir.is_dir() {
            return;
        }
        let entries = fs::read_dir(&self.dir).ok();
        let Some(entries) = entries else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let text = match fs::read_to_string(&path) {
                Ok(t) => t,
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "task manifest read failed");
                    continue;
                }
            };
            match serde_json::from_str::<TaskManifestV1>(&text) {
                Ok(m) => {
                    if self.cache.contains_key(&m.agent_id) {
                        warn!(
                            agent_id = %m.agent_id,
                            path = %path.display(),
                            "duplicate task manifest agent_id; keeping first entry"
                        );
                        continue;
                    }
                    self.cache.insert(m.agent_id.clone(), m);
                }
                Err(e) => {
                    warn!(path = %path.display(), error = %e, "task manifest parse failed");
                }
            }
        }
    }

    pub fn signer_public_hex(&self, agent_id: &str) -> Option<String> {
        let manifest = self.get(agent_id)?;
        manifest
            .agentmesh
            .as_ref()
            .and_then(|v| v.get("did"))
            .and_then(|did| did.get("verification_key_hex"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
    }

    pub fn get(&self, agent_id: &str) -> Option<&TaskManifestV1> {
        self.cache.get(agent_id)
    }

    pub fn validate_agent(
        &self,
        agent_id: &str,
        trust_score: Option<u16>,
    ) -> Result<(), String> {
        if !self.strict {
            return Ok(());
        }
        let manifest = self
            .get(agent_id)
            .ok_or_else(|| format!("task manifest missing for agent_id={agent_id}"))?;

        if manifest.provisional {
            return Err(format!(
                "provisional task manifest for {agent_id}; promotion required: {:?}",
                manifest.promotion_required
            ));
        }

        let effective_score = trust_score.unwrap_or(manifest.trust.max_trust_score);
        if effective_score > manifest.trust.max_trust_score {
            return Err(format!(
                "trust_score {effective_score} exceeds manifest max {}",
                manifest.trust.max_trust_score
            ));
        }

        Ok(())
    }

    pub fn manifest_dir(&self) -> &Path {
        &self.dir
    }
}