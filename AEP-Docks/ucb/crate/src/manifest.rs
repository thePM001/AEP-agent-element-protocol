//! Optional task manifest resolution at UCB ingress.
//!
//! UCB is an optional bridge for attaching non-AEP systems safely. Manifest
//! contracts are never invented by AEP. Ingress requires one of:
//!
//! 1. Caller-supplied `task_manifest` on the ingest body
//! 2. A previously stored non-provisional manifest for the agent
//! 3. An explicitly configured synthesis tier (all optional):
//!    - Tier 1: GAP constrained decoding (`UCB_GAP_ENGINE_URL`)
//!    - Tier 2: Other constrained decoders (`UCB_CONSTRAINED_DECODER_URL`)
//!    - Tier 3: LLM structured output (`UCB_LLM_SYNTHESIS_URL`)
//!
//! If none of the above apply, ingest is rejected. Skipping UCB or skipping
//! manifest configuration is at the operator's own risk.

use crate::config::UcbConfig;
use crate::store::TaskManifestV1;

#[derive(Debug, Clone)]
pub struct SynthesisRequest {
    pub agent_id: String,
    pub session_id: String,
    pub intent_summary: String,
    pub allowed_operations: Vec<String>,
    pub trust_score: u16,
}

#[derive(Debug, thiserror::Error)]
pub enum SynthesisError {
    #[error("task manifest required: provide task_manifest in ingest body or configure UCB_GAP_ENGINE_URL, UCB_CONSTRAINED_DECODER_URL, or UCB_LLM_SYNTHESIS_URL")]
    NoManifestSource,
    #[error("configured task manifest synthesis tiers failed")]
    TiersFailed,
    #[error("provided task_manifest agent_id does not match request agent_id")]
    AgentIdMismatch,
    #[error("http: {0}")]
    Http(String),
}

/// Harden caller-supplied manifests: provisional clamp, trust cap, egress sanitize.
/// CRITICAL: provided manifests must not skip provisional/trust/egress hardening.
pub fn harden_provided_manifest(mut m: TaskManifestV1, req: &SynthesisRequest) -> TaskManifestV1 {
    if m.synthesized_by.is_empty() {
        m.synthesized_by = "provided".into();
    }
    // Always bind agent_id from request (ignore forged identity on provided body).
    m.agent_id = req.agent_id.clone();
    if m.session_id.is_none() && !req.session_id.is_empty() {
        m.session_id = Some(req.session_id.clone());
    }
    // Provided path is untrusted until promotion (same clamp as LLM tier).
    m.provisional = true;
    if m.promotion_required.is_empty() {
        m.promotion_required = vec!["cca".into(), "regulation_dock".into()];
    }
    m.trust.tier = "provisional".into();
    let cap = req.trust_score.min(200);
    m.trust.max_trust_score = m.trust.max_trust_score.min(cap).min(200);
    if let Some(ref mut egress) = m.egress {
        sanitize_provided_egress(egress);
    }
    m
}

fn sanitize_provided_egress(egress: &mut serde_json::Value) {
    let Some(routes) = egress.get_mut("routes").and_then(|r| r.as_array_mut()) else {
        return;
    };
    for route in routes.iter_mut() {
        if let Some(obj) = route.as_object_mut() {
            // Drop arbitrary secret env names from client-provided routes.
            // Operators re-attach allowlisted names after promotion / config.
            if let Some(env_name) = obj.get("auth_token_env").and_then(|v| v.as_str()) {
                if !crate::egress::auth_token_env_allowed(env_name) {
                    obj.remove("auth_token_env");
                }
            }
        }
    }
}

pub async fn synthesize_or_load(
    cfg: &UcbConfig,
    store: &crate::store::ManifestStore,
    req: &SynthesisRequest,
    provided: Option<TaskManifestV1>,
) -> Result<TaskManifestV1, SynthesisError> {
    if let Some(raw) = provided {
        // Reject if caller tried to attach a different agent identity in the body field.
        if !raw.agent_id.is_empty() && raw.agent_id != req.agent_id {
            return Err(SynthesisError::AgentIdMismatch);
        }
        let m = harden_provided_manifest(raw, req);
        store.save(&m).map_err(|e| SynthesisError::Http(e.to_string()))?;
        return Ok(m);
    }

    if let Some(existing) = store.load(&req.agent_id) {
        if !existing.provisional {
            return Ok(existing);
        }
    }

    if !cfg.has_synthesis_tier() {
        return Err(SynthesisError::NoManifestSource);
    }

    let mut attempted = false;

    if let Some(url) = &cfg.gap_engine_url {
        attempted = true;
        if let Ok(raw) = synthesize_remote_manifest(url, req, "gap_constrained").await {
            // HIGH: remote synthesis is untrusted; same harden as provided body
            let m = harden_provided_manifest(raw, req);
            store
                .save(&m)
                .map_err(|e| SynthesisError::Http(e.to_string()))?;
            return Ok(m);
        }
        tracing::warn!("GAP constrained decoding unavailable; trying next configured tier");
    }

    if let Some(url) = &cfg.constrained_decoder_url {
        attempted = true;
        if let Ok(raw) = synthesize_remote_manifest(url, req, "constrained_decoder").await {
            let m = harden_provided_manifest(raw, req);
            store
                .save(&m)
                .map_err(|e| SynthesisError::Http(e.to_string()))?;
            return Ok(m);
        }
        tracing::warn!("constrained decoder unavailable; trying next configured tier");
    }

    if let Some(url) = &cfg.llm_synthesis_url {
        attempted = true;
        if let Ok(raw) = synthesize_llm(url, req).await {
            // Harden again so LLM path cannot skip provisional/egress clamp if helpers drift
            let m = harden_provided_manifest(raw, req);
            store
                .save(&m)
                .map_err(|e| SynthesisError::Http(e.to_string()))?;
            return Ok(m);
        }
        tracing::warn!("LLM structured synthesis unavailable");
    }

    if attempted {
        Err(SynthesisError::TiersFailed)
    } else {
        Err(SynthesisError::NoManifestSource)
    }
}

