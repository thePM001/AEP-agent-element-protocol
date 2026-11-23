//! mTLS transport identities for Lattice Channel TCP endpoints.
//!
//! Every certificate this module issues carries a validity window. The mesh CA lives
//! [`MESH_CA_LIFETIME_SECS`], the dock server [`DOCK_SERVER_LIFETIME_SECS`], a client
//! identity issued to an agent [`CLIENT_IDENTITY_LIFETIME_SECS`] and an in-process
//! workload identity [`WORKLOAD_IDENTITY_LIFETIME_SECS`]. A leaf never outlives the CA
//! that signed it. A stored certificate is reissued once less than a quarter of its
//! lifetime remains, once it has expired and once it claims a longer life than its
//! kind allows.

#![allow(unsafe_code)]

use rcgen::{CertificateParams, DistinguishedName, DnType, DnValue, KeyPair, SanType};
use rustls::client::danger::ServerCertVerifier;
use rustls::client::WebPkiServerVerifier;
use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const DAY_SECS: u64 = 24 * 3600;
/// Lifetime of the mesh CA certificate.
pub const MESH_CA_LIFETIME_SECS: u64 = 365 * DAY_SECS;
/// Lifetime of the dock server certificate.
pub const DOCK_SERVER_LIFETIME_SECS: u64 = 30 * DAY_SECS;
/// Lifetime of a client identity issued to an agent with `--issue-mesh-identity`.
pub const CLIENT_IDENTITY_LIFETIME_SECS: u64 = 7 * DAY_SECS;
/// Lifetime of a workload identity minted in process. It is the stated lifetime of
/// the mTLS state of an AgentMesh bundle.
pub const WORKLOAD_IDENTITY_LIFETIME_SECS: u64 = 3600;
/// A certificate is reissued once less than 1/REISSUE_FRACTION of its lifetime remains.
const REISSUE_FRACTION: u64 = 4;
/// Name the dock server certificate carries and dock clients verify.
pub const DOCK_SERVER_NAME: &str = "aep-dock-server";

#[derive(Debug, Error)]
pub enum TlsIdentityError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("rcgen: {0}")]
    Rcgen(#[from] rcgen::Error),
    #[error("rustls: {0}")]
    Rustls(#[from] rustls::Error),
    #[error("tls: {0}")]
    Other(String),
}

/// Validity window of a certificate in unix seconds. A certificate is valid from
/// `not_before_unix` up to and including `not_after_unix`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Validity {
    pub not_before_unix: u64,
    pub not_after_unix: u64,
}

impl Validity {
    /// A window that opens at `now_unix` and lasts `lifetime_secs`.
    pub fn starting(now_unix: u64, lifetime_secs: u64) -> Self {
        Self {
            not_before_unix: now_unix,
            not_after_unix: now_unix.saturating_add(lifetime_secs),
        }
    }

    pub fn lifetime_secs(&self) -> u64 {
        self.not_after_unix.saturating_sub(self.not_before_unix)
    }

    /// The same window, ended no later than the window of its issuer.
    pub fn capped_by(self, issuer: Validity) -> Self {
        Self {
            not_before_unix: self.not_before_unix,
            not_after_unix: self.not_after_unix.min(issuer.not_after_unix),
        }
    }

    pub fn contains(&self, now_unix: u64) -> bool {
        self.not_before_unix <= now_unix && now_unix <= self.not_after_unix
    }

    /// True when a certificate of this window must be reissued at `now_unix`: it is not
    /// valid yet, it claims a longer life than `lifetime_secs` or less than a quarter of
    /// `lifetime_secs` remains before it expires.
    pub fn reissue_due(&self, now_unix: u64, lifetime_secs: u64) -> bool {
        now_unix < self.not_before_unix
            || self.lifetime_secs() > lifetime_secs
            || now_unix.saturating_add(lifetime_secs / REISSUE_FRACTION) >= self.not_after_unix
    }
}

#[derive(Debug, Clone)]
pub struct MtlsIdentity {
    pub cert_pem: String,
    pub key_pem: String,
    pub cert_fingerprint: String,
    pub validity: Validity,
}

