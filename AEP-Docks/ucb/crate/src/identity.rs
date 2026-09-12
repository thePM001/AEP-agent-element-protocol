// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! AgentMesh identity binding for UCB ingress.

use aep_agentmesh::{create_bundle, AgentMeshBundle};
use serde_json::Value;

pub fn bundle_for_agent(agent_id: &str) -> AgentMeshBundle {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    create_bundle(
        agent_id,
        crate::DOCK_WIRE_SCORE,
        agent_id.as_bytes(),
        vec![
            "lattice.channel".into(),
            "ucb.ingress".into(),
            "task.manifest".into(),
        ],
        now,
    )
}

pub fn agentmesh_json(agent_id: &str) -> Value {
    let b = bundle_for_agent(agent_id);
    let mut m = serde_json::Map::new();
    m.insert(String::from("agent_id"), Value::String(b.agent_id));
    m.insert(String::from("spiffe_id"), Value::String(b.spiffe.spiffe_id));
    m.insert(String::from("did"), Value::String(b.did.id));
    m.insert(String::from("mtls_fingerprint"), Value::String(b.mtls.cert_fingerprint));
    Value::Object(m)
}

pub fn validate_bundle_present(agent_id: &str) -> Result<(), String> {
    if agent_id.trim().is_empty() {
        return Err("agent_id required for AgentMesh binding".into());
    }
    Ok(())
}
