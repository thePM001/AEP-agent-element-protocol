//! Post-quantum capsule encryption for AEP 2.8 Lattice Channels.
//!
//! Wire format is compatible with NLA Agent Composer `PQEncryptedCapsule` envelopes
//! while using real ML-KEM-768 key encapsulation and ML-DSA-65 signatures
//! (RustCrypto pure-Rust FIPS 203 / FIPS 204).

use aes_gcm::aead::{Aead, KeyInit as AeadKeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use hkdf::Hkdf;
use ml_dsa::{
    Generate as DsaGenerate, KeyExport as DsaKeyExport, KeyInit as DsaKeyInit, Keypair, MlDsa65,
    Signature, Signer, SigningKey, Verifier, VerifyingKey,
};
use ml_kem::array::Array;
use ml_kem::{
    Ciphertext, Decapsulate, DecapsulationKey768, Encapsulate, EncapsulationKey768, Kem,
    KeyExport, KeyInit, MlKem768, SharedKey, TryKeyInit,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Lattice channel crypto profile label for envelope interop.
pub const PROFILE: &str = "aep-lattice-channel-v1";
pub const KEM_LABEL: &str = "ML-KEM-768";
pub const SYMMETRIC_LABEL: &str = "AES-256-GCM";
pub const SIGNATURE_LABEL: &str = "ML-DSA-65";
/// BM-09: HKDF info label for AES-256 key derivation from ML-KEM shared secret.
pub const AES_KDF_INFO: &[u8] = b"aep-lattice-aes-256";

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("encrypt failed: {0}")]
    Encrypt(String),
    #[error("decrypt failed: {0}")]
    Decrypt(String),
    #[error("signature invalid")]
    BadSignature,
    #[error("fingerprint mismatch")]
    FingerprintMismatch,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PQEncryptedCapsule {
    pub encapsulated_key: Vec<u8>,
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub key_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signature: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct KemKeypair {
    pub public: Vec<u8>,
    pub secret: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct SignKeypair {
    pub public: Vec<u8>,
    pub secret: Vec<u8>,
}

fn array_to_vec(bytes: impl AsRef<[u8]>) -> Vec<u8> {
    bytes.as_ref().to_vec()
}

fn kem_seed_from_slice(secret: &[u8]) -> Result<ml_kem::Seed, CryptoError> {
    Array::try_from(secret)
        .map_err(|_| CryptoError::Decrypt("kem secret must be 64-byte seed".into()))
}

fn dsa_seed_from_slice(secret: &[u8]) -> Result<ml_dsa::Seed, CryptoError> {
    Array::try_from(secret)
        .map_err(|_| CryptoError::Decrypt("sign secret must be 32-byte seed".into()))
}

fn ek_from_public(public: &[u8]) -> Result<EncapsulationKey768, CryptoError> {
    let encoded = Array::try_from(public)
        .map_err(|_| CryptoError::Encrypt("kem public key length invalid".into()))?;
    TryKeyInit::new(&encoded).map_err(|e| CryptoError::Encrypt(format!("kem public key: {e:?}")))
}

fn dk_from_secret(secret: &[u8]) -> Result<DecapsulationKey768, CryptoError> {
    Ok(KeyInit::new(&kem_seed_from_slice(secret)?))
}

fn sk_from_secret(secret: &[u8]) -> Result<SigningKey<MlDsa65>, CryptoError> {
    Ok(DsaKeyInit::new(&dsa_seed_from_slice(secret)?))
}

fn vk_from_public(public: &[u8]) -> Result<VerifyingKey<MlDsa65>, CryptoError> {
    let encoded = Array::try_from(public)
        .map_err(|_| CryptoError::Decrypt("sign public key length invalid".into()))?;
    Ok(DsaKeyInit::new(&encoded))
}

fn ct_from_bytes(bytes: &[u8]) -> Result<Ciphertext<MlKem768>, CryptoError> {
    Array::try_from(bytes)
        .map_err(|_| CryptoError::Decrypt("encapsulated key length invalid".into()))
}

pub fn generate_kem_keypair() -> KemKeypair {
    let (dk, ek) = MlKem768::generate_keypair();
    KemKeypair {
        public: array_to_vec(KeyExport::to_bytes(&ek)),
        secret: array_to_vec(KeyExport::to_bytes(&dk)),
    }
}

pub fn generate_sign_keypair() -> SignKeypair {
    let sk = SigningKey::<MlDsa65>::generate();
    let vk = sk.verifying_key();
    SignKeypair {
        public: array_to_vec(DsaKeyExport::to_bytes(&vk)),
        secret: array_to_vec(DsaKeyExport::to_bytes(&sk)),
    }
}

/// Detached ML-DSA-65 sign over an arbitrary message (ledger / identity use).
pub fn mldsa65_sign_detached(message: &[u8], signer: &SignKeypair) -> Result<Vec<u8>, CryptoError> {
    let sk = sk_from_secret(&signer.secret)
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;
    let sig = sk
        .try_sign(message)
        .map_err(|e| CryptoError::Encrypt(format!("sign: {e}")))?;
    Ok(array_to_vec(sig.encode()))
}

/// Detached ML-DSA-65 verify (public-key only; no private material required).
pub fn mldsa65_verify_detached(
    message: &[u8],
    signature: &[u8],
    public_key: &[u8],
) -> Result<(), CryptoError> {
    let sig = Signature::<MlDsa65>::try_from(signature).map_err(|_| CryptoError::BadSignature)?;
    let vk = vk_from_public(public_key)?;
    vk.verify(message, &sig).map_err(|_| CryptoError::BadSignature)
}

/// Derive public key bytes from a secret seed (FIPS seed form).
pub fn mldsa65_public_from_secret(secret_key: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let sk = sk_from_secret(secret_key).map_err(|e| CryptoError::Encrypt(e.to_string()))?;
    Ok(array_to_vec(DsaKeyExport::to_bytes(&sk.verifying_key())))
}

pub fn kem_fingerprint(public_key: &[u8]) -> String {
    hex::encode(Sha256::digest(public_key))
}

/// BM-09: HKDF-SHA256 (not bare SHA-256) for ML-KEM shared secret to AES-256 key.
fn derive_aes_key(shared_secret: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = [0u8; 32];
    // 32-byte OKM cannot fail under SHA-256; never return a fixed zero key.
    hk.expand(AES_KDF_INFO, &mut key)
        .expect("HKDF-SHA256 expand to 32 bytes must succeed");
    key
}

fn derive_aes_key_from_shared(shared_secret: &SharedKey) -> [u8; 32] {
    derive_aes_key(shared_secret.as_slice())
}

#[cfg(test)]
mod kdf_tests {
    use super::*;

    #[test]
    fn bm09_hkdf_length_and_determinism() {
        let ss = b"shared-secret-material-for-test!!";
        let a = derive_aes_key(ss);
        let b = derive_aes_key(ss);
        assert_eq!(a, b);
        assert_ne!(a, [0u8; 32]);
        // not equal to bare SHA-256 of shared secret
        let bare = Sha256::digest(ss);
        assert_ne!(&a[..], &bare[..]);
    }
}

fn random_nonce_12() -> [u8; 12] {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Domain-separated signable material for ML-DSA-65.
///
/// When `binding_aad` is non-empty (LatticeChannelFrame headers), the signature
/// cryptographically binds those headers to the capsule. Empty AAD is only for
/// non-frame capsule use; docking MUST pass frame binding AAD (CAW C-01).
fn signable_bytes(capsule: &PQEncryptedCapsule, binding_aad: &[u8]) -> Vec<u8> {
    let mut clone = capsule.clone();
    clone.signature = None;
    let body = serde_json::to_vec(&clone).expect("capsule serializable");
    let mut out = Vec::with_capacity(24 + binding_aad.len() + body.len());
    out.extend_from_slice(b"aep-capsule-sig-v2\0");
    out.extend_from_slice(&(binding_aad.len() as u64).to_be_bytes());
    out.extend_from_slice(binding_aad);
    out.extend_from_slice(&body);
    out
}

/// Seal plaintext without frame binding (capsule-only). Prefer [`seal_with_binding`] for lattice frames.
pub fn seal(
    plaintext: &[u8],
    recipient_kem_public: &[u8],
    signer: &SignKeypair,
) -> Result<PQEncryptedCapsule, CryptoError> {
    seal_with_binding(plaintext, recipient_kem_public, signer, &[])
}

/// Seal plaintext and ML-DSA-sign capsule + optional frame binding AAD (CAW C-01).
pub fn seal_with_binding(
    plaintext: &[u8],
    recipient_kem_public: &[u8],
    signer: &SignKeypair,
    binding_aad: &[u8],
) -> Result<PQEncryptedCapsule, CryptoError> {
    let ek = ek_from_public(recipient_kem_public)?;
    let (ct, ss) = ek.encapsulate();
    let aes_key = derive_aes_key_from_shared(&ss);
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;
    let nonce_bytes = random_nonce_12();
    let nonce = Nonce::from_slice(&nonce_bytes);
    // Bind frame AAD into AES-GCM (defense-in-depth with ML-DSA binding).
    let ciphertext = cipher
        .encrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: plaintext,
                aad: binding_aad,
            },
        )
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;

    let mut capsule = PQEncryptedCapsule {
        encapsulated_key: array_to_vec(ct),
        nonce: nonce_bytes.to_vec(),
        ciphertext,
        key_fingerprint: kem_fingerprint(recipient_kem_public),
        signature: None,
    };

    let sk = sk_from_secret(&signer.secret).map_err(|e| CryptoError::Encrypt(e.to_string()))?;
    let sig = sk
        .try_sign(&signable_bytes(&capsule, binding_aad))
        .map_err(|e| CryptoError::Encrypt(format!("sign: {e}")))?;
    capsule.signature = Some(array_to_vec(sig.encode()));
    Ok(capsule)
}

/// Verify ML-DSA-65 signature on a capsule without decrypting payload (empty binding).
pub fn verify_capsule_signature(
    capsule: &PQEncryptedCapsule,
    signer_public: &[u8],
) -> Result<(), CryptoError> {
    verify_capsule_signature_bound(capsule, signer_public, &[])
}

/// Verify capsule ML-DSA-65 signature bound to frame AAD (CAW C-01).
pub fn verify_capsule_signature_bound(
    capsule: &PQEncryptedCapsule,
    signer_public: &[u8],
    binding: &[u8],
) -> Result<(), CryptoError> {
    verify_capsule_signature_with_binding(capsule, signer_public, binding)
}

/// Alias kept for callers that use the longer name.
pub fn verify_capsule_signature_with_binding(
    capsule: &PQEncryptedCapsule,
    signer_public: &[u8],
    binding_aad: &[u8],
) -> Result<(), CryptoError> {
    let sig_bytes = capsule
        .signature
        .as_ref()
        .ok_or(CryptoError::BadSignature)?;
    let sig = Signature::<MlDsa65>::try_from(sig_bytes.as_slice())
        .map_err(|_| CryptoError::BadSignature)?;
    let vk = vk_from_public(signer_public)?;
    vk.verify(&signable_bytes(capsule, binding_aad), &sig)
        .map_err(|_| CryptoError::BadSignature)
}

pub fn open(
    capsule: &PQEncryptedCapsule,
    recipient_kem_secret: &[u8],
    recipient_kem_public: &[u8],
    signer_public: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    open_with_binding(
        capsule,
        recipient_kem_secret,
        recipient_kem_public,
        signer_public,
        &[],
    )
}

/// Open capsule after verifying signature bound to frame AAD (CAW C-01).
pub fn open_with_binding(
    capsule: &PQEncryptedCapsule,
    recipient_kem_secret: &[u8],
    recipient_kem_public: &[u8],
    signer_public: &[u8],
    binding_aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let dk = dk_from_secret(recipient_kem_secret)?;
    let ct = ct_from_bytes(&capsule.encapsulated_key)?;
    let expected_fp = kem_fingerprint(recipient_kem_public);
    if capsule.key_fingerprint != expected_fp {
        return Err(CryptoError::FingerprintMismatch);
    }

    verify_capsule_signature_bound(capsule, signer_public, binding_aad)?;

    let ss = dk.decapsulate(&ct);
    let aes_key = derive_aes_key_from_shared(&ss);
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;
    if capsule.nonce.len() != 12 {
        return Err(CryptoError::Decrypt("nonce must be 12 bytes".into()));
    }
    let nonce = Nonce::from_slice(&capsule.nonce);
    cipher
        .decrypt(
            nonce,
            aes_gcm::aead::Payload {
                msg: capsule.ciphertext.as_ref(),
                aad: binding_aad,
            },
        )
        .map_err(|e| CryptoError::Decrypt(e.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PqcEnvelope {
    pub profile: String,
    pub kem: String,
    pub symmetric: String,
    pub encapsulated_key: String,
    pub nonce: String,
    pub ciphertext: String,
    pub key_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sig: Option<String>,
}

pub fn capsule_to_envelope(capsule: &PQEncryptedCapsule) -> PqcEnvelope {
    let b64 = base64::engine::general_purpose::STANDARD;
    PqcEnvelope {
        profile: PROFILE.into(),
        kem: KEM_LABEL.into(),
        symmetric: SYMMETRIC_LABEL.into(),
        encapsulated_key: b64.encode(&capsule.encapsulated_key),
        nonce: b64.encode(&capsule.nonce),
        ciphertext: b64.encode(&capsule.ciphertext),
        key_fingerprint: capsule.key_fingerprint.clone(),
        sig: capsule.signature.as_ref().map(|s| b64.encode(s)),
    }
}

pub fn envelope_to_capsule(envelope: &PqcEnvelope) -> Result<PQEncryptedCapsule, CryptoError> {
    if envelope.profile != PROFILE {
        return Err(CryptoError::Decrypt(format!(
            "unsupported profile: {}",
            envelope.profile
        )));
    }
    if envelope.kem != KEM_LABEL || envelope.symmetric != SYMMETRIC_LABEL {
        return Err(CryptoError::Decrypt("unsupported crypto labels".into()));
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let encapsulated_key = b64
        .decode(&envelope.encapsulated_key)
        .map_err(|e| CryptoError::Decrypt(format!("encapsulated_key: {e}")))?;
    let nonce = b64
        .decode(&envelope.nonce)
        .map_err(|e| CryptoError::Decrypt(format!("nonce: {e}")))?;
    let ciphertext = b64
        .decode(&envelope.ciphertext)
        .map_err(|e| CryptoError::Decrypt(format!("ciphertext: {e}")))?;
    let signature = match &envelope.sig {
        Some(sig) => Some(
            b64
                .decode(sig)
                .map_err(|e| CryptoError::Decrypt(format!("sig: {e}")))?,
        ),
        None => None,
    };
    Ok(PQEncryptedCapsule {
        encapsulated_key,
        nonce,
        ciphertext,
        key_fingerprint: envelope.key_fingerprint.clone(),
        signature,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pq_capsule_roundtrip_with_signature() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let plain = b"lattice-channel:composer-unblock-payload";
        let capsule = seal(plain, &kem.public, &sign).unwrap();
        assert!(capsule.signature.is_some());
        let opened = open(&capsule, &kem.secret, &kem.public, &sign.public).unwrap();
        assert_eq!(opened, plain);
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let mut capsule = seal(b"payload", &kem.public, &sign).unwrap();
        if let Some(b) = capsule.ciphertext.first_mut() {
            *b ^= 0xFF;
        }
        assert!(matches!(
            open(&capsule, &kem.secret, &kem.public, &sign.public),
            Err(_)
        ));
    }

    #[test]
    fn bad_signature_rejected() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let mut capsule = seal(b"payload", &kem.public, &sign).unwrap();
        if let Some(sig) = capsule.signature.as_mut() {
            sig[0] ^= 0xFF;
        }
        assert!(matches!(
            open(&capsule, &kem.secret, &kem.public, &sign.public),
            Err(CryptoError::BadSignature)
        ));
    }

    #[test]
    fn fingerprint_mismatch_rejected() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let mut capsule = seal(b"payload", &kem.public, &sign).unwrap();
        capsule.key_fingerprint = "00".repeat(32);
        assert!(matches!(
            open(&capsule, &kem.secret, &kem.public, &sign.public),
            Err(CryptoError::FingerprintMismatch)
        ));
    }

    #[test]
    fn envelope_roundtrip() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let capsule = seal(b"interop", &kem.public, &sign).unwrap();
        let envelope = capsule_to_envelope(&capsule);
        let restored = envelope_to_capsule(&envelope).unwrap();
        let opened = open(&restored, &kem.secret, &kem.public, &sign.public).unwrap();
        assert_eq!(opened, b"interop");
    }

    #[test]
    fn binding_aad_required_for_open_with_binding() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let aad = b"agent=AG-1|contract=c1|sent=9";
        let capsule = seal_with_binding(b"payload", &kem.public, &sign, aad).unwrap();
        assert!(open_with_binding(&capsule, &kem.secret, &kem.public, &sign.public, aad).is_ok());
        assert!(matches!(
            open_with_binding(
                &capsule,
                &kem.secret,
                &kem.public,
                &sign.public,
                b"agent=AG-2|contract=c1|sent=9"
            ),
            Err(CryptoError::BadSignature)
        ));
        assert!(matches!(
            open(&capsule, &kem.secret, &kem.public, &sign.public),
            Err(CryptoError::BadSignature)
        ));
    }

    #[test]
    fn seed_key_sizes() {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        assert_eq!(kem.secret.len(), 64, "ML-KEM seed is 64 bytes");
        assert_eq!(sign.secret.len(), 32, "ML-DSA seed is 32 bytes");
    }

    #[test]
    fn mldsa65_message_sign_verify_public_only() {
        let kp = generate_sign_keypair();
        let msg = b"ledger-evidence-payload";
        let sig = mldsa65_sign_detached(msg, &kp).expect("sign");
        mldsa65_verify_detached(msg, &sig, &kp.public).expect("verify");
        assert!(mldsa65_verify_detached(b"tampered", &sig, &kp.public).is_err());
        let mut bad = sig.clone();
        bad[0] ^= 0xFF;
        assert!(mldsa65_verify_detached(msg, &bad, &kp.public).is_err());
        let derived = mldsa65_public_from_secret(&kp.secret).expect("pk from seed");
        assert_eq!(derived, kp.public);
    }
}