/// A certificate a TLS peer presented, as the node records it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresentedCertificate {
    /// SHA-256 of the DER bytes, hex.
    pub cert_fingerprint: String,
    pub subject_cn: Option<String>,
    pub not_before_unix: u64,
    pub not_after_unix: u64,
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// SHA-256 of the DER bytes of a certificate, hex.
pub fn cert_fingerprint_der(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

/// SHA-256 of the DER bytes of the first certificate in a PEM text, hex. The same
/// certificate gets the same fingerprint whether it was issued here or presented by a
/// peer.
pub fn cert_fingerprint_pem(cert_pem: &str) -> Result<String, TlsIdentityError> {
    let certs = parse_certs(cert_pem)?;
    Ok(cert_fingerprint_der(certs[0].as_ref()))
}

fn unix_of(t: i64) -> u64 {
    u64::try_from(t).unwrap_or(0)
}

fn validity_of_params(params: &CertificateParams) -> Validity {
    Validity {
        not_before_unix: unix_of(params.not_before.unix_timestamp()),
        not_after_unix: unix_of(params.not_after.unix_timestamp()),
    }
}

fn apply_validity(params: &mut CertificateParams, validity: Validity) {
    let epoch = rcgen::date_time_ymd(1970, 1, 1);
    params.not_before = epoch + Duration::from_secs(validity.not_before_unix);
    params.not_after = epoch + Duration::from_secs(validity.not_after_unix);
}

/// Validity window written into the first certificate of a PEM text.
pub fn certificate_validity(cert_pem: &str) -> Result<Validity, TlsIdentityError> {
    let params = CertificateParams::from_ca_cert_pem(cert_pem)?;
    Ok(validity_of_params(&params))
}

fn dn_text(value: &DnValue) -> Option<String> {
    match value {
        DnValue::Utf8String(s) => Some(s.clone()),
        DnValue::PrintableString(s) => Some(s.as_str().to_string()),
        DnValue::Ia5String(s) => Some(s.as_str().to_string()),
        _ => None,
    }
}

/// Read the certificate a TLS peer presented: its fingerprint, subject CN and window.
pub fn presented_certificate(der: &[u8]) -> Result<PresentedCertificate, TlsIdentityError> {
    let cert = CertificateDer::from(der.to_vec());
    let params = CertificateParams::from_ca_cert_der(&cert)?;
    let validity = validity_of_params(&params);
    Ok(PresentedCertificate {
        cert_fingerprint: cert_fingerprint_der(der),
        subject_cn: params
            .distinguished_name
            .get(&DnType::CommonName)
            .and_then(dn_text),
        not_before_unix: validity.not_before_unix,
        not_after_unix: validity.not_after_unix,
    })
}

fn identity_params(common_name: &str) -> Result<CertificateParams, TlsIdentityError> {
    let mut params = CertificateParams::new(vec![common_name.to_string()])?;
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, common_name);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "AEP AgentMesh");
    // SPIFFE URI SAN (X.509-SVID shape) plus DNS fallback for tooling.
    let spiffe_uri = format!("spiffe://aep.protocol.local/agent/{common_name}");
    let mut sans =
        vec![SanType::DnsName(common_name.try_into().map_err(|e| {
            TlsIdentityError::Other(format!("invalid SAN: {e}"))
        })?)];
    if let Ok(uri) = spiffe_uri.as_str().try_into() {
        sans.push(SanType::URI(uri));
    }
    params.subject_alt_names = sans;
    Ok(params)
}

fn identity_of(
    cert_pem: String,
    key_pem: String,
    validity: Validity,
) -> Result<MtlsIdentity, TlsIdentityError> {
    Ok(MtlsIdentity {
        cert_fingerprint: cert_fingerprint_pem(&cert_pem)?,
        cert_pem,
        key_pem,
        validity,
    })
}

/// Self-signed workload identity valid for `validity`.
pub fn issue_workload_identity(
    agent_id: &str,
    validity: Validity,
) -> Result<MtlsIdentity, TlsIdentityError> {
    let key_pair = KeyPair::generate()?;
    let mut params = identity_params(agent_id)?;
    apply_validity(&mut params, validity);
    let cert = params.self_signed(&key_pair)?;
    identity_of(cert.pem(), key_pair.serialize_pem(), validity)
}

fn mesh_ca_force_regen() -> bool {
    std::env::var("AEP_MESH_CA_FORCE_REGEN")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

#[cfg(unix)]
fn current_euid() -> u32 {
    extern "C" {
        fn geteuid() -> u32;
    }
    // SAFETY: geteuid is always available on Unix and has no failure mode.
    unsafe { geteuid() }
}

#[cfg(unix)]
fn secret_file_permissions_ok(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| {
            let mode_ok = (meta.permissions().mode() & 0o077) == 0;
            let owner_ok = meta.uid() == current_euid();
            mode_ok && owner_ok
        })
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn secret_file_permissions_ok(_path: &Path) -> bool {
    true
}

fn refuse_world_readable_mesh_secret(path: &Path) -> Result<(), TlsIdentityError> {
    if secret_file_permissions_ok(path) {
        return Ok(());
    }
    Err(TlsIdentityError::Other(format!(
        "mesh CA secret at {} has world/group-readable permissions; refusing load (chmod 0600 and set AEP_MESH_CA_FORCE_REGEN=1 only after operator rotation)",
        path.display()
    )))
}

fn mint_mesh_ca(
    ca_cert_path: &Path,
    ca_key_path: &Path,
    now_unix: u64,
) -> Result<(String, String), TlsIdentityError> {
    let key_pair = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, "AEP AgentMesh CA");
    apply_validity(
        &mut params,
        Validity::starting(now_unix, MESH_CA_LIFETIME_SECS),
    );
    let cert = params.self_signed(&key_pair)?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    write_secret_pem(ca_cert_path, &cert_pem)?;
    write_secret_pem(ca_key_path, &key_pem)?;
    Ok((cert_pem, key_pem))
}

