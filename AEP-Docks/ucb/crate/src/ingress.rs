// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Foreign ingest validation through perimeter-v1 scanner-backed predicates.

use aep_ucb_perimeter_v1::{
    parse_profile, validate_ingest, DefaultScannerPack, IngestView, PredicateProfile, Provenance as PerimeterProvenance,
    ScannerId,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source: String,
    pub protocol: String,
    pub session_id: String,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
}

impl Provenance {
    pub fn bound(source: &str, protocol: &str, session_id: &str) -> Self {
        let p = PerimeterProvenance::bound(source, protocol, session_id);
        Self {
            source: p.source,
            protocol: p.protocol,
            session_id: p.session_id,
            digest: p.digest,
            signature: p.signature,
        }
    }
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
    pub agent_id: Option<String>,
    #[serde(default)]
    pub task_manifest: Option<serde_json::Value>,
    #[serde(default)]
    pub trust_score: Option<serde_json::Value>,
    #[serde(default)]
    pub trust: Option<serde_json::Value>,
    #[serde(default)]
    pub trust_tier: Option<serde_json::Value>,
    #[serde(default)]
    pub trust_ring: Option<serde_json::Value>,
}

impl ForeignIngestBody {
    pub fn has_trust_fields(&self) -> bool {
        self.trust_score.is_some()
            || self.trust.is_some()
            || self.trust_tier.is_some()
            || self.trust_ring.is_some()
            || self
                .task_manifest
                .as_ref()
                .map(crate::store::value_has_trust_fields)
                .unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub predicate: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scanner_id: Option<ScannerId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn validate_foreign_ingest(body: &ForeignIngestBody) -> ValidationResult {
    validate_foreign_ingest_with_context(body, &[])
}

pub fn validate_foreign_ingest_with_profile(
    body: &ForeignIngestBody,
    prior_fingerprints: &[u32],
    profile: PredicateProfile,
) -> ValidationResult {
    let payload = effective_payload(body);
    let mapped = body.provenance.as_ref().map(|p| PerimeterProvenance {
        source: p.source.clone(),
        protocol: p.protocol.clone(),
        session_id: p.session_id.clone(),
        digest: p.digest.clone(),
        signature: p.signature.clone(),
    });
    let view = IngestView {
        provenance: mapped.as_ref(),
        payload: &payload,
        content_type: Some("application/json"),
        body_len: payload.to_string().len(),
        prior_fingerprints,
    };
    let v = validate_ingest(profile, &view, &DefaultScannerPack);
    ValidationResult {
        ok: v.ok,
        predicate: v.predicate,
        scanner_id: v.scanner_id,
        error: v.error,
    }
}

pub fn validate_foreign_ingest_with_context(
    body: &ForeignIngestBody,
    prior_fingerprints: &[u32],
) -> ValidationResult {
    let raw = std::env::var("UCB_PREDICATE_PROFILE").ok();
    let profile = match parse_profile(raw.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            return ValidationResult {
                ok: false,
                predicate: Some("profile"),
                scanner_id: None,
                error: Some(e.to_string()),
            }
        }
    };
    validate_foreign_ingest_with_profile(body, prior_fingerprints, profile)
}

pub fn binding_fingerprint(payload: &serde_json::Value) -> u32 {
    aep_ucb_perimeter_v1::predicates::binding_fingerprint(payload)
}

pub fn normalize_dock_port(port: Option<&str>) -> Result<String, String> {
    const ALLOWED: &[&str] = &[
        "inference_engine",
        "validation_engine",
        "regulation_module",
        "future_features",
    ];
    let p = port.unwrap_or("validation_engine").trim();
    if p.contains("..") || p.contains("/") {
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

pub fn effective_payload(body: &ForeignIngestBody) -> serde_json::Value {
    if !body.payload.is_null() {
        return body.payload.clone();
    }
    if let Some(c) = &body.content {
        return c.clone();
    }
    if let Some(d) = &body.data {
        return d.clone();
    }
    serde_json::Value::Object(serde_json::Map::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_payload_returns_pc_scanner() {
        let body = ForeignIngestBody {
            provenance: Some(Provenance::bound("langgraph", "1.0", "sess-1")),
            payload: serde_json::json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"}),
            ..Default::default()
        };
        let r = validate_foreign_ingest_with_profile(&body, &[], PredicateProfile::PerimeterV1);
        assert!(!r.ok);
        assert_eq!(r.predicate, Some("P_C"));
        assert_eq!(r.scanner_id, Some(ScannerId::Secrets));
    }

    #[test]
    fn missing_digest_is_pp() {
        let body = ForeignIngestBody {
            provenance: Some(Provenance {
                source: "t".into(),
                protocol: "x".into(),
                session_id: "s".into(),
                digest: None,
                signature: None,
            }),
            payload: serde_json::json!({"subject": "a", "predicate": "b", "object": "c"}),
            ..Default::default()
        };
        let r = validate_foreign_ingest_with_profile(&body, &[], PredicateProfile::PerimeterV1);
        assert!(!r.ok);
        assert_eq!(r.predicate, Some("P_P"));
    }

    #[test]
    fn paper005_named_stays_off() {
        let body = ForeignIngestBody {
            provenance: Some(Provenance::bound("langgraph", "1.0", "sess-1")),
            payload: serde_json::json!({"subject": "x", "predicate": "y", "object": "z"}),
            ..Default::default()
        };
        let r = validate_foreign_ingest_with_profile(&body, &[], PredicateProfile::Paper005Vsa);
        assert!(!r.ok);
        assert_eq!(r.predicate, Some("profile"));
    }

    #[test]
    fn trust_fields_on_body_are_detected() {
        let body = ForeignIngestBody {
            trust_score: Some(serde_json::Value::from(9u64)),
            ..Default::default()
        };
        assert!(body.has_trust_fields());
        let clean = ForeignIngestBody::default();
        assert!(!clean.has_trust_fields());
    }
}
