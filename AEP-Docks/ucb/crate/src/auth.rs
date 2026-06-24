//! UCB API key authentication (env or persisted file).

use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct AuthMaterial {
    pub key_hash: String,
    pub source: &'static str,
    pub key_preview: Option<String>,
}

#[derive(Clone)]
pub struct AuthGuard {
    key_hash: String,
}

impl AuthGuard {
    pub fn from_env_and_data_dir(data_dir: &Path, env_key: Option<&str>) -> Self {
        let material = load_or_create_api_key(data_dir, env_key);
        Self {
            key_hash: material.key_hash,
        }
    }

    pub fn verify(&self, token: &str) -> bool {
        if token.is_empty() {
            return false;
        }
        hash_key(token) == self.key_hash
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

fn load_or_create_api_key(data_dir: &Path, env_key: Option<&str>) -> AuthMaterial {
    if let Some(key) = env_key.map(str::trim).filter(|k| !k.is_empty()) {
        return AuthMaterial {
            key_hash: hash_key(key),
            source: "env",
            key_preview: None,
        };
    }

    let path = data_dir.join("ucb-api-key.json");
    if path.is_file() {
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(hash) = parsed.get("key_hash").and_then(|v| v.as_str()) {
                    return AuthMaterial {
                        key_hash: hash.to_string(),
                        source: "file",
                        key_preview: parsed
                            .get("key_preview")
                            .and_then(|v| v.as_str())
                            .map(str::to_string),
                    };
                }
            }
        }
    }

    let key = format!("ucb_{}", hex::encode(rand_bytes(24)));
    let preview = format!("{}…{}", &key[..8.min(key.len())], &key[key.len().saturating_sub(4)..]);
    let material = serde_json::json!({
        "version": "2.8.0",
        "created_at": chrono_now_rfc3339(),
        "key_hash": hash_key(&key),
        "key_preview": preview,
    });
    fs::create_dir_all(data_dir).ok();
    let _ = fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&material).unwrap_or_default()));
    let recovery_path = data_dir.join("ucb-api-key.recovery.txt");
    if !recovery_path.is_file() {
        let _ = fs::write(&recovery_path, format!("{key}\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&recovery_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = fs::set_permissions(&recovery_path, perms);
            }
        }
    }
    AuthMaterial {
        key_hash: hash_key(&key),
        source: "generated",
        key_preview: Some(preview),
    }
}

pub fn bootstrap_auth(data_dir: &Path, env_key: Option<&str>) -> (AuthGuard, AuthMaterial) {
    let material = load_or_create_api_key(data_dir, env_key);
    let guard = AuthGuard {
        key_hash: material.key_hash.clone(),
    };
    (guard, material)
}

fn hash_key(key: &str) -> String {
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    hex::encode(h.finalize())
}

fn rand_bytes(n: usize) -> Vec<u8> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut out = Vec::with_capacity(n);
    let mut x = seed as u64;
    for _ in 0..n {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
        out.push((x >> 33) as u8);
    }
    out
}

fn chrono_now_rfc3339() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
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
}