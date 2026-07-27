//! Workflows subprotocol: hallucination-proof workflow step validation.

use aep_subprotocol_core::{validate_payload_against_schema, ValidationResult};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashMap;
use std::env;

type HmacSha256 = Hmac<Sha256>;

/// Verify operator approval HMAC for requires_approval steps.
/// Expected token material: HMAC-SHA256(secret, "action|{action}|issuer|{issuer}") as hex.
/// Env: AEP_WORKFLOW_APPROVAL_SECRET (required when requires_approval is true).
pub fn verify_workflow_approval(action: &str, payload: &Value) -> Result<(), String> {
    let approved = payload
        .get("approval")
        .and_then(|v| v.get("approved"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !approved {
        return Err(format!(
            "Action \"{action}\" requires_approval: set payload.approval.approved=true"
        ));
    }
    let token = payload
        .get("approval")
        .and_then(|v| v.get("token"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if token.is_empty() {
        return Err(format!(
            "Action \"{action}\" requires_approval: supply non-empty payload.approval.token"
        ));
    }
    let secret = env::var("AEP_WORKFLOW_APPROVAL_SECRET").map_err(|_| {
        format!(
            "Action \"{action}\" requires_approval: AEP_WORKFLOW_APPROVAL_SECRET is not set (fail closed)"
        )
    })?;
    if secret.trim().is_empty() {
        return Err(format!(
            "Action \"{action}\" requires_approval: AEP_WORKFLOW_APPROVAL_SECRET is empty (fail closed)"
        ));
    }
    let issuer = payload
        .get("approval")
        .and_then(|v| v.get("issuer"))
        .and_then(|v| v.as_str())
        .unwrap_or("operator");
    let body = format!("action|{action}|issuer|{issuer}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|e| format!("HMAC init failed: {e}"))?;
    mac.update(body.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());
    // Constant-time compare via hmac::digest::crypto_common? Use subtle length-checked.
    if !ct_eq_hex(token, &expected) {
        return Err(format!(
            "Action \"{action}\" requires_approval: invalid approval.token for issuer \"{issuer}\""
        ));
    }
    Ok(())
}

fn ct_eq_hex(a: &str, b: &str) -> bool {
    let a = a.trim().to_ascii_lowercase();
    let b = b.trim().to_ascii_lowercase();
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepSchema {
    pub action: String,
    #[serde(default)]
    pub payload_schema: Value,
    #[serde(default)]
    pub allowed_transitions: Vec<String>,
    #[serde(default)]
    pub requires_approval: bool,
    #[serde(default = "default_retries")]
    pub max_retries: u32,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
}

fn default_retries() -> u32 {
    3
}
fn default_timeout() -> u64 {
    30_000
}

#[derive(Debug, Default)]
pub struct WorkflowRegistry {
    steps: HashMap<String, WorkflowStepSchema>,
}

impl WorkflowRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, action: impl Into<String>, schema: WorkflowStepSchema) {
        self.steps.insert(action.into(), schema);
    }

    pub fn validate_step(
        &self,
        action: &str,
        payload: &Value,
        current_state: Option<&str>,
    ) -> ValidationResult {
        let Some(step) = self.steps.get(action) else {
            let registered: Vec<_> = self.steps.keys().cloned().collect();
            return ValidationResult::fail(vec![format!(
                "Unknown action: \"{action}\". Registered: {registered:?}"
            )]);
        };

        let mut errors = Vec::new();
        if let Some(state) = current_state {
            match self.steps.get(state) {
                Some(prev) => {
                    // Empty allowed_transitions = end-state (deny all next actions).
                    if prev.allowed_transitions.is_empty()
                        || !prev.allowed_transitions.iter().any(|a| a == action)
                    {
                        errors.push(format!(
                            "Invalid transition: cannot go from \"{state}\" to \"{action}\". Allowed: {:?}",
                            prev.allowed_transitions
                        ));
                    }
                }
                None => {
                    errors.push(format!(
                        "Unknown current_state \"{state}\" is not a registered workflow action (fail closed)"
                    ));
                }
            }
        }

        errors.extend(validate_payload_against_schema(
            payload,
            &step.payload_schema,
        ));

        if step.requires_approval {
            if let Err(msg) = verify_workflow_approval(action, payload) {
                errors.push(msg);
            }
        }

        if !errors.is_empty() {
            return ValidationResult::fail(errors);
        }

        ValidationResult::ok(Some(json!({
            "action": action,
            "status": "executed",
            "previous_state": current_state,
            "requires_approval": step.requires_approval,
        })))
    }

    pub fn load_reference(path: &str) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let defs: Vec<WorkflowStepSchema> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut reg = Self::new();
        for step in defs {
            reg.register(step.action.clone(), step);
        }
        Ok(reg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_action() {
        let reg = WorkflowRegistry::new();
        let r = reg.validate_step("nope", &json!({}), None);
        assert!(!r.valid);
    }

    fn step(action: &str, transitions: Vec<String>, requires_approval: bool) -> WorkflowStepSchema {
        WorkflowStepSchema {
            action: action.into(),
            payload_schema: json!({ "type": "object" }),
            allowed_transitions: transitions,
            requires_approval,
            max_retries: 3,
            timeout_ms: 30_000,
        }
    }

    #[test]
    fn empty_allowed_transitions_is_terminal() {
        let mut reg = WorkflowRegistry::new();
        reg.register("complete_task", step("complete_task", vec![], false));
        reg.register("reopen", step("reopen", vec![], false));
        let r = reg.validate_step("reopen", &json!({}), Some("complete_task"));
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("Invalid transition")));
    }

    #[test]
    fn requires_approval_blocks_without_token() {
        let mut reg = WorkflowRegistry::new();
        reg.register("deploy", step("deploy", vec![], true));
        let deny = reg.validate_step("deploy", &json!({}), None);
        assert!(!deny.valid);
        assert!(deny.errors.iter().any(|e| e.contains("requires_approval")));
    }

    #[test]
    fn requires_approval_rejects_self_forged_token() {
        std::env::set_var("AEP_WORKFLOW_APPROVAL_SECRET", "test-secret-workflow");
        let mut reg = WorkflowRegistry::new();
        reg.register("deploy", step("deploy", vec![], true));
        let deny = reg.validate_step(
            "deploy",
            &json!({ "approval": { "approved": true, "token": "forged", "issuer": "op" } }),
            None,
        );
        assert!(!deny.valid);
        assert!(deny.errors.iter().any(|e| e.contains("invalid approval.token")));
        // Valid HMAC for action|deploy|issuer|op
        use hmac::{Hmac, Mac};
        use sha2::Sha256;
        let mut mac = Hmac::<Sha256>::new_from_slice(b"test-secret-workflow").unwrap();
        mac.update(b"action|deploy|issuer|op");
        let token = hex::encode(mac.finalize().into_bytes());
        let ok = reg.validate_step(
            "deploy",
            &json!({ "approval": { "approved": true, "token": token, "issuer": "op" } }),
            None,
        );
        assert!(ok.valid, "{:?}", ok.errors);
        std::env::remove_var("AEP_WORKFLOW_APPROVAL_SECRET");
    }

    #[test]
    fn unknown_current_state_fails_closed() {
        let mut reg = WorkflowRegistry::new();
        reg.register("deploy", step("deploy", vec![], false));
        let r = reg.validate_step("deploy", &json!({}), Some("not_a_step"));
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("Unknown current_state")));
    }
}