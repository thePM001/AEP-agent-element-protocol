//! Full propose flow: validate intent, compute blast radius, issue token.

use crate::blast_radius::{compute_blast_radius, paths_from_payload, BlastRadiusReport};
use crate::catalog::{resolve_repo_root, ComponentIndex};
use crate::token::{default_ttl_secs, issue_token, mint_intent_id};
use crate::IntentDeclaration;
use aep_subprotocol_core::ValidationResult;
use serde_json::{json, Value};

pub fn handle_propose(payload: &Value) -> ValidationResult {
    let Ok(intent) = serde_json::from_value::<IntentDeclaration>(payload.clone()) else {
        return ValidationResult::fail(vec![
            "propose requires { statement, envelope }".into(),
        ]);
    };
    if intent.statement.trim().is_empty() {
        return ValidationResult::fail(vec!["statement must not be empty".into()]);
    }

    let repo_root = resolve_repo_root(payload);
    let catalog = match ComponentIndex::load(&repo_root) {
        Ok(c) => c,
        Err(e) => {
            return ValidationResult::fail(vec![format!("catalog load failed: {e}")]);
        }
    };

    let paths = paths_from_payload(payload);
    let lines_estimate = payload
        .get("lines_estimate")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    let report = compute_blast_radius(&intent, &paths, lines_estimate, &catalog);
    if !report.within_envelope {
        return ValidationResult::fail(report.errors.clone());
    }

    let intent_id = payload
        .get("intent_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(mint_intent_id);

    let token = issue_token(&intent_id, &intent, &report, default_ttl_secs());

    ValidationResult::ok(Some(json!({
        "intent_id": intent_id,
        "blast_radius": report,
        "propose_token": token,
    })))
}

pub fn handle_blast_radius(payload: &Value) -> ValidationResult {
    let Ok(intent) = serde_json::from_value::<IntentDeclaration>(payload.clone()) else {
        return ValidationResult::fail(vec![
            "blast_radius requires { statement, envelope }".into(),
        ]);
    };

    let repo_root = resolve_repo_root(payload);
    let catalog = match ComponentIndex::load(&repo_root) {
        Ok(c) => c,
        Err(e) => return ValidationResult::fail(vec![format!("catalog load failed: {e}")]),
    };

    let paths = paths_from_payload(payload);
    let lines_estimate = payload
        .get("lines_estimate")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    let report: BlastRadiusReport =
        compute_blast_radius(&intent, &paths, lines_estimate, &catalog);

    if report.within_envelope {
        ValidationResult::ok(Some(json!({ "blast_radius": report })))
    } else {
        ValidationResult::fail(report.errors.clone())
    }
}