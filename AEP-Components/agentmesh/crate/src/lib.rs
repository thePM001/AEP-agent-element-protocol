//! AgentMesh provides local issuance identity for Lattice Channel transport in AEP 2.8.6.
//! Local X.509 issuance is not mesh attestation.

pub mod tls;

use serde::{Deserialize, Serialize};
pub use tls::{PresentedCertificate, Validity};

pub const TRUST_DOMAIN: &str = "aep.protocol.local";
pub const DID_METHOD: &str = "aep";
/// Stated lifetime of the mTLS state of a bundle. The issued certificate ends no later.
pub const MTLS_TTL_SECS: u64 = tls::WORKLOAD_IDENTITY_LIFETIME_SECS;

/// How a frame reached the node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PeerTransport {
    /// A local Unix socket dock. No certificate is presented on it.
    UnixSocket,
    /// A dock TLS port. The peer presented a client certificate of the mesh CA.
    Mtls,
    /// Sealed and recorded in process by the node itself. No peer exists.
    LocalSeal,
}

/// The AgentMesh column of a ledger row. It names the certificate the peer presented
/// on the connection that carried the frame. It names none when no certificate was
/// presented and never a certificate the node minted for itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerMeshRecord {
    pub agent_id: String,
    pub transport: PeerTransport,
    pub presented_certificate: Option<PresentedCertificate>,
}

impl LedgerMeshRecord {
    /// Record of a frame that arrived with `presented` or without a certificate.
    pub fn for_frame(agent_id: &str, presented: Option<PresentedCertificate>) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            transport: if presented.is_some() {
                PeerTransport::Mtls
            } else {
                PeerTransport::UnixSocket
            },
            presented_certificate: presented,
        }
    }

    /// Record of a frame the node sealed and recorded in process.
    pub fn local_seal(agent_id: &str) -> Self {
        Self {
            agent_id: agent_id.to_string(),
            transport: PeerTransport::LocalSeal,
            presented_certificate: None,
        }
    }
}

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
    pub spiffe: SpiffeIdentity,
    pub did: DidDocument,
    pub mtls: MtlsCertState,
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
    let id = issue_agent_identity(agent_id, Validity::starting(now_unix, ttl_secs))?;
    Ok(SpiffeIdentity {
        svid: format!("x509-svid:{spiffe_id}:sha256:{}", id.cert_fingerprint),
        spiffe_id,
        expires_at_unix: id.validity.not_after_unix,
    })
}

/// Issue an agent identity valid for `validity`. With AEP_DATA it is signed by the mesh
/// CA and ends no later than the CA. The CA is loaded or reissued against the wall clock.
fn issue_agent_identity(agent_id: &str, validity: Validity) -> Result<tls::MtlsIdentity, String> {
    // Prefer mesh CA-signed identity when AEP_DATA is available.
    if let Ok(data) = std::env::var("AEP_DATA") {
        let path = std::path::Path::new(&data);
        if path.is_dir() {
            match tls::ensure_mesh_ca(path, tls::now_unix()) {
                Ok((ca_pem, ca_key)) => {
                    return tls::issue_signed_identity(&ca_pem, &ca_key, agent_id, validity)
                        .map_err(|e| e.to_string());
                }
                Err(e) => {
                    return Err(format!("mesh CA unavailable (fail closed): {e}"));
                }
            }
        }
    }
    tls::issue_workload_identity(agent_id, validity).map_err(|e| e.to_string())
}

/// Honest capability flag: full SPIFFE Workload API attestation is opt-in infra.
/// Local X.509 issuance alone does not claim Workload API enforcement.
pub fn spiffe_cryptographically_enforced() -> bool {
    std::env::var("AEP_AGENTMESH_SPIFFE_WORKLOAD_API")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Issuance kind for AgentMesh identity.
/// Local X.509 issuance is the default. It is not mesh attestation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IssuanceKind {
    LocalX509,
    SpiffeWorkloadApi,
}

