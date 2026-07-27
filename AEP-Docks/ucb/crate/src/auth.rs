//! UCB API key authentication (env or persisted file).

use rand::RngCore;
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
        // BM-05: constant-time compare of hex digests (equal length after hash)
        constant_time_eq_hex(&hash_key(token), &self.key_hash)
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
    // MEDIUM: chmod both key metadata and recovery to 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    let recovery_path = data_dir.join("ucb-api-key.recovery.txt");
    if !recovery_path.is_file() {
        let _ = fs::write(&recovery_path, format!("{key}\n"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&recovery_path, fs::Permissions::from_mode(0o600));
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

/// BM-05: constant-time equality for equal-length hex strings.
fn constant_time_eq_hex(a: &str, b: &str) -> bool {
    let ab = a.as_bytes();
    let bb = b.as_bytes();
    if ab.len() != bb.len() {
        // length mismatch: still scan max to reduce trivial short-circuit signal
        let mut acc = (ab.len() ^ bb.len()) as u8;
        let n = ab.len().max(bb.len());
        for i in 0..n {
            let x = ab.get(i).copied().unwrap_or(0);
            let y = bb.get(i).copied().unwrap_or(0);
            acc |= x ^ y;
        }
        return acc == 0;
    }
    let mut acc = 0u8;
    for i in 0..ab.len() {
        acc |= ab[i] ^ bb[i];
    }
    acc == 0
}

/// CSPRNG for bootstrap API keys (replaces time-seeded LCG).
fn rand_bytes(n: usize) -> Vec<u8> {
    let mut out = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut out);
    out
}

/// BL-06: real RFC3339 timestamps (not bare unix seconds).
fn chrono_now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // UTC RFC3339 without external chrono dep in this crate
    // Format: YYYY-MM-DDTHH:MM:SSZ via simple gmtime math
    const SECS_PER_DAY: u64 = 86400;
    let days = secs / SECS_PER_DAY;
    let day_secs = secs % SECS_PER_DAY;
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}Z")
}

/// Howard Hinnant civil_from_days (proleptic Gregorian).
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
    fn bm05_constant_time_eq_accepts_equal_rejects_diff() {
        assert!(constant_time_eq_hex("abc", "abc"));
        assert!(!constant_time_eq_hex("abc", "abd"));
        assert!(!constant_time_eq_hex("ab", "abc"));
    }

    #[test]
    fn bl06_rfc3339_shape() {
        let t = chrono_now_rfc3339();
        assert!(
            t.ends_with('Z') && t.contains('T') && t.len() >= 20,
            "expected RFC3339 got {t}"
        );
    }

    #[test]
    fn generated_key_uses_csprng_length() {
        let dir = tempdir().unwrap();
        let (_guard, mat) = bootstrap_auth(dir.path(), None);
        assert_eq!(mat.source, "generated");
        // recovery file exists with ucb_ prefix key
        let rec = std::fs::read_to_string(dir.path().join("ucb-api-key.recovery.txt")).unwrap();
        assert!(rec.starts_with("ucb_"));
        assert!(rec.trim().len() > 20);
    }
}