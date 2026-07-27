//! Foreign payload -> DynAep lattice event translation (phi).

use crate::ingress::{binding_fingerprint, clamp_trust, normalize_dock_port};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const SUPPORTED: &[&str] = &[
    "langgraph",
    "langchain",
    "autogen",
    "crewai",
    "mcp",
    "cursor",
    "claude-code",
    "codex",
    "custom",
    "http",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeEvent {
    pub agent_id: String,
    pub channel_id: String,
    pub contract_id: String,
    pub event_type: String,
    pub session_id: String,
    pub docking_port: String,
    pub trust_score: u16,
    pub payload: Value,
}

pub fn normalize_protocol(value: Option<&str>) -> String {
    let raw = value.unwrap_or("custom").trim().to_lowercase();
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if SUPPORTED.contains(&cleaned.as_str()) {
        cleaned
    } else {
        "custom".into()
    }
}

pub fn translate_foreign_ingest(body: &crate::ingress::ForeignIngestBody) -> Result<LatticeEvent, String> {
    let protocol = normalize_protocol(
        body
            .protocol
            .as_deref()
            .or(body.provenance.as_ref().map(|p| p.source.as_str())),
    );
    let session_id = body
        .session_id
        .clone()
        .or_else(|| body.provenance.as_ref().map(|p| p.session_id.clone()))
        .unwrap_or_else(|| format!("ucb-{protocol}-{}", now_ms()));
    let agent_id = body
        .agent_id
        .clone()
        .unwrap_or_else(|| format!("ucb-foreign-{protocol}"));
    let dock = normalize_dock_port(body.docking_port.as_deref())?;
    let trust_score = clamp_trust(body.trust_score);
    let raw_payload = effective_payload(body);
    let fact = fact_from_structured(&raw_payload);
    let mut translated = json!({
        "foreign_protocol": protocol,
        "foreign_event_type": "UCB_FOREIGN_INGEST",
        "binding_fingerprint": binding_fingerprint(&raw_payload),
        "raw": raw_payload,
        "provenance": {
            "source": body.provenance.as_ref().map(|p| p.source.clone()).unwrap_or(protocol.clone()),
            "protocol": body.provenance.as_ref().map(|p| p.protocol.clone()).unwrap_or_else(|| "ucb/1.0".into()),
            "session_id": session_id,
            "timestamp_ms": now_ms(),
            "bridge": crate::BRIDGE_ID,
        }
    });
    if let Some(f) = fact {
        translated["structured_fact"] = json!(f);
    }

    Ok(LatticeEvent {
        agent_id,
        channel_id: format!("ch-ucb-{protocol}"),
        contract_id: "dynaep-action-lattice".into(),
        event_type: "UCB_INGEST".into(),
        session_id,
        docking_port: dock,
        trust_score,
        payload: translated,
    })
}

fn fact_from_structured(payload: &Value) -> Option<StructuredFact> {
    let obj = payload.as_object()?;
    let subject = obj
        .get("subject")
        .or_else(|| obj.get("s"))
        .and_then(|v| v.as_str())?;
    let predicate = obj
        .get("predicate")
        .or_else(|| obj.get("p"))
        .and_then(|v| v.as_str())?;
    let object = obj
        .get("object")
        .or_else(|| obj.get("o"))
        .and_then(|v| v.as_str())?;
    Some(StructuredFact {
        subject: subject.to_string(),
        predicate: predicate.to_string(),
        object: object.to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
struct StructuredFact {
    subject: String,
    predicate: String,
    object: String,
}

fn effective_payload(body: &crate::ingress::ForeignIngestBody) -> Value {
    if !body.payload.is_null() {
        return body.payload.clone();
    }
    if let Some(c) = &body.content {
        return c.clone();
    }
    if let Some(d) = &body.data {
        return d.clone();
    }
    json!({})
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}