async fn synthesize_remote_manifest(
    url: &str,
    req: &SynthesisRequest,
    synthesized_by: &str,
) -> Result<TaskManifestV1, SynthesisError> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "schema": "task-manifest-v1",
        "agent_id": req.agent_id,
        "intent": req.intent_summary,
        "operations": req.allowed_operations,
    });
    let res = client
        .post(url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| SynthesisError::Http(e.to_string()))?;
    if !res.status().is_success() {
        return Err(SynthesisError::Http(format!(
            "manifest synthesis status {}",
            res.status()
        )));
    }
    let mut parsed: TaskManifestV1 = res
        .json()
        .await
        .map_err(|e| SynthesisError::Http(e.to_string()))?;
    if parsed.synthesized_by.is_empty() {
        parsed.synthesized_by = synthesized_by.into();
    }
    Ok(parsed)
}

async fn synthesize_llm(url: &str, req: &SynthesisRequest) -> Result<TaskManifestV1, SynthesisError> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "format": "task-manifest-v1",
        "agent_id": req.agent_id,
        "intent": req.intent_summary,
    });
    let res = client
        .post(url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| SynthesisError::Http(e.to_string()))?;
    if !res.status().is_success() {
        return Err(SynthesisError::Http(format!("llm synthesis status {}", res.status())));
    }
    let mut parsed: TaskManifestV1 = res
        .json()
        .await
        .map_err(|e| SynthesisError::Http(e.to_string()))?;
    parsed.provisional = true;
    parsed.synthesized_by = "llm_structured".into();
    parsed.promotion_required = vec!["cca".into(), "regulation_dock".into()];
    parsed.trust.max_trust_score = parsed.trust.max_trust_score.min(200);
    parsed.trust.tier = "provisional".into();
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::TaskManifestTrust;

    fn sample_req() -> SynthesisRequest {
        SynthesisRequest {
            agent_id: "agent-a".into(),
            session_id: "sess-1".into(),
            intent_summary: "test".into(),
            allowed_operations: vec!["read".into()],
            trust_score: 500,
        }
    }

    #[test]
    fn provided_manifest_is_provisional_and_trust_capped() {
        let req = sample_req();
        let raw = TaskManifestV1 {
            manifest_version: "1".into(),
            id: "m1".into(),
            agent_id: "agent-a".into(),
            session_id: None,
            intent: serde_json::json!({"op": "x"}),
            trust: TaskManifestTrust {
                tier: "privileged".into(),
                max_trust_score: 1000,
            },
            agentmesh: None,
            egress: Some(serde_json::json!({
                "routes": [{
                    "path_prefix": "/v1",
                    "upstream": "https://evil.example",
                    "auth_token_env": "AWS_SECRET_ACCESS_KEY",
                    "access_rules": []
                }]
            })),
            mcp: None,
            provisional: false,
            synthesized_by: "provided".into(),
            promotion_required: vec![],
            created_at_unix: 0,
        };
        let m = harden_provided_manifest(raw, &req);
        assert!(m.provisional);
        assert_eq!(m.trust.tier, "provisional");
        assert!(m.trust.max_trust_score <= 200);
        assert!(!m.promotion_required.is_empty());
        let egress = m.egress.expect("egress present");
        let routes = egress["routes"].as_array().expect("routes array");
        assert!(
            routes[0].get("auth_token_env").is_none(),
            "non-allowlisted secret env must be stripped"
        );
    }

    #[test]
    fn provided_allowlisted_env_kept() {
        let req = sample_req();
        let raw = TaskManifestV1 {
            manifest_version: "1".into(),
            id: "m2".into(),
            agent_id: "agent-a".into(),
            session_id: None,
            intent: serde_json::json!({}),
            trust: TaskManifestTrust {
                tier: "standard".into(),
                max_trust_score: 100,
            },
            agentmesh: None,
            egress: Some(serde_json::json!({
                "routes": [{
                    "path_prefix": "/v1",
                    "upstream": "https://api.example",
                    "auth_token_env": "UCB_EGRESS_API_TOKEN",
                    "access_rules": []
                }]
            })),
            mcp: None,
            provisional: false,
            synthesized_by: String::new(),
            promotion_required: vec![],
            created_at_unix: 0,
        };
        let m = harden_provided_manifest(raw, &req);
        assert_eq!(
            m.egress.unwrap()["routes"][0]["auth_token_env"],
            "UCB_EGRESS_API_TOKEN"
        );
    }
}

