//! Per-agent UCB keys. Operator key is UCB_API_KEY.

use aep_ucb_perimeter_v1::{
    AgentKey, AuthError, AuthIdentity, AuthRegistry, ManifestSigners, Scope,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AuthMaterial {
    pub key_hash: String,
    pub source: &'static str,
    pub key_preview: Option<String>,
}

#[derive(Clone)]
pub struct AuthGuard {
    registry: Arc<AuthRegistry>,
}

impl AuthGuard {
    pub fn from_env_and_data_dir(data_dir: &Path, env_key: Option<&str>) -> Self {
        bootstrap_auth(data_dir, env_key).0
    }

    pub fn verify(&self, token: &str) -> bool {
        self.authorize(token, Scope::Ingest).is_ok()
            || self.authorize(token, Scope::Rollback).is_ok()
            || self.authorize(token, Scope::Delegate).is_ok()
            || self.authorize(token, Scope::Egress).is_ok()
    }

    pub fn authorize(&self, token: &str, scope: Scope) -> Result<AuthIdentity, AuthError> {
        self.registry.authorize(token, scope, false)
    }
}

pub fn extract_bearer_or_header(
    authorization: Option<&str>,
    x_ucb_api_key: Option<&str>,
) -> Option<String> {
    if let Some(h) = x_ucb_api_key {
        let t = h.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    let header = authorization.unwrap_or("").trim();
    if let Some(rest) = header.strip_prefix("Bearer ") {
        let t = rest.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

fn parse_scope(raw: &str) -> Option<Scope> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "ingest" => Some(Scope::Ingest),
        "delegate" => Some(Scope::Delegate),
        "egress" => Some(Scope::Egress),
        "rollback" => Some(Scope::Rollback),
        "read_diff" | "readdiff" => Some(Scope::ReadDiff),
        "read_manifest" | "readmanifest" => Some(Scope::ReadManifest),
        _ => None,
    }
}

/// The agent records of `ucb-agent-keys.json` in the data folder.
fn read_agent_records(data_dir: &Path) -> Vec<serde_json::Value> {
    let path = data_dir.join(AGENT_KEYS_FILE);
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    parsed
        .get("agents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

/// The file of the per-agent keys and manifest signer keys.
pub const AGENT_KEYS_FILE: &str = "ucb-agent-keys.json";

/// The manifest signer keys of the agents. Each agent record may name
/// `manifest_signer_public_hex`, the hex ML-DSA-65 public key whose signature makes a
/// task manifest of that agent count. A record with a key that is not hex is skipped.
pub fn load_manifest_signers(data_dir: &Path) -> ManifestSigners {
    let mut signers = ManifestSigners::new();
    for item in read_agent_records(data_dir) {
        let agent_id = item.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
        let key_hex = item
            .get("manifest_signer_public_hex")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if agent_id.is_empty() || key_hex.is_empty() {
            continue;
        }
        if let Ok(key) = hex::decode(key_hex) {
            signers.insert(agent_id, key);
        }
    }
    signers
}

/// A request named an agent other than the agent of its key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentMismatch;

/// The agent a request acts for. The operator key acts for the agent the request
/// names. An agent key acts only for its own agent: a request that names another
/// agent is refused and a request that names none acts for the agent of the key.
pub fn bind_agent(
    identity: &AuthIdentity,
    requested: Option<&str>,
) -> Result<Option<String>, AgentMismatch> {
    let requested = requested.map(str::trim).filter(|s| !s.is_empty());
    match identity {
        AuthIdentity::Operator => Ok(requested.map(str::to_string)),
        AuthIdentity::Agent { agent_id, .. } => match requested {
            None => Ok(Some(agent_id.clone())),
            Some(r) if r == agent_id => Ok(Some(agent_id.clone())),
            Some(_) => Err(AgentMismatch),
        },
    }
}

fn load_agent_keys(data_dir: &Path) -> Vec<AgentKey> {
    let mut out = Vec::new();
    for item in read_agent_records(data_dir) {
        let agent_id = item
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key_id = item
            .get("key_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key_hash = item
            .get("key_hash")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if agent_id.is_empty() || key_id.is_empty() || key_hash.is_empty() {
            continue;
        }
        let scopes = item
            .get("scopes")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str().and_then(parse_scope))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        out.push(AgentKey {
            agent_id,
            key_id,
            key_hash,
            scopes,
        });
    }
    out
}

fn load_or_create_operator(data_dir: &Path, env_key: Option<&str>) -> (String, AuthMaterial) {
    if let Some(key) = env_key.map(str::trim).filter(|k| !k.is_empty()) {
        let hash = hash_key(key);
        return (
            key.to_string(),
            AuthMaterial {
                key_hash: hash,
                source: "env",
                key_preview: None,
            },
        );
    }
    let path = data_dir.join("ucb-api-key.json");
    if path.is_file() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(hash) = parsed.get("key_hash").and_then(|v| v.as_str()) {
                    return (
                        String::new(),
                        AuthMaterial {
                            key_hash: hash.to_string(),
                            source: "file",
                            key_preview: parsed
                                .get("key_preview")
                                .and_then(|v| v.as_str())
                                .map(str::to_string),
                        },
                    );
                }
            }
        }
    }
    let key = format!("ucb_{}", hex::encode(rand_bytes(24)));
    let preview = format!(
        "{}…{}",
        &key[..8.min(key.len())],
        &key[key.len().saturating_sub(4)..]
    );
    let material = serde_json::json!({
        "version": "2.9.0",
        "created_at": chrono_now_rfc3339(),
        "key_hash": hash_key(&key),
        "key_preview": preview,
    });
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::create_dir_all(data_dir);
        let _ = fs::set_permissions(data_dir, fs::Permissions::from_mode(0o700));
    }
    #[cfg(not(unix))]
    {
        let _ = fs::create_dir_all(data_dir);
    }
    let _ = fs::write(
        &path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&material).unwrap_or_default()
        ),
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    (
        key,
        AuthMaterial {
            key_hash: hash_key_from_preview(&material),
            source: "generated",
            key_preview: Some(preview),
        },
    )
}

