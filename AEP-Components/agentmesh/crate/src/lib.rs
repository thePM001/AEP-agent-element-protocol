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
    /// Workload private key (never serialize into logs/API dumps).
    #[serde(skip_serializing, default, skip_deserializing)]
    pub key_pem: Option<String>,
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

/// Build SPIFFE identity bound to a real X.509 workload cert with SPIFFE URI SAN.
///
/// Fail closed: cert issuance errors are not soft-failed into placeholder SVIDs.
pub fn create_spiffe(
    agent_id: &str,
    ttl_secs: u64,
    now_unix: u64,
) -> Result<SpiffeIdentity, String> {
    let spiffe_id = format!("spiffe://{TRUST_DOMAIN}/agent/{agent_id}");
    let expires = now_unix.saturating_add(ttl_secs);
    let id = issue_agent_identity(agent_id)?;
    Ok(SpiffeIdentity {
        svid: format!("x509-svid:{spiffe_id}:sha256:{}", id.cert_fingerprint),
        spiffe_id,
        expires_at_unix: expires,
    })
}

fn issue_agent_identity(agent_id: &str) -> Result<tls::MtlsIdentity, String> {
    // Prefer mesh CA-signed identity when AEP_DATA is available.
    if let Ok(data) = std::env::var("AEP_DATA") {
        let path = std::path::Path::new(&data);
        if path.is_dir() {
            match tls::ensure_mesh_ca(path) {
                Ok((ca_pem, ca_key)) => {
                    return tls::issue_signed_identity(&ca_pem, &ca_key, agent_id)
                        .map_err(|e| e.to_string());
                }
                Err(e) => {
                    return Err(format!("mesh CA unavailable (fail closed): {e}"));
                }
            }
        }
    }
    tls::issue_workload_identity(agent_id).map_err(|e| e.to_string())
}

/// Honest capability flag: full SPIFFE Workload API attestation is opt-in infra.
/// Local X.509 issuance alone does not claim Workload API enforcement.
pub fn spiffe_cryptographically_enforced() -> bool {
    std::env::var("AEP_AGENTMESH_SPIFFE_WORKLOAD_API")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub fn create_did(agent_id: &str, public_key: &[u8], capabilities: Vec<String>) -> DidDocument {
    DidDocument {
        id: format!("did:{DID_METHOD}:{agent_id}"),
        verification_key_hex: hex::encode(public_key),
        capabilities,
        service_endpoints: vec![],
    }
}

fn mtls_from_identity(
    agent_id: &str,
    trust_score: u16,
    now_unix: u64,
    identity: tls::MtlsIdentity,
) -> MtlsCertState {
    let tier = trust_tier(trust_score);
    MtlsCertState {
        agent_id: agent_id.into(),
        trust_tier: tier,
        cert_fingerprint: identity.cert_fingerprint,
        issued_at_unix: now_unix,
        not_after_unix: now_unix.saturating_add(MTLS_TTL_SECS),
        cert_pem: identity.cert_pem,
        key_pem: Some(identity.key_pem),
        subject: format!("CN={agent_id},O=AEP AgentMesh"),
    }
}

fn issue_workload_cert(agent_id: &str, trust_score: u16, now_unix: u64) -> MtlsCertState {
    let identity = issue_agent_identity(agent_id).expect("workload cert generation");
    mtls_from_identity(agent_id, trust_score, now_unix, identity)
}

pub fn create_mtls(agent_id: &str, trust_score: u16, now_unix: u64) -> MtlsCertState {
    issue_workload_cert(agent_id, trust_score, now_unix)
}

/// Issue one EE identity; bind SPIFFE fingerprint and mTLS state to the same cert/key.
pub fn create_bundle(
    agent_id: &str,
    trust_score: u16,
    public_key: &[u8],
    capabilities: Vec<String>,
    now_unix: u64,
) -> AgentMeshBundle {
    let identity = issue_agent_identity(agent_id).expect("workload identity required (fail closed)");
    let spiffe_id = format!("spiffe://{TRUST_DOMAIN}/agent/{agent_id}");
    let expires = now_unix.saturating_add(MTLS_TTL_SECS);
    let spiffe = SpiffeIdentity {
        svid: format!(
            "x509-svid:{spiffe_id}:sha256:{}",
            identity.cert_fingerprint
        ),
        spiffe_id,
        expires_at_unix: expires,
    };
    let mtls = mtls_from_identity(agent_id, trust_score, now_unix, identity);
    AgentMeshBundle {
        agent_id: agent_id.into(),
        trust_score,
        spiffe,
        did: create_did(agent_id, public_key, capabilities),
        mtls,
    }
}

pub fn rotate_on_trust_change(bundle: &mut AgentMeshBundle, new_score: u16, now_unix: u64) {
    let old_tier = trust_tier(bundle.trust_score);
    bundle.trust_score = new_score.min(1000);
    let new_tier = trust_tier(bundle.trust_score);
    if old_tier != new_tier {
        let identity =
            issue_agent_identity(&bundle.agent_id).expect("workload identity required (fail closed)");
        let spiffe_id = format!("spiffe://{TRUST_DOMAIN}/agent/{}", bundle.agent_id);
        let expires = now_unix.saturating_add(MTLS_TTL_SECS);
        bundle.spiffe = SpiffeIdentity {
            svid: format!(
                "x509-svid:{spiffe_id}:sha256:{}",
                identity.cert_fingerprint
            ),
            spiffe_id,
            expires_at_unix: expires,
        };
        bundle.mtls = mtls_from_identity(&bundle.agent_id, bundle.trust_score, now_unix, identity);
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
        assert!(mtls
            .key_pem
            .as_ref()
            .is_some_and(|k| k.contains("BEGIN PRIVATE KEY")));
    }

    #[test]
    fn create_bundle_binds_spiffe_fingerprint_to_mtls_cert() {
        let bundle = create_bundle("AG-00001", 850, b"pk", vec!["validate".into()], 1_700_000_000);
        assert!(
            bundle
                .spiffe
                .svid
                .contains(&bundle.mtls.cert_fingerprint),
            "SPIFFE svid must reference mtls cert fingerprint"
        );
        assert!(bundle.mtls.key_pem.is_some());
        let json = serde_json::to_string(&bundle).expect("serialize");
        assert!(
            !json.contains("BEGIN PRIVATE KEY"),
            "private key must not serialize into AgentMeshBundle JSON"
        );
    }
}