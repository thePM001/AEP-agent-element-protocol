//! AgentMesh identity binding for UCB ingress.

use aep_agentmesh::{create_bundle, AgentMeshBundle};
use serde_json::json;

pub fn bundle_for_agent(agent_id: &str, trust_score: u16) -> AgentMeshBundle {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    create_bundle(
        agent_id,
        trust_score,
        agent_id.as_bytes(),
        vec![
            "lattice.channel".into(),
            "ucb.ingress".into(),
            "task.manifest".into(),
        ],
        now,
    )
}

pub fn agentmesh_json(agent_id: &str, trust_score: u16) -> serde_json::Value {
    let b = bundle_for_agent(agent_id, trust_score);
    json!({
        "agent_id": b.agent_id,
        "trust_score": b.trust_score,
        "spiffe_id": b.spiffe.spiffe_id,
        "did": b.did.id,
        "mtls_fingerprint": b.mtls.cert_fingerprint,
    })
}

pub fn validate_bundle_present(agent_id: &str) -> Result<(), String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id required for AgentMesh binding".into());
    }
    Ok(())
}