// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Foreign payload translation. Fixture labels are not protocol members.

use crate::ingress::{binding_fingerprint, normalize_dock_port};
use crate::DOCK_WIRE_SCORE;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeEvent {
    pub agent_id: String,
    pub channel_id: String,
    pub contract_id: String,
    pub event_type: String,
    pub session_id: String,
    pub docking_port: String,
    #[serde(rename = "trust_score")]
    pub dock_wire_score: u16,
    pub payload: Value,
}

pub fn fixture_label(value: Option<&str>) -> String {
    let raw = value.unwrap_or("fixture").trim().to_lowercase();
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
    if cleaned.is_empty() {
        String::from("fixture")
    } else {
        cleaned
    }
}

pub fn normalize_protocol(value: Option<&str>) -> String {
    fixture_label(value)
}

pub fn translate_foreign_ingest(body: &crate::ingress::ForeignIngestBody) -> Result<LatticeEvent, String> {
    let fixture = fixture_label(
        body.protocol.as_deref().or(body.provenance.as_ref().map(|p| p.source.as_str())),
    );
    let session_id = body
        .session_id
        .clone()
        .or_else(|| body.provenance.as_ref().map(|p| p.session_id.clone()))
        .unwrap_or_else(|| format!("ucb-{fixture}-{}", now_ms()));
    let agent_id = body
        .agent_id
        .clone()
        .unwrap_or_else(|| format!("ucb-foreign-{fixture}"));
    let dock = normalize_dock_port(body.docking_port.as_deref())?;
    let raw_payload = effective_payload(body);
    let mut translated = serde_json::Map::new();
    translated.insert(String::from("foreign_fixture"), Value::String(fixture.clone()));
    translated.insert(String::from("foreign_event_type"), Value::String(String::from("UCB_FOREIGN_INGEST")));
    translated.insert(String::from("binding_fingerprint"), Value::from(binding_fingerprint(&raw_payload)));
    translated.insert(String::from("raw"), raw_payload.clone());
    let mut provenance = serde_json::Map::new();
    provenance.insert(String::from("source"), Value::String(body.provenance.as_ref().map(|p| p.source.clone()).unwrap_or(fixture.clone())));
    provenance.insert(String::from("protocol"), Value::String(body.provenance.as_ref().map(|p| p.protocol.clone()).unwrap_or_else(|| String::from("ucb/1.0"))));
    provenance.insert(String::from("session_id"), Value::String(session_id.clone()));
    provenance.insert(String::from("timestamp_ms"), Value::from(now_ms()));
    provenance.insert(String::from("bridge"), Value::String(String::from(crate::BRIDGE_ID)));
    translated.insert(String::from("provenance"), Value::Object(provenance));
    if let Some(f) = fact_from_structured(&raw_payload) {
        let mut fact = serde_json::Map::new();
        fact.insert(String::from("subject"), Value::String(f.0));
        fact.insert(String::from("predicate"), Value::String(f.1));
        fact.insert(String::from("object"), Value::String(f.2));
        translated.insert(String::from("structured_fact"), Value::Object(fact));
    }
    Ok(LatticeEvent {
        agent_id,
        channel_id: format!("ch-ucb-{fixture}"),
        contract_id: "dynaep-action-lattice".into(),
        event_type: "UCB_INGEST".into(),
        session_id,
        docking_port: dock,
        dock_wire_score: DOCK_WIRE_SCORE,
        payload: Value::Object(translated),
    })
}

fn fact_from_structured(payload: &Value) -> Option<(String, String, String)> {
    let obj = payload.as_object()?;
    let subject = obj.get("subject").or_else(|| obj.get("s")).and_then(|v| v.as_str())?;
    let predicate = obj.get("predicate").or_else(|| obj.get("p")).and_then(|v| v.as_str())?;
    let object = obj.get("object").or_else(|| obj.get("o")).and_then(|v| v.as_str())?;
    Some((subject.to_string(), predicate.to_string(), object.to_string()))
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
    Value::Object(serde_json::Map::new())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
