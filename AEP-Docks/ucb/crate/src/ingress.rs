//! Foreign ingest validation (P_P, P_S, P_C, P_R predicates).

use serde::{Deserialize, Serialize};


const FORBIDDEN: &[&str] = &[
    "ignore all previous",
    "system prompt override",
    "DROP TABLE",
    "rm -rf",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source: String,
    pub protocol: String,
    pub session_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ForeignIngestBody {
    pub provenance: Option<Provenance>,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub docking_port: Option<String>,
    #[serde(default)]
    pub trust_score: Option<i64>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub task_manifest: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn validate_foreign_ingest(body: &ForeignIngestBody) -> ValidationResult {
    validate_foreign_ingest_with_context(body, &[])
}

pub fn validate_foreign_ingest_with_context(
    body: &ForeignIngestBody,
    prior_fingerprints: &[u32],
) -> ValidationResult {
    let checks = [
        validate_provenance(body.provenance.as_ref()),
        validate_structural(body),
        validate_non_contradiction(body),
        validate_resonance(body, prior_fingerprints),
    ];
    for c in checks {
        if !c.ok {
            return c;
        }
    }
    ValidationResult {
        ok: true,
        predicate: None,
        error: None,
    }
}

fn validate_resonance(body: &ForeignIngestBody, prior_fingerprints: &[u32]) -> ValidationResult {
    let payload = effective_payload(body);
    let fingerprint = binding_fingerprint(&payload);
    if prior_fingerprints.is_empty() {
        return ok();
    }
    let matches = prior_fingerprints
        .iter()
        .filter(|p| **p == fingerprint)
        .count();
    let resonance = 1.0 - (matches as f64 / prior_fingerprints.len() as f64);
    if resonance < 0.05 {
        return fail(
            "P_R",
            "resonance below threshold (duplicate foreign payload)",
        );
    }
    ok()
}

fn validate_provenance(p: Option<&Provenance>) -> ValidationResult {
    let Some(p) = p else {
        return fail("P_P", "provenance object required");
    };
    if p.source.is_empty() || p.protocol.is_empty() || p.session_id.is_empty() {
        return fail("P_P", "provenance requires source, protocol, session_id");
    }
    ok()
}

fn validate_structural(body: &ForeignIngestBody) -> ValidationResult {
    let payload = effective_payload(body);
    if payload.as_object().map(|o| o.is_empty()).unwrap_or(true) && !payload.is_array() {
        return fail("P_S", "payload must contain at least one field");
    }
    ok()
}

fn validate_non_contradiction(body: &ForeignIngestBody) -> ValidationResult {
    let text = effective_payload(body).to_string().to_lowercase();
    for pat in FORBIDDEN {
        if text.contains(pat) {
            return fail("P_C", "forbidden destructive pattern detected");
        }
    }
    ok()
}

/// Deterministic VSA-style binding fingerprint (matches `translator.mjs` / Paper 005 P_R).
pub fn binding_fingerprint(payload: &serde_json::Value) -> u32 {
    if let Some(obj) = payload.as_object() {
        let subject = obj.get("subject").or_else(|| obj.get("s")).and_then(|v| v.as_str());
        let predicate = obj.get("predicate").or_else(|| obj.get("p")).and_then(|v| v.as_str());
        let object = obj.get("object").or_else(|| obj.get("o")).and_then(|v| v.as_str());
        if let (Some(s), Some(p), Some(o)) = (subject, predicate, object) {
            return hypervector_seed(&format!("{s}|{p}|{o}"));
        }
        let mut keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        keys.sort_unstable();
        let joined = keys
            .iter()
            .map(|k| format!("{k}:{}", serde_json::to_string(&obj[*k]).unwrap_or_default()))
            .collect::<Vec<_>>()
            .join(";");
        return hypervector_seed(&joined);
    }
    hypervector_seed(&payload.to_string())
}

pub fn hypervector_seed(text: &str) -> u32 {
    let mut hash: u32 = 0;
    for ch in text.chars() {
        hash = hash.wrapping_mul(31).wrapping_add(ch as u32);
    }
    hash
}

pub fn normalize_dock_port(port: Option<&str>) -> Result<String, String> {
    const ALLOWED: &[&str] = &[
        "inference_engine",
        "validation_engine",
        "regulation_module",
        "future_features",
    ];
    let p = port.unwrap_or("validation_engine").trim();
    if p.contains("..") || p.contains('/') {
        return Err(format!("invalid docking_port: {p}"));
    }
    if !ALLOWED.contains(&p) {
        return Err(format!(
            "invalid docking_port: {p}; allowed: {}",
            ALLOWED.join(", ")
        ));
    }
    Ok(p.into())
}

pub fn clamp_trust(score: Option<i64>) -> u16 {
    let s = score.unwrap_or(500);
    s.clamp(0, 1000) as u16
}

fn effective_payload(body: &ForeignIngestBody) -> serde_json::Value {
    if !body.payload.is_null() {
        return body.payload.clone();
    }
    if let Some(c) = &body.content {
        return c.clone();
    }
    if let Some(d) = &body.data {
        return d.clone();
    }
    serde_json::json!({})
}

fn ok() -> ValidationResult {
    ValidationResult {
        ok: true,
        predicate: None,
        error: None,
    }
}

fn fail(predicate: &'static str, error: &str) -> ValidationResult {
    ValidationResult {
        ok: false,
        predicate: Some(predicate),
        error: Some(error.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn binding_fingerprint_matches_mjs_structured_fact() {
        let fp = binding_fingerprint(&json!({
            "subject": "UCB",
            "predicate": "bridges",
            "object": "AEP"
        }));
        // Golden value from translator.mjs hypervectorSeed('UCB|bridges|AEP')
        assert_eq!(fp, 1_384_834_866);
        assert_eq!(fp, hypervector_seed("UCB|bridges|AEP"));
    }
}