/// Load the mesh CA of `data_dir` or mint it. A stored CA that has expired, has less
/// than a quarter of [`MESH_CA_LIFETIME_SECS`] left or claims a longer life is replaced
/// by a new CA. Leaves signed by the old CA stop verifying and are reissued on load.
pub fn ensure_mesh_ca(data_dir: &Path, now: u64) -> Result<(String, String), TlsIdentityError> {
    let tls_dir = data_dir.join("agentmesh").join("tls");
    fs::create_dir_all(&tls_dir)?;
    let ca_cert_path = tls_dir.join("ca.pem");
    let ca_key_path = tls_dir.join("ca-key.pem");
    let cert_exists = ca_cert_path.exists();
    let key_exists = ca_key_path.exists();
    if cert_exists && key_exists {
        refuse_world_readable_mesh_secret(&ca_cert_path)?;
        refuse_world_readable_mesh_secret(&ca_key_path)?;
        let cert_pem = fs::read_to_string(&ca_cert_path)?;
        let validity = certificate_validity(&cert_pem).map_err(|e| {
            TlsIdentityError::Other(format!(
                "mesh CA at {} is not a readable certificate ({e}); refusing silent regeneration (set AEP_MESH_CA_FORCE_REGEN=1 to rotate)",
                ca_cert_path.display()
            ))
        });
        let validity = match validity {
            Ok(v) => v,
            Err(_) if mesh_ca_force_regen() => {
                return mint_mesh_ca(&ca_cert_path, &ca_key_path, now)
            }
            Err(e) => return Err(e),
        };
        if validity.reissue_due(now, MESH_CA_LIFETIME_SECS) {
            return mint_mesh_ca(&ca_cert_path, &ca_key_path, now);
        }
        return Ok((cert_pem, fs::read_to_string(&ca_key_path)?));
    }
    if (cert_exists || key_exists) && !mesh_ca_force_regen() {
        return Err(TlsIdentityError::Other(format!(
                "incomplete mesh CA pair at {}; refusing silent regeneration (set AEP_MESH_CA_FORCE_REGEN=1 to rotate)",
                tls_dir.display()
            )));
    }
    mint_mesh_ca(&ca_cert_path, &ca_key_path, now)
}

fn write_secret_pem(path: &std::path::Path, pem: &str) -> Result<(), TlsIdentityError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| TlsIdentityError::Other(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|e| TlsIdentityError::Other(format!("chmod 0700 parent failed: {e}")))?;
        }
    }
    fs::write(path, pem).map_err(|e| TlsIdentityError::Other(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| TlsIdentityError::Other(format!("chmod 0600 failed: {e}")))?;
    }
    Ok(())
}

fn parse_certs(pem: &str) -> Result<Vec<CertificateDer<'static>>, TlsIdentityError> {
    let certs: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(pem.as_bytes())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| TlsIdentityError::Other(e.to_string()))?;
    if certs.is_empty() {
        return Err(TlsIdentityError::Other("no certificates in PEM".into()));
    }
    Ok(certs)
}

fn parse_key(pem: &str) -> Result<PrivateKeyDer<'static>, TlsIdentityError> {
    PrivateKeyDer::from_pem_slice(pem.as_bytes())
        .map_err(|e| TlsIdentityError::Other(e.to_string()))
}

/// True when `leaf_pem` chains to `ca_pem`, names `server_name` and is valid at `now_unix`.
pub fn leaf_chains_to(ca_pem: &str, leaf_pem: &str, server_name: &str, now_unix: u64) -> bool {
    let (Ok(ca_certs), Ok(leaf)) = (parse_certs(ca_pem), parse_certs(leaf_pem)) else {
        return false;
    };
    let mut roots = RootCertStore::empty();
    for cert in ca_certs {
        if roots.add(cert).is_err() {
            return false;
        }
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let Ok(verifier) =
        WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider).build()
    else {
        return false;
    };
    let Ok(name) = ServerName::try_from(server_name.to_string()) else {
        return false;
    };
    verifier
        .verify_server_cert(
            &leaf[0],
            &leaf[1..],
            &name,
            &[],
            UnixTime::since_unix_epoch(Duration::from_secs(now_unix)),
        )
        .is_ok()
}

