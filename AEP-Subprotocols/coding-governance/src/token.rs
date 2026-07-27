//! Short-lived ProposeToken binding intent to blast radius.
//! HIGH: tokens are HMAC-signed so client-minted forgeries fail verify.

use crate::blast_radius::BlastRadiusReport;
use crate::IntentDeclaration;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProposeToken {
    pub token_version: String,
    pub intent_id: String,
    pub blast_radius_hash: String,
    pub issued_at: String,
    pub expires_at: String,
    pub allowed_paths: Vec<String>,
    pub max_files: Option<u32>,
    pub max_lines: Option<u32>,
    /// HMAC-SHA256 hex over canonical token body (excluding this field).
    #[serde(default)]
    pub signature: String,
}

fn token_hmac_key() -> Result<Vec<u8>, String> {
    match std::env::var("AEP_PROPOSE_TOKEN_SECRET") {
        Ok(s) if !s.is_empty() => Ok(s.into_bytes()),
        _ => {
            // Tests only: explicit opt-in to a non-production default.
            if std::env::var("AEP_PROPOSE_TOKEN_ALLOW_TEST_DEFAULT")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
            {
                return Ok(b"aep-coding-governance-test-only-secret-v1".to_vec());
            }
            Err(
                "AEP_PROPOSE_TOKEN_SECRET is required (no public default MAC secret)".into(),
            )
        }
    }
}

/// Real HMAC-SHA256 (RFC 2104) using sha2 only (no extra crate).
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        let dig = Sha256::digest(key);
        k[..32].copy_from_slice(&dig);
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(message);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    let out = outer.finalize();
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&out);
    arr
}

pub(crate) fn sign_token_body(token: &ProposeToken) -> Result<String, String> {
    // MEDIUM: true HMAC-SHA256 over canonical body (domain-separated).
    let body = format!(
        "v2|{}|{}|{}|{}|{}|{}|{:?}|{:?}",
        token.token_version,
        token.intent_id,
        token.blast_radius_hash,
        token.issued_at,
        token.expires_at,
        token.allowed_paths.join(","),
        token.max_files,
        token.max_lines
    );
    let key = token_hmac_key()?;
    Ok(hex::encode(hmac_sha256(&key, body.as_bytes())))
}

pub fn verify_token_signature(token: &ProposeToken) -> Result<(), String> {
    if token.signature.is_empty() {
        return Err("propose token missing signature (unsigned forge rejected)".into());
    }
    let expected = sign_token_body(token)?;
    if expected.len() != token.signature.len() {
        return Err("propose token signature invalid".into());
    }
    // constant-time-ish
    let mut diff = 0u8;
    for (a, b) in expected.bytes().zip(token.signature.bytes()) {
        diff |= a ^ b;
    }
    if diff != 0 {
        return Err("propose token signature invalid".into());
    }
    Ok(())
}

pub fn mint_intent_id() -> String {
    // BL-07: unique intent ids (nanos + counter) to avoid second-resolution collisions
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("INT-{nanos}-{n}")
}

pub fn hash_report(report: &BlastRadiusReport) -> String {
    let json = serde_json::to_string(report).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("sha256:{}", hex::encode(hasher.finalize()))
}

pub fn issue_token(
    intent_id: &str,
    intent: &IntentDeclaration,
    report: &BlastRadiusReport,
    ttl_secs: u64,
) -> ProposeToken {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut token = ProposeToken {
        token_version: "1".into(),
        intent_id: intent_id.to_string(),
        blast_radius_hash: hash_report(report),
        issued_at: now.to_string(),
        expires_at: (now + ttl_secs).to_string(),
        allowed_paths: intent.envelope.allowed_paths.clone(),
        max_files: intent.envelope.max_files,
        max_lines: intent.envelope.max_lines,
        signature: String::new(),
    };
    token.signature = sign_token_body(&token).unwrap_or_default();
    token
}

/// Mint a token or fail if the MAC secret is not configured.
pub fn issue_token_strict(
    intent_id: &str,
    intent: &IntentDeclaration,
    report: &BlastRadiusReport,
    ttl_secs: u64,
) -> Result<ProposeToken, String> {
    let mut token = issue_token(intent_id, intent, report, ttl_secs);
    if token.signature.is_empty() {
        return Err(token_hmac_key().err().unwrap_or_else(|| {
            "propose token signature empty".into()
        }));
    }
    Ok(token)
}

pub fn verify_path_against_token(token: &ProposeToken, path: &str) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    verify_token_signature(token)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let expires: u64 = token.expires_at.parse().unwrap_or(0);
    if now > expires {
        return Err("propose token expired".into());
    }
    if crate::catalog::path_has_escape(path) {
        return Err(format!("path '{path}' contains parent-directory escape"));
    }
    if token.allowed_paths.is_empty() {
        return Err("propose token allowed_paths is empty (fail closed)".into());
    }
    let norm = crate::catalog::normalize_path(path);
    let ok = token.allowed_paths.iter().any(|a| {
        let p = crate::catalog::normalize_path(a);
        norm == p || norm.starts_with(&format!("{p}/"))
    });
    if !ok {
        return Err(format!("path '{path}' outside propose token envelope"));
    }
    Ok(())
}

pub fn default_ttl_secs() -> u64 {
    std::env::var("AEP_PROPOSE_TTL_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3600)
}

#[cfg(test)]
mod high_tests {
    use super::*;
    use std::sync::Mutex;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn unsigned_token_rejected() {
        let _g = ENV_LOCK.lock().unwrap();
        let mut t = ProposeToken {
            token_version: "1".into(),
            intent_id: "i".into(),
            blast_radius_hash: "h".into(),
            issued_at: "0".into(),
            expires_at: "9999999999".into(),
            allowed_paths: vec!["src".into()],
            max_files: None,
            max_lines: None,
            signature: String::new(),
        };
        assert!(verify_token_signature(&t).is_err());
        t.signature = "deadbeef".into();
        assert!(verify_token_signature(&t).is_err());
    }

    #[test]
    fn signed_token_roundtrip() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::set_var("AEP_PROPOSE_TOKEN_SECRET", "unit-test-secret");
        let mut t = ProposeToken {
            token_version: "1".into(),
            intent_id: "i".into(),
            blast_radius_hash: "h".into(),
            issued_at: "0".into(),
            expires_at: "9999999999".into(),
            allowed_paths: vec!["src".into()],
            max_files: None,
            max_lines: None,
            signature: String::new(),
        };
        t.signature = sign_token_body(&t).expect("mac");
        assert!(verify_token_signature(&t).is_ok());
        assert!(verify_path_against_token(&t, "src/lib.rs").is_ok());
        assert!(verify_path_against_token(&t, "evil/../src/x").is_err());
    }

    #[test]
    fn missing_secret_fails_closed() {
        let _g = ENV_LOCK.lock().unwrap();
        std::env::remove_var("AEP_PROPOSE_TOKEN_SECRET");
        std::env::remove_var("AEP_PROPOSE_TOKEN_ALLOW_TEST_DEFAULT");
        let t = ProposeToken {
            token_version: "1".into(),
            intent_id: "i".into(),
            blast_radius_hash: "h".into(),
            issued_at: "0".into(),
            expires_at: "9999999999".into(),
            allowed_paths: vec!["src".into()],
            max_files: None,
            max_lines: None,
            signature: "00".into(),
        };
        assert!(verify_token_signature(&t).is_err());
    }
}
