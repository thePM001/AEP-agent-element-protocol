//! Post-quantum capsule encryption for AEP 2.8 Lattice Channels.
//!
//! Wire format is compatible with NLA Agent Composer `PQEncryptedCapsule` envelopes
//! while using real ML-KEM-768 key encapsulation and ML-DSA-65 signatures.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use pqcrypto_mldsa::mldsa65;
use pqcrypto_mlkem::mlkem768;
use pqcrypto_traits::kem::{Ciphertext as _, PublicKey as KemPublicKey, SecretKey as KemSecretKey, SharedSecret};
use pqcrypto_traits::sign::{DetachedSignature, PublicKey as SignPublicKey, SecretKey as SignSecretKey};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const PROFILE: &str = "aep-lattice-channel-v1";
pub const KEM_LABEL: &str = "ML-KEM-768";
pub const SYMMETRIC_LABEL: &str = "AES-256-GCM";
pub const SIGNATURE_LABEL: &str = "ML-DSA-65";

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

pub fn generate_kem_keypair() -> KemKeypair {
    let (pk, sk) = mlkem768::keypair();
    KemKeypair {
        public: pk.as_bytes().to_vec(),
        secret: sk.as_bytes().to_vec(),
    }
}

pub fn generate_sign_keypair() -> SignKeypair {
    let (pk, sk) = mldsa65::keypair();
    SignKeypair {
        public: pk.as_bytes().to_vec(),
        secret: sk.as_bytes().to_vec(),
    }
}

pub fn kem_fingerprint(public_key: &[u8]) -> String {
    hex::encode(Sha256::digest(public_key))
}

fn derive_aes_key(shared_secret: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(shared_secret);
    let mut key = [0u8; 32];
    key.copy_from_slice(&digest);
    key
}

fn random_nonce_12() -> [u8; 12] {
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

fn signable_bytes(capsule: &PQEncryptedCapsule) -> Vec<u8> {
    let mut clone = capsule.clone();
    clone.signature = None;
    serde_json::to_vec(&clone).expect("capsule serializable")
}

pub fn seal(
    plaintext: &[u8],
    recipient_kem_public: &[u8],
    signer: &SignKeypair,
) -> Result<PQEncryptedCapsule, CryptoError> {
    let pk = mlkem768::PublicKey::from_bytes(recipient_kem_public)
        .map_err(|e| CryptoError::Encrypt(format!("kem public key: {e:?}")))?;
    let (ss, ct) = mlkem768::encapsulate(&pk);
    let aes_key = derive_aes_key(ss.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;
    let nonce_bytes = random_nonce_12();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::Encrypt(e.to_string()))?;

    let mut capsule = PQEncryptedCapsule {
        encapsulated_key: ct.as_bytes().to_vec(),
        nonce: nonce_bytes.to_vec(),
        ciphertext,
        key_fingerprint: kem_fingerprint(recipient_kem_public),
        signature: None,
    };

    let sk = mldsa65::SecretKey::from_bytes(&signer.secret)
        .map_err(|e| CryptoError::Encrypt(format!("sign secret: {e:?}")))?;
    let sig = mldsa65::detached_sign(&signable_bytes(&capsule), &sk);
    capsule.signature = Some(sig.as_bytes().to_vec());
    Ok(capsule)
}

/// Verify ML-DSA-65 signature on a capsule without decrypting payload.
pub fn verify_capsule_signature(
    capsule: &PQEncryptedCapsule,
    signer_public: &[u8],
) -> Result<(), CryptoError> {
    let sig_bytes = capsule
        .signature
        .as_ref()
        .ok_or(CryptoError::BadSignature)?;
    let sig = mldsa65::DetachedSignature::from_bytes(sig_bytes)
        .map_err(|_| CryptoError::BadSignature)?;
    let pk = mldsa65::PublicKey::from_bytes(signer_public)
        .map_err(|e| CryptoError::Decrypt(format!("sign public: {e:?}")))?;
    mldsa65::verify_detached_signature(&sig, &signable_bytes(capsule), &pk)
        .map_err(|_| CryptoError::BadSignature)
}

pub fn open(
    capsule: &PQEncryptedCapsule,
    recipient_kem_secret: &[u8],
    recipient_kem_public: &[u8],
    signer_public: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let sk = mlkem768::SecretKey::from_bytes(recipient_kem_secret)
        .map_err(|e| CryptoError::Decrypt(format!("kem secret: {e:?}")))?;
    let ct = mlkem768::Ciphertext::from_bytes(&capsule.encapsulated_key)
        .map_err(|e| CryptoError::Decrypt(format!("ciphertext: {e:?}")))?;
    let expected_fp = kem_fingerprint(recipient_kem_public);
    if capsule.key_fingerprint != expected_fp {
        return Err(CryptoError::FingerprintMismatch);
    }

    verify_capsule_signature(capsule, signer_public)?;

    let ss = mlkem768::decapsulate(&ct, &sk);
    let aes_key = derive_aes_key(ss.as_bytes());
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| CryptoError::Decrypt(e.to_string()))?;
    if capsule.nonce.len() != 12 {
        return Err(CryptoError::Decrypt("nonce must be 12 bytes".into()));
    }
    let nonce = Nonce::from_slice(&capsule.nonce);
    cipher
        .decrypt(nonce, capsule.ciphertext.as_ref())
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
}