#[derive(Debug, Clone)]
struct IssuedServerKey {
    key: Arc<CertifiedKey>,
    validity: Validity,
}

fn certified_key(identity: &MtlsIdentity) -> Result<IssuedServerKey, TlsIdentityError> {
    let certs = parse_certs(&identity.cert_pem)?;
    let key = parse_key(&identity.key_pem)?;
    let signing = rustls::crypto::ring::sign::any_supported_type(&key)?;
    Ok(IssuedServerKey {
        key: Arc::new(CertifiedKey::new(certs, signing)),
        validity: identity.validity,
    })
}

/// Dock server certificate that reissues itself under the CA the server started with
/// before it expires, so a long running server never presents an expired certificate.
/// The client verifier keeps the roots of that CA, so the CA is not rotated while the
/// server runs. When the CA itself has expired no certificate is served and the
/// handshake fails.
#[derive(Debug)]
struct ReissuingServerCert {
    ca_pem: String,
    ca_key_pem: String,
    ca_validity: Validity,
    current: RwLock<IssuedServerKey>,
}

impl ReissuingServerCert {
    fn new(
        ca_pem: &str,
        ca_key_pem: &str,
        server: &MtlsIdentity,
    ) -> Result<Self, TlsIdentityError> {
        Ok(Self {
            ca_pem: ca_pem.to_string(),
            ca_key_pem: ca_key_pem.to_string(),
            ca_validity: certificate_validity(ca_pem)?,
            current: RwLock::new(certified_key(server)?),
        })
    }

    fn current(&self) -> IssuedServerKey {
        match self.current.read() {
            Ok(guard) => guard.clone(),
            Err(poison) => poison.into_inner().clone(),
        }
    }

    fn key_at(&self, now: u64) -> Option<Arc<CertifiedKey>> {
        let current = self.current();
        let due = current.validity.reissue_due(now, DOCK_SERVER_LIFETIME_SECS);
        // A leaf already ended at the end of the CA cannot get a longer life by reissue.
        let capped = current.validity.not_after_unix >= self.ca_validity.not_after_unix;
        if !due || (capped && current.validity.contains(now)) {
            return current.validity.contains(now).then_some(current.key);
        }
        let fresh = issue_signed_identity(
            &self.ca_pem,
            &self.ca_key_pem,
            DOCK_SERVER_NAME,
            Validity::starting(now, DOCK_SERVER_LIFETIME_SECS),
        )
        .and_then(|identity| certified_key(&identity));
        match fresh {
            Ok(fresh) if fresh.validity.contains(now) => {
                let key = fresh.key.clone();
                match self.current.write() {
                    Ok(mut guard) => *guard = fresh,
                    Err(poison) => *poison.into_inner() = fresh,
                }
                Some(key)
            }
            _ => current.validity.contains(now).then_some(current.key),
        }
    }
}

impl ResolvesServerCert for ReissuingServerCert {
    fn resolve(&self, _client_hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        self.key_at(now_unix())
    }
}

/// Server config of a dock TLS port. Clients must present a certificate of the mesh CA.
/// The server certificate starts as `server` and is reissued under the same CA before
/// it expires.
pub fn build_server_config(
    ca_pem: &str,
    ca_key_pem: &str,
    server: &MtlsIdentity,
) -> Result<Arc<ServerConfig>, TlsIdentityError> {
    let ca_certs = parse_certs(ca_pem)?;
    let mut roots = RootCertStore::empty();
    for cert in ca_certs {
        roots.add(cert).map_err(TlsIdentityError::Rustls)?;
    }

    let client_verifier = rustls::server::WebPkiClientVerifier::builder(Arc::new(roots))
        .build()
        .map_err(|e| TlsIdentityError::Other(e.to_string()))?;

    let resolver = ReissuingServerCert::new(ca_pem, ca_key_pem, server)?;
    let config = ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_cert_resolver(Arc::new(resolver));
    Ok(Arc::new(config))
}

pub fn build_client_config(
    ca_pem: &str,
    client_cert_pem: &str,
    client_key_pem: &str,
) -> Result<Arc<ClientConfig>, TlsIdentityError> {
    let ca_certs = parse_certs(ca_pem)?;
    let client_certs = parse_certs(client_cert_pem)?;
    let client_key = parse_key(client_key_pem)?;

    let mut roots = RootCertStore::empty();
    for cert in ca_certs {
        roots.add(cert).map_err(TlsIdentityError::Rustls)?;
    }

    let config = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_client_auth_cert(client_certs, client_key)?;
    Ok(Arc::new(config))
}