/// Default issuance is local X.509 unless Workload API enforcement is opted in.
pub fn issuance_kind() -> IssuanceKind {
    if spiffe_cryptographically_enforced() {
        IssuanceKind::SpiffeWorkloadApi
    } else {
        IssuanceKind::LocalX509
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

/// mTLS state of an issued identity. The stated window is the window of the certificate.
fn mtls_from_identity(agent_id: &str, identity: tls::MtlsIdentity) -> MtlsCertState {
    MtlsCertState {
        agent_id: agent_id.into(),
        cert_fingerprint: identity.cert_fingerprint,
        issued_at_unix: identity.validity.not_before_unix,
        not_after_unix: identity.validity.not_after_unix,
        cert_pem: identity.cert_pem,
        key_pem: Some(identity.key_pem),
        subject: format!("CN={agent_id},O=AEP AgentMesh"),
    }
}

/// Failure to build an AgentMesh identity. Issuance fails closed, so the caller
/// gets this error and no bundle, never a placeholder identity.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum AgentMeshError {
    #[error("workload identity required (fail closed): {0}")]
    Identity(String),
}

/// Issue the mTLS state of one workload identity.
pub fn create_mtls(agent_id: &str, now_unix: u64) -> Result<MtlsCertState, AgentMeshError> {
    let identity = issue_agent_identity(agent_id, Validity::starting(now_unix, MTLS_TTL_SECS))
        .map_err(AgentMeshError::Identity)?;
    Ok(mtls_from_identity(agent_id, identity))
}

/// Issue one EE identity; bind SPIFFE fingerprint and mTLS state to the same cert/key.
pub fn create_bundle(
    agent_id: &str,
    public_key: &[u8],
    capabilities: Vec<String>,
    now_unix: u64,
) -> Result<AgentMeshBundle, AgentMeshError> {
    let identity = issue_agent_identity(agent_id, Validity::starting(now_unix, MTLS_TTL_SECS))
        .map_err(AgentMeshError::Identity)?;
    let spiffe_id = format!("spiffe://{TRUST_DOMAIN}/agent/{agent_id}");
    let spiffe = SpiffeIdentity {
        svid: format!("x509-svid:{spiffe_id}:sha256:{}", identity.cert_fingerprint),
        spiffe_id,
        expires_at_unix: identity.validity.not_after_unix,
    };
    let mtls = mtls_from_identity(agent_id, identity);
    Ok(AgentMeshBundle {
        agent_id: agent_id.into(),
        spiffe,
        did: create_did(agent_id, public_key, capabilities),
        mtls,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mtls_cert_is_real_x509_pem() {
        let mtls = create_mtls("AG-TEST", 1_700_000_000).unwrap();
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
        let bundle =
            create_bundle("AG-00001", b"pk", vec!["validate".into()], 1_700_000_000).unwrap();
        assert!(
            bundle.spiffe.svid.contains(&bundle.mtls.cert_fingerprint),
            "SPIFFE svid must reference mtls cert fingerprint"
        );
        assert!(bundle.mtls.key_pem.is_some());
        let json = serde_json::to_string(&bundle).expect("serialize");
        assert!(
            !json.contains("BEGIN PRIVATE KEY"),
            "private key must not serialize into AgentMeshBundle JSON"
        );
    }

    /// Validity window written into an issued certificate, in unix seconds.
    fn x509_validity(cert_pem: &str) -> (i64, i64) {
        let params = rcgen::CertificateParams::from_ca_cert_pem(cert_pem).expect("parse cert");
        (
            params.not_before.unix_timestamp(),
            params.not_after.unix_timestamp(),
        )
    }

    #[test]
    fn issued_mtls_cert_lives_no_longer_than_its_stated_lifetime() {
        let now = 1_900_000_000u64;
        let mtls = create_mtls("AG-LIFETIME", now).unwrap();
        let (not_before, not_after) = x509_validity(&mtls.cert_pem);
        assert!(
            not_before >= mtls.issued_at_unix as i64,
            "cert starts {not_before} before its stated issue time {}",
            mtls.issued_at_unix
        );
        assert!(
            not_after <= mtls.not_after_unix as i64,
            "cert ends {not_after} after its stated not_after {}",
            mtls.not_after_unix
        );
    }

    #[test]
    fn default_issuance_is_local_x509() {
        std::env::remove_var("AEP_AGENTMESH_SPIFFE_WORKLOAD_API");
        assert_eq!(issuance_kind(), IssuanceKind::LocalX509);
        assert!(!spiffe_cryptographically_enforced());
    }
}
