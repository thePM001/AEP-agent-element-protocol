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
    #[error("http: {0}")]
    Http(String),
}

pub async fn synthesize_or_load(
    cfg: &UcbConfig,
    store: &crate::store::ManifestStore,
    req: &SynthesisRequest,
    provided: Option<TaskManifestV1>,
) -> Result<TaskManifestV1, SynthesisError> {
    if let Some(mut m) = provided {
        if m.synthesized_by.is_empty() {
            m.synthesized_by = "provided".into();
        }
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
        if let Ok(m) = synthesize_remote_manifest(url, req, "gap_constrained").await {
            store
                .save(&m)
                .map_err(|e| SynthesisError::Http(e.to_string()))?;
            return Ok(m);
        }
        tracing::warn!("GAP constrained decoding unavailable; trying next configured tier");
    }

    if let Some(url) = &cfg.constrained_decoder_url {
        attempted = true;
        if let Ok(m) = synthesize_remote_manifest(url, req, "constrained_decoder").await {
            store
                .save(&m)
                .map_err(|e| SynthesisError::Http(e.to_string()))?;
            return Ok(m);
        }
        tracing::warn!("constrained decoder unavailable; trying next configured tier");
    }

    if let Some(url) = &cfg.llm_synthesis_url {
        attempted = true;
        if let Ok(m) = synthesize_llm(url, req).await {
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