fn hash_key_from_preview(material: &serde_json::Value) -> String {
    material
        .get("key_hash")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

pub fn bootstrap_auth(data_dir: &Path, env_key: Option<&str>) -> (AuthGuard, AuthMaterial) {
    let (operator_secret, material) = load_or_create_operator(data_dir, env_key);
    let mut registry = if operator_secret.is_empty() {
        AuthRegistry::from_operator_hash(&material.key_hash)
    } else {
        AuthRegistry::with_operator_key(&operator_secret)
    };
    for key in load_agent_keys(data_dir) {
        registry.insert(key);
    }
    let guard = AuthGuard {
        registry: Arc::new(registry),
    };
    (guard, material)
}

fn hash_key(key: &str) -> String {
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    hex::encode(h.finalize())
}

fn rand_bytes(n: usize) -> Vec<u8> {
    let mut out = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut out);
    out
}

fn chrono_now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    const SECS_PER_DAY: u64 = 86400;
    let days = secs / SECS_PER_DAY;
    let day_secs = secs % SECS_PER_DAY;
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn env_key_takes_precedence() {
        let dir = tempdir().unwrap();
        let (guard, mat) = bootstrap_auth(dir.path(), Some("test_key_123"));
        assert_eq!(mat.source, "env");
        assert!(guard.verify("test_key_123"));
        assert!(!guard.verify("wrong"));
    }

    #[test]
    fn agent_key_cannot_rollback() {
        let dir = tempdir().unwrap();
        let agent_secret = "agent-secret";
        let rec = serde_json::json!({
            "agents": [{
                "agent_id": "lg-1",
                "key_id": "k1",
                "key_hash": AuthRegistry::hash_key(agent_secret),
                "scopes": ["ingest"]
            }]
        });
        std::fs::write(dir.path().join("ucb-agent-keys.json"), rec.to_string()).unwrap();
        let (guard, _) = bootstrap_auth(dir.path(), Some("operator-secret"));
        assert!(guard.authorize(agent_secret, Scope::Ingest).is_ok());
        assert!(guard.authorize(agent_secret, Scope::Rollback).is_err());
        assert!(guard.authorize("operator-secret", Scope::Rollback).is_ok());
    }

    /// UCB 01: an agent key acts for its own agent only. The operator acts for any.
    #[test]
    fn agent_key_binds_to_its_agent() {
        let agent = AuthIdentity::Agent {
            agent_id: String::from("agent-a"),
            key_id: String::from("k1"),
        };
        assert_eq!(
            bind_agent(&agent, Some("agent-a")),
            Ok(Some(String::from("agent-a")))
        );
        assert_eq!(bind_agent(&agent, None), Ok(Some(String::from("agent-a"))));
        assert_eq!(
            bind_agent(&agent, Some(" ")),
            Ok(Some(String::from("agent-a")))
        );
        assert_eq!(bind_agent(&agent, Some("agent-b")), Err(AgentMismatch));
        assert_eq!(
            bind_agent(&AuthIdentity::Operator, Some("agent-b")),
            Ok(Some(String::from("agent-b")))
        );
        assert_eq!(bind_agent(&AuthIdentity::Operator, None), Ok(None));
    }

    #[test]
    fn manifest_signers_load_from_the_agent_keys_file() {
        let dir = tempdir().unwrap();
        let rec = serde_json::json!({
            "agents": [
                {"agent_id": "a", "key_id": "k", "key_hash": "h", "manifest_signer_public_hex": "0a0b"},
                {"agent_id": "b", "key_id": "k", "key_hash": "h", "manifest_signer_public_hex": "zz"},
                {"agent_id": "c", "key_id": "k", "key_hash": "h"}
            ]
        });
        std::fs::write(dir.path().join(AGENT_KEYS_FILE), rec.to_string()).unwrap();
        let signers = load_manifest_signers(dir.path());
        assert_eq!(signers.get("a"), Some(&[0x0a, 0x0b][..]));
        assert_eq!(signers.get("b"), None);
        assert_eq!(signers.get("c"), None);
        assert_eq!(signers.len(), 1);
    }

    #[test]
    fn generated_key_has_no_plaintext_recovery() {
        let dir = tempdir().unwrap();
        let (_guard, mat) = bootstrap_auth(dir.path(), None);
        assert_eq!(mat.source, "generated");
        assert!(!dir.path().join("ucb-api-key.recovery.txt").is_file());
    }
}
