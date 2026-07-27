//! Solidify record validation (ledger append happens in intent-ledger component).

use crate::token::{verify_token_signature, ProposeToken};
use aep_subprotocol_core::ValidationResult;
use serde_json::{json, Value};

pub fn handle_solidify(payload: &Value) -> ValidationResult {
    let intent_id = payload
        .get("intent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if intent_id.is_empty() {
        return ValidationResult::fail(vec!["solidify requires intent_id".into()]);
    }

    // MEDIUM: solidify must bind to a valid propose token (fail closed)
    let Some(token_val) = payload.get("propose_token") else {
        return ValidationResult::fail(vec![
            "solidify requires propose_token from a prior propose".into(),
        ]);
    };
    let token: ProposeToken = match serde_json::from_value(token_val.clone()) {
        Ok(t) => t,
        Err(e) => {
            return ValidationResult::fail(vec![format!("invalid propose_token: {e}")]);
        }
    };
    if let Err(e) = verify_token_signature(&token) {
        return ValidationResult::fail(vec![format!("propose_token verify failed: {e}")]);
    }
    // Expiry (same clock as verify_path_against_token).
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let expires: u64 = token.expires_at.parse().unwrap_or(0);
        if now > expires {
            return ValidationResult::fail(vec!["propose_token expired".into()]);
        }
    }
    if token.intent_id != intent_id {
        return ValidationResult::fail(vec![
            "propose_token.intent_id must match solidify intent_id".into(),
        ]);
    }

    if let Some(ref_obj) = payload.get("evidence_ledger_ref") {
        if !ref_obj.is_object() {
            return ValidationResult::fail(vec![
                "evidence_ledger_ref must be an object".into(),
            ]);
        }
        let session_id = ref_obj
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if session_id.is_empty() {
            return ValidationResult::fail(vec![
                "evidence_ledger_ref.session_id must not be empty".into(),
            ]);
        }
    }

    if let Some(git_refs) = payload.get("git_refs") {
        if !git_refs.is_object() {
            return ValidationResult::fail(vec!["git_refs must be an object".into()]);
        }
        let commit = git_refs
            .get("commit")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if commit.is_empty() {
            return ValidationResult::fail(vec![
                "git_refs.commit must not be empty when git_refs is provided".into(),
            ]);
        }
    }

    if let Some(chain) = payload.get("causal_chain").and_then(|v| v.as_array()) {
        for (i, item) in chain.iter().enumerate() {
            let why = item.get("why").and_then(|v| v.as_str()).unwrap_or("").trim();
            let source = item.get("source").and_then(|v| v.as_str()).unwrap_or("").trim();
            if why.is_empty() || source.is_empty() {
                return ValidationResult::fail(vec![format!(
                    "causal_chain[{i}] requires why and source"
                )]);
            }
        }
    }

    ValidationResult::ok(Some(json!({
        "intent_id": intent_id,
        "ack": true,
        "evidence_linked": payload.get("evidence_ledger_ref").is_some(),
        "git_linked": payload.get("git_refs").and_then(|g| g.get("commit")).is_some(),
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::token::{sign_token_body, ProposeToken};
    use serde_json::json;

    fn signed_token(intent_id: &str) -> serde_json::Value {
        std::env::set_var("AEP_PROPOSE_TOKEN_SECRET", "unit-test-solidify-secret");
        let mut t = ProposeToken {
            token_version: "1".into(),
            intent_id: intent_id.into(),
            blast_radius_hash: "h".into(),
            issued_at: "0".into(),
            expires_at: "9999999999".into(),
            allowed_paths: vec!["src".into()],
            max_files: None,
            max_lines: None,
            signature: String::new(),
        };
        t.signature = sign_token_body(&t).expect("mac");
        serde_json::to_value(t).expect("json")
    }

    #[test]
    fn requires_intent_id() {
        let r = handle_solidify(&json!({}));
        assert!(!r.valid);
    }

    #[test]
    fn requires_propose_token() {
        let r = handle_solidify(&json!({ "intent_id": "i1" }));
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("propose_token")));
    }

    #[test]
    fn rejects_empty_git_commit() {
        let r = handle_solidify(&json!({
            "intent_id": "INT-1",
            "propose_token": signed_token("INT-1"),
            "git_refs": { "branch": "main" }
        }));
        assert!(!r.valid);
    }

    #[test]
    fn accepts_git_refs() {
        let r = handle_solidify(&json!({
            "intent_id": "INT-1",
            "propose_token": signed_token("INT-1"),
            "git_refs": { "commit": "abc123", "branch": "main" }
        }));
        assert!(r.valid, "{:?}", r.errors);
        assert_eq!(r.detail.unwrap()["git_linked"], true);
    }

    #[test]
    fn accepts_evidence_ref() {
        let r = handle_solidify(&json!({
            "intent_id": "INT-1",
            "propose_token": signed_token("INT-1"),
            "evidence_ledger_ref": { "session_id": "sess-a", "last_seq": 3 }
        }));
        assert!(r.valid, "{:?}", r.errors);
        assert_eq!(r.detail.unwrap()["evidence_linked"], true);
    }
}
