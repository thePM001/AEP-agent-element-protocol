//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use sha2::{Digest, Sha256};

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
}

pub fn digest_canonical(body: &serde_json::Value) -> String {
    let encoded = serde_json::to_vec(body).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(&encoded);
    hex::encode(h.finalize())
}

pub fn egress_power_allowed(manifest: &SignedManifest, strict: StrictMode) -> Result<(), ManifestError> {
    if matches!(strict, StrictMode::On) && manifest.signature.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
        return Err(ManifestError::Unsigned);
    }
    let expect = digest_canonical(&manifest.body);
    if !manifest.digest.is_empty() && manifest.digest != expect {
        return Err(ManifestError::DigestMismatch);
    }
    if matches!(strict, StrictMode::On) && manifest.digest.is_empty() {
        return Err(ManifestError::Unsigned);
    }
    if manifest.provisional {
        return Err(ManifestError::ProvisionalEgress);
    }
    Ok(())
}
