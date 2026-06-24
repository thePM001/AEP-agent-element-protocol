//! Workflows subprotocol: hallucination-proof workflow step validation.

use aep_subprotocol_core::{validate_payload_against_schema, ValidationResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

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
            if let Some(prev) = self.steps.get(state) {
                if !prev.allowed_transitions.is_empty()
                    && !prev.allowed_transitions.iter().any(|a| a == action)
                {
                    errors.push(format!(
                        "Invalid transition: cannot go from \"{state}\" to \"{action}\". Allowed: {:?}",
                        prev.allowed_transitions
                    ));
                }
            }
        }

        errors.extend(validate_payload_against_schema(
            payload,
            &step.payload_schema,
        ));

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
}