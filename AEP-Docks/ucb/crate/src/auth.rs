// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Per-agent UCB keys. Operator key is UCB_API_KEY.

use aep_ucb_perimeter_v1::{AgentKey, AuthError, AuthIdentity, AuthRegistry, Scope};
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

fn load_agent_keys(data_dir: &Path) -> Vec<AgentKey> {
    let path = data_dir.join("ucb-agent-keys.json");
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(arr) = parsed.get("agents").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        let agent_id = item.get("agent_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let key_id = item.get("key_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let key_hash = item.get("key_hash").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
    let preview = format!("{}…{}", &key[..8.min(key.len())], &key[key.len().saturating_sub(4)..]);
    let material = serde_json::json!({
        "version": "2.8.5",
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
    let _ = fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&material).unwrap_or_default()));
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

    #[test]
    fn generated_key_has_no_plaintext_recovery() {
        let dir = tempdir().unwrap();
        let (_guard, mat) = bootstrap_auth(dir.path(), None);
        assert_eq!(mat.source, "generated");
        assert!(!dir.path().join("ucb-api-key.recovery.txt").is_file());
    }
}
