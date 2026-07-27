//! AEP Task Manifest v1 registry and dock enforcement.
//!
//! Session registration identity gate (TASK-A28-H01):
//! - Production always enforces strict identity (env cannot disable).
//! - validate_agent covers missing / provisional / trust / session mismatch.
//! - Docking tests must install real manifests (no silent bypass).

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
    /// When set, dock frames must present the same session_id (session registration bind).
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

    /// Construct with explicit directory and strict flag (tests + controlled embeds).
    pub fn new(dir: PathBuf, strict: bool) -> Self {
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

    /// Production path: always strict. Env var cannot disable identity enforcement.
    ///
    /// Historical `AEP_DOCK_STRICT_IDENTITY=0` is ignored (and logged once if present)
    /// so agents cannot silence the registration gate.
    pub fn from_env() -> Self {
        if let Ok(v) = std::env::var("AEP_DOCK_STRICT_IDENTITY") {
            if v == "0" || v.eq_ignore_ascii_case("false") {
                warn!(
                    "AEP_DOCK_STRICT_IDENTITY={} ignored: production identity gate is always strict",
                    v
                );
            }
        }
        let dir = std::env::var("AEP_TASK_MANIFEST_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/data/aep/ucb/manifests"));
        Self::new(dir, true)
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

    /// Identity / session registration gate for docking.
    ///
    /// Branches (all fail-closed when `strict`):
    /// 1. missing manifest
    /// 2. provisional manifest
    /// 3. trust_score exceeds max
    /// 4. session_id mismatch when manifest binds a session
    pub fn validate_agent(
        &self,
        agent_id: &str,
        trust_score: Option<u16>,
        session_id: Option<&str>,
    ) -> Result<(), String> {
        if !self.strict {
            // Non-strict only via ManifestRegistry::new(..., false) for isolated unit fixtures.
            // Production from_env() never sets strict=false.
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

        // LOW: production strict mode requires session_id on manifests
        if self.strict && manifest.session_id.as_deref().map(str::is_empty).unwrap_or(true) {
            return Err(format!(
                "session registration required for {agent_id}: manifest.session_id missing under strict mode"
            ));
        }
        if let Some(bound) = manifest.session_id.as_deref() {
            match session_id {
                Some(got) if got == bound => {}
                Some(got) => {
                    return Err(format!(
                        "session registration mismatch for {agent_id}: frame session_id={got} manifest session_id={bound}"
                    ));
                }
                None => {
                    return Err(format!(
                        "session registration required for {agent_id}: manifest binds session_id={bound}"
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn manifest_dir(&self) -> &Path {
        &self.dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn sample_manifest(
        agent_id: &str,
        provisional: bool,
        max_trust: u16,
        session_id: Option<&str>,
    ) -> TaskManifestV1 {
        TaskManifestV1 {
            manifest_version: "1".into(),
            id: format!("m-{agent_id}"),
            agent_id: agent_id.into(),
            session_id: session_id.map(str::to_string),
            intent: json!({"op": "test"}),
            trust: TaskManifestTrust {
                tier: "system".into(),
                max_trust_score: max_trust,
            },
            agentmesh: None,
            provisional,
            synthesized_by: "provided".into(),
            promotion_required: if provisional {
                vec!["human".into()]
            } else {
                vec![]
            },
        }
    }

    fn write_manifest(dir: &Path, m: &TaskManifestV1) {
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(format!("{}.json", m.agent_id));
        fs::write(path, serde_json::to_string_pretty(m).unwrap()).unwrap();
    }

    #[test]
    fn missing_manifest_rejected_when_strict() {
        let dir = tempfile::tempdir().unwrap();
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        let err = reg
            .validate_agent("AG-NONE", None, Some("sess-1"))
            .unwrap_err();
        assert!(err.contains("missing"), "{err}");
    }

    #[test]
    fn provisional_manifest_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(
            dir.path(),
            &sample_manifest("AG-PROV", true, 500, Some("sess-1")),
        );
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        let err = reg
            .validate_agent("AG-PROV", None, Some("sess-1"))
            .unwrap_err();
        assert!(err.contains("provisional"), "{err}");
    }

    #[test]
    fn trust_score_exceeds_max_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(
            dir.path(),
            &sample_manifest("AG-TRUST", false, 100, Some("sess-1")),
        );
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        let err = reg
            .validate_agent("AG-TRUST", Some(101), Some("sess-1"))
            .unwrap_err();
        assert!(err.contains("trust_score"), "{err}");
    }

    #[test]
    fn session_registration_mismatch_rejected() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(
            dir.path(),
            &sample_manifest("AG-SESS", false, 500, Some("sess-bound")),
        );
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        let err = reg
            .validate_agent("AG-SESS", Some(50), Some("sess-other"))
            .unwrap_err();
        assert!(err.contains("session registration mismatch"), "{err}");
    }

    #[test]
    fn session_registration_required_when_bound() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(
            dir.path(),
            &sample_manifest("AG-NEED", false, 500, Some("sess-bound")),
        );
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        let err = reg.validate_agent("AG-NEED", Some(50), None).unwrap_err();
        assert!(err.contains("session registration required"), "{err}");
    }

    #[test]
    fn happy_path_with_session_bind_ok() {
        let dir = tempfile::tempdir().unwrap();
        write_manifest(
            dir.path(),
            &sample_manifest("AG-OK", false, 500, Some("sess-1")),
        );
        let reg = ManifestRegistry::new(dir.path().to_path_buf(), true);
        reg.validate_agent("AG-OK", Some(200), Some("sess-1"))
            .expect("ok");
    }

    #[test]
    fn from_env_ignores_disable_flag() {
        std::env::set_var("AEP_DOCK_STRICT_IDENTITY", "0");
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(
            "AEP_TASK_MANIFEST_DIR",
            dir.path().to_string_lossy().as_ref(),
        );
        let reg = ManifestRegistry::from_env();
        assert!(reg.strict(), "from_env must always be strict");
        std::env::remove_var("AEP_DOCK_STRICT_IDENTITY");
        std::env::remove_var("AEP_TASK_MANIFEST_DIR");
    }
}
