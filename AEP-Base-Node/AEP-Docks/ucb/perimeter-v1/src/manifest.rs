//! Signed task manifests.
//!
//! A manifest counts as signed only when an ML-DSA-65 signature over its digest
//! verifies against the manifest signer key that the operator registered for its
//! agent. A signature field that is merely present proves nothing.

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Domain prefix of the signed message. The signer signs this prefix followed by
/// the lowercase hex digest of the manifest, so a manifest signature can never be
/// replayed as a signature of another AEP object.
pub const MANIFEST_SIGNATURE_CONTEXT: &str = "aep-ucb-task-manifest-v1:";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrictMode {
    On,
    Off,
}

#[derive(Debug, Clone)]
pub struct SignedManifest {
    pub body: serde_json::Value,
    pub digest: String,
    pub signature: Option<String>,
    pub provisional: bool,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ManifestError {
    #[error("unsigned manifest")]
    Unsigned,
    #[error("digest mismatch")]
    DigestMismatch,
    #[error("provisional manifest cannot enable egress")]
    ProvisionalEgress,
    #[error("no manifest signer key is registered for the agent")]
    NoSigner,
    #[error("manifest signature does not verify against the registered signer key")]
    SignatureInvalid,
}

/// ML-DSA-65 public keys of the manifest signers, one per agent id.
#[derive(Debug, Clone, Default)]
pub struct ManifestSigners {
    keys: BTreeMap<String, Vec<u8>>,
}

impl ManifestSigners {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register the signer public key of `agent_id`. A later key replaces an earlier one.
    pub fn insert(&mut self, agent_id: &str, public_key: Vec<u8>) {
        self.keys.insert(agent_id.to_string(), public_key);
    }

    pub fn get(&self, agent_id: &str) -> Option<&[u8]> {
        self.keys.get(agent_id).map(Vec::as_slice)
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }
}

pub fn digest_canonical(body: &serde_json::Value) -> String {
    let encoded = serde_json::to_vec(body).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(&encoded);
    hex::encode(h.finalize())
}

/// The exact bytes a manifest signer signs for `digest`.
pub fn manifest_signing_message(digest: &str) -> Vec<u8> {
    let mut message = MANIFEST_SIGNATURE_CONTEXT.as_bytes().to_vec();
    message.extend_from_slice(digest.as_bytes());
    message
}

/// Verify `signature_hex` over `digest` with the registered `signer` key.
pub fn verify_manifest_signature(
    digest: &str,
    signature_hex: Option<&str>,
    signer: Option<&[u8]>,
) -> Result<(), ManifestError> {
    let Some(signature_hex) = signature_hex.map(str::trim).filter(|s| !s.is_empty()) else {
        return Err(ManifestError::Unsigned);
    };
    let Some(signer) = signer.filter(|k| !k.is_empty()) else {
        return Err(ManifestError::NoSigner);
    };
    let signature = hex::decode(signature_hex).map_err(|_| ManifestError::SignatureInvalid)?;
    aep_lattice_crypto::mldsa65_verify_detached(
        &manifest_signing_message(digest),
        &signature,
        signer,
    )
    .map_err(|_| ManifestError::SignatureInvalid)
}

/// Egress power needs a manifest whose digest matches its body. In strict mode the
/// signature must verify against `signer` over that digest and the manifest must
/// not be provisional.
pub fn egress_power_allowed(
    manifest: &SignedManifest,
    strict: StrictMode,
    signer: Option<&[u8]>,
) -> Result<(), ManifestError> {
    let expect = digest_canonical(&manifest.body);
    if !manifest.digest.is_empty() && manifest.digest != expect {
        return Err(ManifestError::DigestMismatch);
    }
    if matches!(strict, StrictMode::On) {
        verify_manifest_signature(&expect, manifest.signature.as_deref(), signer)?;
    }
    if manifest.provisional {
        return Err(ManifestError::ProvisionalEgress);
    }
    Ok(())
}
