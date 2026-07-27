//! Announce: lattice coordination frame binding agent_id + task manifest + coding intent.

use aep_subprotocol_core::ValidationResult;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
struct TaskManifestTrust {
    #[serde(default)]
    tier: String,
    max_trust_score: u16,
}

#[derive(Debug, Deserialize)]
struct TaskManifestRef {
    manifest_version: String,
    id: String,
    agent_id: String,
    intent: Value,
    trust: TaskManifestTrust,
    #[serde(default)]
    provisional: bool,
}

pub fn handle_announce(payload: &Value) -> ValidationResult {
    let agent_id = payload
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if agent_id.is_empty() {
        return ValidationResult::fail(vec!["announce requires agent_id".into()]);
    }

    let intent_id = payload
        .get("intent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if intent_id.is_empty() {
        return ValidationResult::fail(vec!["announce requires intent_id".into()]);
    }

    let manifest_value = payload.get("task_manifest").cloned().unwrap_or(Value::Null);
    let Ok(manifest) = serde_json::from_value::<TaskManifestRef>(manifest_value.clone()) else {
        return ValidationResult::fail(vec![
            "announce requires task_manifest matching task-manifest-v1".into(),
        ]);
    };

    if manifest.manifest_version != "1" {
        return ValidationResult::fail(vec![
            "task_manifest.manifest_version must be \"1\"".into(),
        ]);
    }

    if manifest.agent_id != agent_id {
        return ValidationResult::fail(vec![format!(
            "task_manifest.agent_id '{}' must match announce agent_id '{agent_id}'",
            manifest.agent_id
        )]);
    }

    if manifest.id.trim().is_empty() {
        return ValidationResult::fail(vec!["task_manifest.id must not be empty".into()]);
    }

    let summary = manifest
        .intent
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if summary.is_empty() {
        return ValidationResult::fail(vec![
            "task_manifest.intent.summary must not be empty".into(),
        ]);
    }

    let ops = manifest
        .intent
        .get("allowed_operations")
        .and_then(|v| v.as_array());
    if ops.map(|a| a.is_empty()).unwrap_or(true) {
        return ValidationResult::fail(vec![
            "task_manifest.intent.allowed_operations must be non-empty".into(),
        ]);
    }

    let coding_intent_id = manifest
        .intent
        .get("coding_governance")
        .and_then(|cg| cg.get("intent_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !coding_intent_id.is_empty() && coding_intent_id != intent_id {
        return ValidationResult::fail(vec![format!(
            "task_manifest.intent.coding_governance.intent_id '{coding_intent_id}' must match announce intent_id '{intent_id}'"
        )]);
    }
    // When coding_governance block is absent, announce.mjs must sync manifest before validate.
    if coding_intent_id.is_empty() {
        return ValidationResult::fail(vec![
            "task_manifest.intent.coding_governance.intent_id required; sync manifest before announce".into(),
        ]);
    }

    if manifest.provisional {
        return ValidationResult::fail(vec![format!(
            "task_manifest {} is provisional; promote before announce",
            manifest.id
        )]);
    }

    let trust_score = payload
        .get("trust_score")
        .and_then(|v| v.as_u64())
        .map(|n| n as u16)
        .unwrap_or(manifest.trust.max_trust_score.min(1000));

    if trust_score > manifest.trust.max_trust_score {
        return ValidationResult::fail(vec![format!(
            "trust_score {trust_score} exceeds task manifest max {}",
            manifest.trust.max_trust_score
        )]);
    }

    ValidationResult::ok(Some(json!({
        "agent_id": agent_id,
        "intent_id": intent_id,
        "task_manifest_id": manifest.id,
        "thread_id": payload.get("thread_id").and_then(|v| v.as_str()),
        "correlation_id": payload.get("correlation_id").and_then(|v| v.as_str()),
        "session_id": payload.get("session_id").and_then(|v| v.as_str()),
        "trust_score": trust_score,
        "event_type": "CODING_GOVERNANCE_ANNOUNCE",
        "docking_port": payload.get("docking_port").and_then(|v| v.as_str()).unwrap_or("validation_engine"),
        "ready_for_lattice": true
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_manifest(agent_id: &str) -> Value {
        json!({
            "manifest_version": "1",
            "id": "TM-TEST",
            "agent_id": agent_id,
            "intent": {
                "summary": "Update CCA gap context",
                "allowed_operations": ["coding:propose", "AEP-Components/cca/"],
                "coding_governance": { "intent_id": "INT-1" }
            },
            "trust": { "tier": "standard", "max_trust_score": 800 },
            "provisional": false,
            "synthesized_by": "gap_constrained"
        })
    }

    #[test]
    fn requires_agent_and_manifest_match() {
        let r = handle_announce(&json!({
            "agent_id": "agent-a",
            "intent_id": "INT-1",
            "task_manifest": sample_manifest("agent-b")
        }));
        assert!(!r.valid);
    }

    #[test]
    fn accepts_valid_announce() {
        let r = handle_announce(&json!({
            "agent_id": "agent-a",
            "intent_id": "INT-1",
            "task_manifest": sample_manifest("agent-a"),
            "thread_id": "thread-1"
        }));
        assert!(r.valid, "{:?}", r.errors);
        assert_eq!(r.detail.unwrap()["event_type"], "CODING_GOVERNANCE_ANNOUNCE");
    }
}