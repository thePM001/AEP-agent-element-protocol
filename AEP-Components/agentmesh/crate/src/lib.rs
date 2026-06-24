//! AgentMesh provides zero-trust identity for Lattice Channel transport in AEP 2.8.

pub mod tls;

use serde::{Deserialize, Serialize};


pub const TRUST_DOMAIN: &str = "aep.protocol.local";
pub const DID_METHOD: &str = "aep";
const MTLS_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpiffeIdentity {
    pub spiffe_id: String,
    pub svid: String,
    pub expires_at_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DidDocument {
    pub id: String,
    pub verification_key_hex: String,
    pub capabilities: Vec<String>,
    pub service_endpoints: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MtlsCertState {
    pub agent_id: String,
    pub trust_tier: u8,
    pub cert_fingerprint: String,
    pub issued_at_unix: u64,
    pub not_after_unix: u64,
    pub cert_pem: String,
    pub subject: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMeshBundle {
    pub agent_id: String,
    pub trust_score: u16,
    pub spiffe: SpiffeIdentity,
    pub did: DidDocument,
    pub mtls: MtlsCertState,
}

pub fn trust_tier(score: u16) -> u8 {
    match score {
        800..=1000 => 4,
        600..=799 => 3,
        400..=599 => 2,
        200..=399 => 1,
        _ => 0,
    }
}

pub fn create_spiffe(agent_id: &str, ttl_secs: u64, now_unix: u64) -> SpiffeIdentity {
    let spiffe_id = format!("spiffe://{TRUST_DOMAIN}/agent/{agent_id}");
    let expires = now_unix.saturating_add(ttl_secs);
    SpiffeIdentity {
        svid: format!("{spiffe_id}|{agent_id}|{expires}|ed25519"),
        spiffe_id,
        expires_at_unix: expires,
    }
}

pub fn create_did(agent_id: &str, public_key: &[u8], capabilities: Vec<String>) -> DidDocument {
    DidDocument {
        id: format!("did:{DID_METHOD}:{agent_id}"),
        verification_key_hex: hex::encode(public_key),
        capabilities,
        service_endpoints: vec![],
    }
}

fn issue_workload_cert(agent_id: &str, trust_score: u16, now_unix: u64) -> MtlsCertState {
    let tier = trust_tier(trust_score);
    let identity = tls::issue_workload_identity(agent_id).expect("workload cert generation");
    let cert_pem = identity.cert_pem;
    let fingerprint = identity.cert_fingerprint;

    MtlsCertState {
        agent_id: agent_id.into(),
        trust_tier: tier,
        cert_fingerprint: fingerprint,
        issued_at_unix: now_unix,
        not_after_unix: now_unix.saturating_add(MTLS_TTL_SECS),
        cert_pem,
        subject: format!("CN={agent_id},O=AEP AgentMesh"),
    }
}

pub fn create_mtls(agent_id: &str, trust_score: u16, now_unix: u64) -> MtlsCertState {
    issue_workload_cert(agent_id, trust_score, now_unix)
}

pub fn create_bundle(
    agent_id: &str,
    trust_score: u16,
    public_key: &[u8],
    capabilities: Vec<String>,
    now_unix: u64,
) -> AgentMeshBundle {
    AgentMeshBundle {
        agent_id: agent_id.into(),
        trust_score,
        spiffe: create_spiffe(agent_id, MTLS_TTL_SECS, now_unix),
        did: create_did(agent_id, public_key, capabilities),
        mtls: create_mtls(agent_id, trust_score, now_unix),
    }
}

pub fn rotate_on_trust_change(bundle: &mut AgentMeshBundle, new_score: u16, now_unix: u64) {
    let old_tier = trust_tier(bundle.trust_score);
    bundle.trust_score = new_score.min(1000);
    let new_tier = trust_tier(bundle.trust_score);
    if old_tier != new_tier {
        bundle.mtls = create_mtls(&bundle.agent_id, bundle.trust_score, now_unix);
        bundle.spiffe = create_spiffe(&bundle.agent_id, MTLS_TTL_SECS, now_unix);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_demotion_rotates_mtls() {
        let mut bundle = create_bundle("AG-00001", 850, b"pk", vec!["validate".into()], 1_700_000_000);
        let old_fp = bundle.mtls.cert_fingerprint.clone();
        rotate_on_trust_change(&mut bundle, 500, 1_700_000_100);
        assert_ne!(bundle.mtls.cert_fingerprint, old_fp);
        assert_eq!(bundle.mtls.trust_tier, 2);
    }

    #[test]
    fn mtls_cert_is_real_x509_pem() {
        let mtls = create_mtls("AG-TEST", 700, 1_700_000_000);
        assert!(mtls.cert_pem.starts_with("-----BEGIN CERTIFICATE-----"));
        assert!(mtls.cert_fingerprint.len() == 64);
        assert!(mtls.not_after_unix > mtls.issued_at_unix);
    }
}