/// Identity signed by the mesh CA, valid for `validity` but never past the end of the CA.
/// Refused when the CA has expired before the identity would start.
pub fn issue_signed_identity(
    ca_cert_pem: &str,
    ca_key_pem: &str,
    common_name: &str,
    validity: Validity,
) -> Result<MtlsIdentity, TlsIdentityError> {
    let ca_key = KeyPair::from_pem(ca_key_pem)?;
    let ca_params = CertificateParams::from_ca_cert_pem(ca_cert_pem)?;
    let validity = validity.capped_by(validity_of_params(&ca_params));
    if validity.not_after_unix <= validity.not_before_unix {
        return Err(TlsIdentityError::Other(format!(
            "mesh CA ends before {common_name} would start; reissue the mesh CA"
        )));
    }
    let ca_cert = ca_params.self_signed(&ca_key)?;
    let ee_key = KeyPair::generate()?;
    let mut params = identity_params(common_name)?;
    apply_validity(&mut params, validity);
    let cert = params.signed_by(&ee_key, &ca_cert, &ca_key)?;
    identity_of(cert.pem(), ee_key.serialize_pem(), validity)
}

/// Load the dock server identity of `data_dir` or issue it. A stored identity that
/// does not chain to the current mesh CA, is not valid now or is due for reissue is
/// replaced.
pub fn ensure_dock_server_identity(
    data_dir: &Path,
    now: u64,
) -> Result<MtlsIdentity, TlsIdentityError> {
    let tls_dir = data_dir.join("agentmesh").join("tls");
    fs::create_dir_all(&tls_dir)?;
    let cert_path = tls_dir.join("dock-server.pem");
    let key_path = tls_dir.join("dock-server-key.pem");
    if (cert_path.exists() != key_path.exists()) && !mesh_ca_force_regen() {
        return Err(TlsIdentityError::Other(format!(
                "incomplete dock server identity at {}; refusing silent regeneration (set AEP_MESH_CA_FORCE_REGEN=1 to rotate)",
                tls_dir.display()
            )));
    }
    let (ca_pem, ca_key) = ensure_mesh_ca(data_dir, now)?;
    if cert_path.exists() && key_path.exists() {
        refuse_world_readable_mesh_secret(&cert_path)?;
        refuse_world_readable_mesh_secret(&key_path)?;
        let cert_pem = fs::read_to_string(&cert_path)?;
        let stored = certificate_validity(&cert_pem).ok().filter(|v| {
            !v.reissue_due(now, DOCK_SERVER_LIFETIME_SECS)
                && leaf_chains_to(&ca_pem, &cert_pem, DOCK_SERVER_NAME, now)
        });
        if let Some(validity) = stored {
            return identity_of(cert_pem, fs::read_to_string(&key_path)?, validity);
        }
    }
    let identity = issue_signed_identity(
        &ca_pem,
        &ca_key,
        DOCK_SERVER_NAME,
        Validity::starting(now, DOCK_SERVER_LIFETIME_SECS),
    )?;
    write_secret_pem(&cert_path, &identity.cert_pem)?;
    write_secret_pem(&key_path, &identity.key_pem)?;
    Ok(identity)
}

pub fn lattice_endpoint_is_tls(endpoint: &str) -> bool {
    endpoint.starts_with("tls://")
}

