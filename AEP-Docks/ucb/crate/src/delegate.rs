//! Lattice-gated LLM delegation (inference_engine dock audit + outbound HTTP).

use crate::bridge::{ingest_foreign_payload, UcbRuntime};
use crate::inference::{resolve_api_key, resolve_inference_config, InferenceConfig};
use crate::ingress::ForeignIngestBody;
use crate::translator::{normalize_protocol, LatticeEvent};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;

#[derive(Debug, Default, Deserialize)]
pub struct DelegateBody {
    pub protocol: Option<String>,
    pub session_id: Option<String>,
    pub agent_id: Option<String>,
    pub prompt: Option<String>,
    pub message: Option<String>,
    pub schema: Option<Value>,
    pub response_schema: Option<Value>,
    #[serde(default)]
    pub ingest_result: bool,
    pub capability_scope: Option<String>,
    pub scope: Option<String>,
}

pub async fn delegate_to_foreign_model(rt: &Arc<UcbRuntime>, body: DelegateBody) -> Value {
    let protocol = normalize_protocol(body.protocol.as_deref());
    let session_id = body
        .session_id
        .clone()
        .unwrap_or_else(|| format!("ucb-delegate-{}", now_ms()));
    let agent_id = body
        .agent_id
        .clone()
        .unwrap_or_else(|| "ucb-delegate".into());
    let prompt = body
        .prompt
        .or(body.message)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let Some(prompt) = prompt else {
        return json!({ "ok": false, "error": "prompt or message required for delegation" });
    };

    let inference = match resolve_inference_config(&rt.config.data_dir) {
        Ok(c) => c,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let api_key = resolve_api_key(&inference, &rt.config.data_dir);
    let schema = body.schema.or(body.response_schema);
    let capability_scope = body
        .capability_scope
        .or(body.scope)
        .unwrap_or_else(|| "read-only-delegation".into());

    if let Err(e) = lattice_gate_delegate(rt, &inference, &protocol, &agent_id, &session_id, &prompt, &capability_scope).await {
        return json!({
            "ok": false,
            "error": e,
            "inference": inference_json(&inference),
        });
    }

    let model_output = match call_openai_compatible(&inference, api_key.as_deref(), &prompt, schema.as_ref()).await {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "error": e,
                "inference": inference_json(&inference),
            });
        }
    };

    let mut ingest_value = Value::Null;
    if body.ingest_result {
        let ingest_body = ForeignIngestBody {
            protocol: Some(protocol.clone()),
            session_id: Some(session_id.clone()),
            agent_id: Some(agent_id.clone()),
            provenance: Some(crate::ingress::Provenance {
                source: protocol.clone(),
                protocol: "ucb/1.0".into(),
                session_id: session_id.clone(),
            }),
            payload: if model_output.is_object() {
                model_output.clone()
            } else {
                json!({ "content": model_output })
            },
            ..Default::default()
        };
        ingest_value = ingest_foreign_payload(rt, ingest_body).await;
        if ingest_value.get("ok") != Some(&json!(true)) {
            return json!({
                "ok": false,
                "status": "delegate_ingest_failed",
                "session_id": session_id,
                "protocol": protocol,
                "inference": inference_json(&inference),
                "result": model_output,
                "ingest": ingest_value,
                "error": ingest_value.get("error").cloned().unwrap_or(json!("delegate result ingest rejected")),
            });
        }
    }

    json!({
        "ok": true,
        "status": "delegated",
        "session_id": session_id,
        "protocol": protocol,
        "capability_scope": capability_scope,
        "inference": inference_json(&inference),
        "result": model_output,
        "ingest": if body.ingest_result { ingest_value } else { Value::Null },
    })
}

async fn lattice_gate_delegate(
    rt: &Arc<UcbRuntime>,
    inference: &InferenceConfig,
    protocol: &str,
    agent_id: &str,
    session_id: &str,
    prompt: &str,
    capability_scope: &str,
) -> Result<(), String> {
    let event = LatticeEvent {
        agent_id: agent_id.to_string(),
        channel_id: format!("ch-ucb-delegate-{protocol}"),
        contract_id: "lattice-channel-default".into(),
        event_type: "UCB_DELEGATE".into(),
        session_id: session_id.to_string(),
        docking_port: "inference_engine".into(),
        trust_score: 720,
        payload: json!({
            "gateway": inference.provider,
            "model": inference.model,
            "protocol": protocol,
            "capability_scope": capability_scope,
            "prompt_preview": prompt.chars().take(120).collect::<String>(),
        }),
    };
    let built = rt.lattice.build_frame(&event)?;
    let socket = rt.lattice.dock_path("inference_engine")?;
    rt.lattice
        .send_frame(
            &socket,
            built.frame,
            event.trust_score,
            built.signer_public_hex.as_deref(),
        )
        .await?;
    Ok(())
}

async fn call_openai_compatible(
    inference: &InferenceConfig,
    api_key: Option<&str>,
    prompt: &str,
    schema: Option<&Value>,
) -> Result<Value, String> {
    let url = format!(
        "{}/chat/completions",
        inference.base_url.trim_end_matches('/')
    );
    let mut body = json!({
        "model": inference.model,
        "messages": [{ "role": "user", "content": prompt }],
    });
    if let Some(s) = schema {
        body["response_format"] = json!({
            "type": "json_schema",
            "json_schema": {
                "name": "ucb_delegate_response",
                "strict": true,
                "schema": s,
            }
        });
    }
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json");
    if let Some(key) = api_key {
        req = req.header("Authorization", format!("Bearer {key}"));
    }
    let res = req
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "delegate LLM HTTP {status}: {}",
            text.chars().take(400).collect::<String>()
        ));
    }
    let data: Value = res.json().await.map_err(|e| e.to_string())?;
    let content = data
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if schema.is_some() {
        let parsed: Value =
            serde_json::from_str(content).map_err(|_| {
                "delegate LLM returned non-JSON content for schema request".to_string()
            })?;
        return Ok(parsed);
    }
    Ok(json!({ "content": content, "raw": data }))
}

fn inference_json(inference: &InferenceConfig) -> Value {
    json!({
        "provider": inference.provider,
        "model": inference.model,
        "base_url": inference.base_url,
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}