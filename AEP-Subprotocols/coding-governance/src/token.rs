//! Short-lived ProposeToken binding intent to blast radius.

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
}

pub fn mint_intent_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("INT-{secs}")
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
    ProposeToken {
        token_version: "1".into(),
        intent_id: intent_id.to_string(),
        blast_radius_hash: hash_report(report),
        issued_at: now.to_string(),
        expires_at: (now + ttl_secs).to_string(),
        allowed_paths: intent.envelope.allowed_paths.clone(),
        max_files: intent.envelope.max_files,
        max_lines: intent.envelope.max_lines,
    }
}

pub fn verify_path_against_token(token: &ProposeToken, path: &str) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let expires: u64 = token.expires_at.parse().unwrap_or(0);
    if now > expires {
        return Err("propose token expired".into());
    }
    if !token.allowed_paths.is_empty() {
        let norm = crate::catalog::normalize_path(path);
        let ok = token.allowed_paths.iter().any(|a| {
            let p = crate::catalog::normalize_path(a);
            norm == p || norm.starts_with(&format!("{p}/"))
        });
        if !ok {
            return Err(format!("path '{path}' outside propose token envelope"));
        }
    }
    Ok(())
}

pub fn default_ttl_secs() -> u64 {
    std::env::var("AEP_PROPOSE_TTL_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3600)
}