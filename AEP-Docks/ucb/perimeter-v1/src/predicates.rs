//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use crate::error::PredicateError;
use crate::profile::PredicateProfile;
use crate::scanner::{ScannerId, ScannerPack};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provenance {
    pub source: String,
    pub protocol: String,
    pub session_id: String,
    pub digest: Option<String>,
    pub signature: Option<String>,
}

impl Provenance {
    pub fn bound(source: &str, protocol: &str, session_id: &str) -> Self {
        let digest = canonical_digest(source, protocol, session_id);
        Self {
            source: source.into(),
            protocol: protocol.into(),
            session_id: session_id.into(),
            digest: Some(digest),
            signature: None,
        }
    }
}

pub struct IngestView<'a> {
    pub provenance: Option<&'a Provenance>,
    pub payload: &'a serde_json::Value,
    pub content_type: Option<&'a str>,
    pub body_len: usize,
    pub prior_fingerprints: &'a [u32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PredicateVerdict {
    pub ok: bool,
    pub predicate: Option<&'static str>,
    pub scanner_id: Option<ScannerId>,
    pub error: Option<String>,
}

pub fn validate_ingest(
    profile: PredicateProfile,
    view: &IngestView<'_>,
    pack: &impl ScannerPack,
) -> PredicateVerdict {
    // Named paper005-vsa stays off without a hypervector binding. It is not a substitute for manifests, signatures and SSRF controls.
    if matches!(profile, PredicateProfile::Paper005Vsa) {
        return fail("profile", None, PredicateError::Paper005Off.to_string());
    }
    match check_pp(view).and_then(|_| check_ps(view)).and_then(|_| check_pc(view, pack)).and_then(|_| check_pr(view)) {
        Ok(()) => PredicateVerdict { ok: true, predicate: None, scanner_id: None, error: None },
        Err((pred, scan, msg)) => fail(pred, scan, msg),
    }
}

fn check_pp(view: &IngestView<'_>) -> Result<(), (&'static str, Option<ScannerId>, String)> {
    let Some(p) = view.provenance else {
        return Err(("P_P", None, PredicateError::Provenance.to_string()));
    };
    if p.source.is_empty() || p.protocol.is_empty() || p.session_id.is_empty() {
        return Err(("P_P", None, PredicateError::Provenance.to_string()));
    }
    let expect = canonical_digest(&p.source, &p.protocol, &p.session_id);
    if p.digest.as_deref() != Some(expect.as_str()) {
        return Err(("P_P", None, PredicateError::Provenance.to_string()));
    }
    Ok(())
}

fn check_ps(view: &IngestView<'_>) -> Result<(), (&'static str, Option<ScannerId>, String)> {
    let ct = view.content_type.unwrap_or("");
    if ct != "application/json" && ct != "application/json; charset=utf-8" {
        return Err(("P_S", None, PredicateError::Structural.to_string()));
    }
    if view.payload.as_object().map(|o| o.is_empty()).unwrap_or(true) && !view.payload.is_array() {
        return Err(("P_S", None, PredicateError::Structural.to_string()));
    }
    Ok(())
}

fn check_pc(
    view: &IngestView<'_>,
    pack: &impl ScannerPack,
) -> Result<(), (&'static str, Option<ScannerId>, String)> {
    let text = view.payload.to_string();
    pack.scan(&text).map_err(|f| ("P_C", Some(f.scanner_id), PredicateError::Scanner(f.scanner_id).to_string()))
}

fn check_pr(view: &IngestView<'_>) -> Result<(), (&'static str, Option<ScannerId>, String)> {
    if view.prior_fingerprints.is_empty() {
        return Ok(());
    }
    let fp = binding_fingerprint(view.payload);
    let matches = view.prior_fingerprints.iter().filter(|p| **p == fp).count();
    let ratio = 1.0 - (matches as f64 / view.prior_fingerprints.len() as f64);
    if ratio < 0.05 {
        return Err(("P_R", None, PredicateError::Replay.to_string()));
    }
    Ok(())
}

pub fn binding_fingerprint(payload: &serde_json::Value) -> u32 {
    let mut hash: u32 = 0;
    for ch in payload.to_string().chars() {
        hash = hash.wrapping_mul(31).wrapping_add(ch as u32);
    }
    hash
}

fn canonical_digest(source: &str, protocol: &str, session_id: &str) -> String {
    let mut h = Sha256::new();
    h.update(source.as_bytes());
    h.update(b"|");
    h.update(protocol.as_bytes());
    h.update(b"|");
    h.update(session_id.as_bytes());
    hex::encode(h.finalize())
}

fn fail(pred: &'static str, scan: Option<ScannerId>, msg: String) -> PredicateVerdict {
    PredicateVerdict { ok: false, predicate: Some(pred), scanner_id: scan, error: Some(msg) }
}
