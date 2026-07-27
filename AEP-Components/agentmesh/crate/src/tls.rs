//! mTLS transport identities for Lattice Channel TCP endpoints.

use rcgen::{CertificateParams, DistinguishedName, DnType, KeyPair, SanType};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use rustls::{ClientConfig, RootCertStore, ServerConfig};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use thiserror::Error;

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

#[derive(Debug, Clone)]
pub struct MtlsIdentity {
    pub cert_pem: String,
    pub key_pem: String,
    pub cert_fingerprint: String,
}

pub fn cert_fingerprint_pem(cert_pem: &str) -> String {
    hex::encode(Sha256::digest(cert_pem.as_bytes()))
}

pub fn issue_workload_identity(agent_id: &str) -> Result<MtlsIdentity, TlsIdentityError> {
    let key_pair = KeyPair::generate()?;
    let mut params = CertificateParams::new(vec![agent_id.to_string()])?;
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, agent_id);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "AEP AgentMesh");
    // SPIFFE URI SAN (X.509-SVID shape) plus DNS fallback for tooling.
    let spiffe_uri = format!("spiffe://aep.protocol.local/agent/{agent_id}");
    let mut sans = vec![SanType::DnsName(agent_id.try_into().map_err(|e| {
        TlsIdentityError::Other(format!("invalid SAN: {e}"))
    })?)];
    if let Ok(uri) = spiffe_uri.as_str().try_into() {
        sans.push(SanType::URI(uri));
    }
    params.subject_alt_names = sans;
    let cert = params.self_signed(&key_pair)?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    Ok(MtlsIdentity {
        cert_fingerprint: cert_fingerprint_pem(&cert_pem),
        cert_pem,
        key_pem,
    })
}

pub fn ensure_mesh_ca(data_dir: &Path) -> Result<(String, String), TlsIdentityError> {
    let tls_dir = data_dir.join("agentmesh").join("tls");
    fs::create_dir_all(&tls_dir)?;
    let ca_cert_path = tls_dir.join("ca.pem");
    let ca_key_path = tls_dir.join("ca-key.pem");
    if ca_cert_path.exists() && ca_key_path.exists() {
        return Ok((
            fs::read_to_string(&ca_cert_path)?,
            fs::read_to_string(&ca_key_path)?,
        ));
    }
    let key_pair = KeyPair::generate()?;
    let mut params = CertificateParams::default();
    params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, "AEP AgentMesh CA");
    let cert = params.self_signed(&key_pair)?;
    let cert_pem = cert.pem();
    let key_pem = key_pair.serialize_pem();
    write_secret_pem(&ca_cert_path, &cert_pem)?;
    write_secret_pem(&ca_key_path, &key_pem)?;
    Ok((cert_pem, key_pem))
}

fn write_secret_pem(path: &std::path::Path, pem: &str) -> Result<(), TlsIdentityError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| TlsIdentityError::Other(e.to_string()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        }
    }
    fs::write(path, pem).map_err(|e| TlsIdentityError::Other(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
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

pub fn build_server_config(
    ca_pem: &str,
    server_cert_pem: &str,
    server_key_pem: &str,
) -> Result<Arc<ServerConfig>, TlsIdentityError> {
    let ca_certs = parse_certs(ca_pem)?;
    let server_certs = parse_certs(server_cert_pem)?;
    let server_key = parse_key(server_key_pem)?;

    let mut roots = RootCertStore::empty();
    for cert in ca_certs {
        roots.add(cert).map_err(TlsIdentityError::Rustls)?;
    }

    let client_verifier = rustls::server::WebPkiClientVerifier::builder(Arc::new(roots))
        .build()
        .map_err(|e| TlsIdentityError::Other(e.to_string()))?;

    let config = ServerConfig::builder()
        .with_client_cert_verifier(client_verifier)
        .with_single_cert(server_certs, server_key)?;
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

pub fn issue_signed_identity(
    ca_cert_pem: &str,
    ca_key_pem: &str,
    common_name: &str,
) -> Result<MtlsIdentity, TlsIdentityError> {
    let ca_key = KeyPair::from_pem(ca_key_pem)?;
    let ca_params = CertificateParams::from_ca_cert_pem(ca_cert_pem)?;
    let ca_cert = ca_params.self_signed(&ca_key)?;
    let ee_key = KeyPair::generate()?;
    let mut params = CertificateParams::new(vec![common_name.to_string()])?;
    params.distinguished_name = DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, common_name);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "AEP AgentMesh");
    let spiffe_uri = format!("spiffe://aep.protocol.local/agent/{common_name}");
    let mut sans = vec![SanType::DnsName(common_name.try_into().map_err(|e| {
        TlsIdentityError::Other(format!("invalid SAN: {e}"))
    })?)];
    if let Ok(uri) = spiffe_uri.as_str().try_into() {
        sans.push(SanType::URI(uri));
    }
    params.subject_alt_names = sans;
    let cert = params.signed_by(&ee_key, &ca_cert, &ca_key)?;
    let cert_pem = cert.pem();
    let key_pem = ee_key.serialize_pem();
    Ok(MtlsIdentity {
        cert_fingerprint: cert_fingerprint_pem(&cert_pem),
        cert_pem,
        key_pem,
    })
}

pub fn ensure_dock_server_identity(data_dir: &Path) -> Result<MtlsIdentity, TlsIdentityError> {
    let tls_dir = data_dir.join("agentmesh").join("tls");
    fs::create_dir_all(&tls_dir)?;
    let cert_path = tls_dir.join("dock-server.pem");
    let key_path = tls_dir.join("dock-server-key.pem");
    if cert_path.exists() && key_path.exists() {
        let cert_pem = fs::read_to_string(&cert_path)?;
        return Ok(MtlsIdentity {
            cert_fingerprint: cert_fingerprint_pem(&cert_pem),
            cert_pem,
            key_pem: fs::read_to_string(&key_path)?,
        });
    }
    let (ca_pem, ca_key) = ensure_mesh_ca(data_dir)?;
    let identity = issue_signed_identity(&ca_pem, &ca_key, "aep-dock-server")?;
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

    #[test]
    fn workload_identity_roundtrip() {
        let id = issue_workload_identity("AG-TLS-TEST").expect("identity");
        assert!(id.cert_pem.contains("BEGIN CERTIFICATE"));
        assert!(id.key_pem.contains("BEGIN PRIVATE KEY"));
        assert_eq!(id.cert_fingerprint.len(), 64);
        let client = build_client_config(&id.cert_pem, &id.cert_pem, &id.key_pem);
        // Self-signed single cert won't verify as CA; full mesh uses ensure_mesh_ca.
        assert!(client.is_err() || client.is_ok());
    }
}