pub fn lattice_tls_host_port(endpoint: &str) -> Option<(&str, u16)> {
    let rest = endpoint.strip_prefix("tls://")?;
    let (host, port) = rest.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    Some((host, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    /// Seconds between not_before and not_after of an issued certificate.
    fn x509_lifetime_secs(cert_pem: &str) -> u64 {
        certificate_validity(cert_pem)
            .expect("parse")
            .lifetime_secs()
    }

    #[test]
    fn mesh_ca_and_dock_server_certs_expire() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let (ca, ca_key) = ensure_mesh_ca(dir.path(), now_unix()).expect("ca");
        let server = ensure_dock_server_identity(dir.path(), now_unix()).expect("server");
        let now = now_unix();
        let workload =
            issue_workload_identity("AG-LIFE", Validity::starting(now, 3600)).expect("workload");
        let client = issue_signed_identity(
            &ca,
            &ca_key,
            "AG-CLIENT",
            Validity::starting(now, CLIENT_IDENTITY_LIFETIME_SECS),
        )
        .expect("client");
        for (name, pem, lifetime) in [
            ("mesh ca", &ca, MESH_CA_LIFETIME_SECS),
            ("dock server", &server.cert_pem, DOCK_SERVER_LIFETIME_SECS),
            ("workload", &workload.cert_pem, 3600),
            ("client", &client.cert_pem, CLIENT_IDENTITY_LIFETIME_SECS),
        ] {
            let life = x509_lifetime_secs(pem);
            assert!(
                life <= lifetime,
                "{name} certificate lives {life} seconds, stated {lifetime}"
            );
            assert!(life > 0, "{name} certificate has an empty window");
        }
        assert_eq!(
            certificate_validity(&server.cert_pem).unwrap(),
            server.validity
        );
    }

    #[test]
    fn signed_identity_never_outlives_its_ca() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tls = dir.path().join("tls");
        let start = 1_900_000_000;
        let (ca, ca_key) =
            mint_mesh_ca(&tls.join("ca.pem"), &tls.join("ca-key.pem"), start).expect("ca");
        let ca_end = certificate_validity(&ca).unwrap().not_after_unix;
        let late = ca_end - 60;
        let id = issue_signed_identity(&ca, &ca_key, "AG-LATE", Validity::starting(late, 3600))
            .expect("issue");
        assert_eq!(id.validity.not_after_unix, ca_end);
        assert_eq!(certificate_validity(&id.cert_pem).unwrap(), id.validity);
        let err = issue_signed_identity(
            &ca,
            &ca_key,
            "AG-AFTER",
            Validity::starting(ca_end + 1, 3600),
        )
        .expect_err("expired CA must refuse");
        assert!(err.to_string().contains("reissue the mesh CA"), "{err}");
    }

    #[test]
    fn reissue_due_rules() {
        let v = Validity::starting(1_000, 400);
        assert!(v.reissue_due(999, 400), "not valid yet");
        assert!(!v.reissue_due(1_000, 400));
        assert!(!v.reissue_due(1_299, 400));
        assert!(v.reissue_due(1_300, 400), "a quarter left");
        assert!(v.reissue_due(1_401, 400), "expired");
        assert!(v.reissue_due(1_000, 399), "longer than its kind allows");
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_reissues_before_expiry_and_dock_server_follows() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let start = now_unix();
        let (ca1, _) = ensure_mesh_ca(dir.path(), start).expect("mint");
        let server1 = ensure_dock_server_identity(dir.path(), start).expect("server");
        // Same day: both load unchanged.
        assert_eq!(ensure_mesh_ca(dir.path(), start + 60).unwrap().0, ca1);
        assert_eq!(
            ensure_dock_server_identity(dir.path(), start + 60)
                .unwrap()
                .cert_pem,
            server1.cert_pem
        );
        // The dock server is reissued in the last quarter of its life under the same CA.
        let server_late = start + DOCK_SERVER_LIFETIME_SECS - DOCK_SERVER_LIFETIME_SECS / 8;
        let server2 = ensure_dock_server_identity(dir.path(), server_late).expect("reissue");
        assert_ne!(server2.cert_pem, server1.cert_pem);
        assert!(leaf_chains_to(
            &ca1,
            &server2.cert_pem,
            DOCK_SERVER_NAME,
            server_late
        ));
        // The CA is reissued in the last quarter of its life and the server follows it.
        let ca_late = start + MESH_CA_LIFETIME_SECS - MESH_CA_LIFETIME_SECS / 8;
        let server3 = ensure_dock_server_identity(dir.path(), ca_late).expect("rotate");
        let (ca2, _) = ensure_mesh_ca(dir.path(), ca_late).expect("ca2");
        assert_ne!(ca2, ca1, "CA was not reissued before expiry");
        assert!(leaf_chains_to(
            &ca2,
            &server3.cert_pem,
            DOCK_SERVER_NAME,
            ca_late
        ));
        assert!(!leaf_chains_to(
            &ca1,
            &server3.cert_pem,
            DOCK_SERVER_NAME,
            ca_late
        ));
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_without_lifetime_is_replaced() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let tls = dir.path().join("agentmesh").join("tls");
        // A CA of the old issuer: rcgen defaults, 1975 to 4096.
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::default();
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let forever = params.self_signed(&key).unwrap().pem();
        write_secret_pem(&tls.join("ca.pem"), &forever).unwrap();
        write_secret_pem(&tls.join("ca-key.pem"), &key.serialize_pem()).unwrap();
        let (ca, _) = ensure_mesh_ca(dir.path(), now_unix()).expect("replace");
        assert_ne!(ca, forever);
        assert!(x509_lifetime_secs(&ca) <= MESH_CA_LIFETIME_SECS);
    }

    #[test]
    fn running_server_reissues_its_cert_and_stops_after_ca_end() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tls = dir.path().join("tls");
        let start = now_unix();
        let (ca, ca_key) =
            mint_mesh_ca(&tls.join("ca.pem"), &tls.join("ca-key.pem"), start).expect("ca");
        let server = issue_signed_identity(
            &ca,
            &ca_key,
            DOCK_SERVER_NAME,
            Validity::starting(start, DOCK_SERVER_LIFETIME_SECS),
        )
        .expect("server");
        let resolver = ReissuingServerCert::new(&ca, &ca_key, &server).expect("resolver");
        let first = resolver.key_at(start + 60).expect("key");
        let late = start + DOCK_SERVER_LIFETIME_SECS - 60;
        let second = resolver.key_at(late).expect("reissued key");
        assert_ne!(
            first.cert[0], second.cert[0],
            "server cert was not reissued"
        );
        let reissued = resolver.current().validity;
        assert_eq!(reissued.not_before_unix, late);
        assert!(reissued.lifetime_secs() <= DOCK_SERVER_LIFETIME_SECS);
        let ca_end = certificate_validity(&ca).unwrap().not_after_unix;
        assert!(resolver.key_at(ca_end + 1).is_none(), "served past CA end");
    }

    /// Pump an in-memory handshake to its end. The server error is returned when the
    /// server refuses the client.
    fn handshake(
        client: &mut rustls::ClientConnection,
        server: &mut rustls::ServerConnection,
    ) -> Result<(), rustls::Error> {
        for _ in 0..16 {
            let mut to_server = Vec::new();
            while client.wants_write() {
                client.write_tls(&mut to_server).expect("client write");
            }
            let mut rd = &to_server[..];
            while !rd.is_empty() {
                server.read_tls(&mut rd).expect("server read");
                server.process_new_packets()?;
            }
            let mut to_client = Vec::new();
            while server.wants_write() {
                server.write_tls(&mut to_client).expect("server write");
            }
            let mut rd = &to_client[..];
            while !rd.is_empty() {
                client.read_tls(&mut rd).expect("client read");
                client.process_new_packets()?;
            }
            if !client.is_handshaking() && !server.is_handshaking() && !client.wants_write() {
                return Ok(());
            }
        }
        Err(rustls::Error::General("handshake did not finish".into()))
    }

    #[test]
    fn dock_tls_sees_the_presented_client_cert_and_refuses_an_expired_one() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let _ = rustls::crypto::ring::default_provider().install_default();
        let dir = tempfile::tempdir().expect("tempdir");
        let now = now_unix();
        let server = ensure_dock_server_identity(dir.path(), now).expect("server");
        let (ca, ca_key) = ensure_mesh_ca(dir.path(), now).expect("ca");
        let server_cfg = build_server_config(&ca, &ca_key, &server).expect("server cfg");
        let name = ServerName::try_from(DOCK_SERVER_NAME).expect("name");

        let client = issue_signed_identity(
            &ca,
            &ca_key,
            "AG-DOCK-TLS",
            Validity::starting(now, CLIENT_IDENTITY_LIFETIME_SECS),
        )
        .expect("client");
        let client_cfg = build_client_config(&ca, &client.cert_pem, &client.key_pem).unwrap();
        let mut c = rustls::ClientConnection::new(client_cfg, name.clone()).unwrap();
        let mut s = rustls::ServerConnection::new(server_cfg.clone()).unwrap();
        handshake(&mut c, &mut s).expect("valid client admitted");
        let seen = s.peer_certificates().expect("client cert")[0].clone();
        let presented = presented_certificate(seen.as_ref()).expect("read");
        assert_eq!(presented.cert_fingerprint, client.cert_fingerprint);
        assert_eq!(presented.subject_cn.as_deref(), Some("AG-DOCK-TLS"));

        let expired = issue_signed_identity(
            &ca,
            &ca_key,
            "AG-EXPIRED",
            Validity::starting(now - 7200, 3600),
        )
        .expect("expired client");
        let client_cfg = build_client_config(&ca, &expired.cert_pem, &expired.key_pem).unwrap();
        let mut c = rustls::ClientConnection::new(client_cfg, name).unwrap();
        let mut s = rustls::ServerConnection::new(server_cfg).unwrap();
        let err = handshake(&mut c, &mut s).expect_err("expired client refused");
        assert!(err.to_string().to_lowercase().contains("expired"), "{err}");
    }

    #[test]
    fn presented_certificate_matches_issued_identity() {
        let now = now_unix();
        let id = issue_workload_identity("AG-PRESENT", Validity::starting(now, 3600)).unwrap();
        let der = parse_certs(&id.cert_pem).unwrap();
        let seen = presented_certificate(der[0].as_ref()).expect("read");
        assert_eq!(seen.cert_fingerprint, id.cert_fingerprint);
        assert_eq!(seen.subject_cn.as_deref(), Some("AG-PRESENT"));
        assert_eq!(seen.not_before_unix, id.validity.not_before_unix);
        assert_eq!(seen.not_after_unix, id.validity.not_after_unix);
    }

    #[test]
    fn workload_identity_roundtrip() {
        // Tests share one process, so install the provider here instead of
        // relying on another test to have done it first.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let id = issue_workload_identity("AG-TLS-TEST", Validity::starting(now_unix(), 3600))
            .expect("identity");
        assert!(id.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(id.key_pem.contains("BEGIN PRIVATE KEY"));
        assert_eq!(id.cert_fingerprint.len(), 64);
        build_client_config(&id.cert_pem, &id.cert_pem, &id.key_pem).expect("client config");
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_mint_is_0600() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let (cert, key) = ensure_mesh_ca(dir.path(), now_unix()).expect("mint");
        assert!(cert.contains("BEGIN CERTIFICATE"));
        assert!(key.contains("BEGIN PRIVATE KEY"));
        use std::os::unix::fs::PermissionsExt;
        let tls = dir.path().join("agentmesh").join("tls");
        let ca_mode = fs::metadata(tls.join("ca.pem"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let key_mode = fs::metadata(tls.join("ca-key.pem"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(ca_mode, 0o600);
        assert_eq!(key_mode, 0o600);
        let again = ensure_mesh_ca(dir.path(), now_unix()).expect("reload 0600");
        assert_eq!(again.0, cert);
        assert_eq!(again.1, key);
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_world_readable_refuses_load() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        ensure_mesh_ca(dir.path(), now_unix()).expect("mint");
        let ca = dir.path().join("agentmesh").join("tls").join("ca.pem");
        use std::os::unix::fs::PermissionsExt;
        let mut p = fs::metadata(&ca).unwrap().permissions();
        p.set_mode(0o644);
        fs::set_permissions(&ca, p).unwrap();
        let err = ensure_mesh_ca(dir.path(), now_unix()).expect_err("must refuse");
        let s = err.to_string();
        assert!(
            s.contains("world/group-readable") || s.contains("refusing load"),
            "unexpected err: {s}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_incomplete_pair_refuses_silent_regen() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        ensure_mesh_ca(dir.path(), now_unix()).expect("mint");
        let key = dir.path().join("agentmesh").join("tls").join("ca-key.pem");
        fs::remove_file(&key).unwrap();
        let err = ensure_mesh_ca(dir.path(), now_unix()).expect_err("must refuse");
        assert!(
            err.to_string().contains("refusing silent regeneration"),
            "unexpected err: {err}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn mesh_ca_force_regen_rotates_incomplete() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().expect("tempdir");
        let (c1, _) = ensure_mesh_ca(dir.path(), now_unix()).expect("mint");
        fs::remove_file(dir.path().join("agentmesh").join("tls").join("ca-key.pem")).unwrap();
        std::env::set_var("AEP_MESH_CA_FORCE_REGEN", "1");
        let (c2, _) = ensure_mesh_ca(dir.path(), now_unix()).expect("force");
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        assert_ne!(c1, c2);
    }

    #[cfg(unix)]
    #[test]
    fn dock_server_world_readable_refuses_load() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        ensure_dock_server_identity(dir.path(), now_unix()).expect("mint");
        let key = dir
            .path()
            .join("agentmesh")
            .join("tls")
            .join("dock-server-key.pem");
        use std::os::unix::fs::PermissionsExt;
        let mut p = fs::metadata(&key).unwrap().permissions();
        p.set_mode(0o644);
        fs::set_permissions(&key, p).unwrap();
        let err = ensure_dock_server_identity(dir.path(), now_unix()).expect_err("must refuse");
        let s = err.to_string();
        assert!(
            s.contains("world/group-readable") || s.contains("refusing load"),
            "unexpected err: {s}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn dock_server_mint_is_0600() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_MESH_CA_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let id = ensure_dock_server_identity(dir.path(), now_unix()).expect("mint");
        assert!(id.cert_pem.contains("BEGIN CERTIFICATE"));
        use std::os::unix::fs::PermissionsExt;
        let tls = dir.path().join("agentmesh").join("tls");
        let cert_mode = fs::metadata(tls.join("dock-server.pem"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let key_mode = fs::metadata(tls.join("dock-server-key.pem"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(cert_mode, 0o600);
        assert_eq!(key_mode, 0o600);
    }
}
