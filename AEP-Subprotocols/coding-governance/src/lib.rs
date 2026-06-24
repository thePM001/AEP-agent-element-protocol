//! Coding governance subprotocol - canonical Rust validator for AI coding change control.

mod announce;
mod blast_radius;
mod catalog;
mod propose;
mod semantic_query;
mod solidify;
mod token;

use aep_subprotocol_core::ValidationResult;
use blast_radius::SieeVerdict;
use announce::handle_announce;
use propose::{handle_blast_radius, handle_propose};
use semantic_query::handle_semantic_query;
use solidify::handle_solidify;
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use token::{verify_path_against_token, ProposeToken};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IntentEnvelope {
    #[serde(default)]
    pub max_files: Option<u32>,
    #[serde(default)]
    pub max_lines: Option<u32>,
    #[serde(default)]
    pub allowed_paths: Vec<String>,
    #[serde(default)]
    pub forbidden_paths: Vec<String>,
    #[serde(default)]
    pub semantic_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntentDeclaration {
    pub statement: String,
    pub envelope: IntentEnvelope,
}

pub fn validate_action(action: &str, payload: &Value) -> ValidationResult {
    match action {
        "propose" => handle_propose(payload),
        "blast_radius" => handle_blast_radius(payload),
        "siee_check" => validate_siee(payload),
        "solidify" => handle_solidify(payload),
        "verify_token" => validate_verify_token(payload),
        "semantic_query" => handle_semantic_query(payload),
        "announce" => handle_announce(payload),
        _ => ValidationResult::fail(vec![format!("Unknown coding-governance action: {action}")]),
    }
}

fn validate_siee(payload: &Value) -> ValidationResult {
    let within = payload
        .get("within_envelope")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let justification = payload
        .get("justification")
        .and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    if within {
        return ValidationResult::ok(Some(serde_json::json!({ "siee_verdict": SieeVerdict::Allow })));
    }
    if justification {
        return ValidationResult::ok(Some(serde_json::json!({
            "siee_verdict": SieeVerdict::Gate,
            "gate_required": true
        })));
    }
    ValidationResult::fail(vec![
        "semantic impact exceeds declared envelope; provide justification or narrow scope".into(),
    ])
}

fn validate_verify_token(payload: &Value) -> ValidationResult {
    let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or("");
    if path.is_empty() {
        return ValidationResult::fail(vec!["verify_token requires path".into()]);
    }
    let Ok(token) = serde_json::from_value::<ProposeToken>(payload.get("token").cloned().unwrap_or(Value::Null))
    else {
        return ValidationResult::fail(vec!["verify_token requires valid propose token object".into()]);
    };
    match verify_path_against_token(&token, path) {
        Ok(()) => ValidationResult::ok(Some(serde_json::json!({ "path": path, "allowed": true }))),
        Err(e) => ValidationResult::fail(vec![e]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn propose_requires_statement() {
        let r = validate_action(
            "propose",
            &json!({ "statement": "", "envelope": { "allowed_paths": [] } }),
        );
        assert!(!r.valid);
    }

    #[test]
    fn siee_denies_breach_without_justification() {
        let r = validate_action("siee_check", &json!({ "within_envelope": false }));
        assert!(!r.valid);
    }

    #[test]
    fn propose_with_allowed_paths() {
        let r = validate_action(
            "propose",
            &json!({
                "statement": "Update CCA gap context",
                "envelope": {
                    "max_files": 3,
                    "allowed_paths": ["AEP-Components/cca/"],
                    "forbidden_paths": []
                },
                "paths": ["AEP-Components/cca/lib/gap-context.mjs"],
                "repo_root": concat!(env!("CARGO_MANIFEST_DIR"), "/../..")
            }),
        );
        assert!(r.valid, "errors: {:?}", r.errors);
        assert!(r.detail.is_some());
    }
}