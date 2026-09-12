//! Lattice Channel is the only permitted communication path in AEP 2.8.
//!
//! AEP28-ENV-047: frame header binding is length-prefixed. Ids must not contain 0x7c.

use aep_lattice_crypto::{
    open_with_binding, seal_with_binding, KemKeypair, PQEncryptedCapsule, SignKeypair,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use thiserror::Error;

pub const CHANNEL_VERSION: &str = "2.8.6";

/// AEP 2.8 security invariant: no component may bypass Lattice Channels.
pub const LATTICE_CHANNEL_ONLY: bool = true;

/// When true (default in Base Node + Docker), non-frame docking wire formats are rejected.
pub const REJECT_NON_FRAME_DOCKING: bool = true;

/// Lattice scene validation is mandatory for every system topology (not UI-only).
pub const LATTICE_SCENE_VALIDATION_MANDATORY: bool = true;

/// Length-prefixed LatticeChannelFrame header binding magic (AEP28-ENV-047).
pub const FRAME_BINDING_MAGIC: &[u8] = b"aep-frame-v2\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockingPort {
    InferenceEngine,
    ValidationEngine,
    FutureFeatures,
    RegulationModule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeChannelFrame {
    pub channel_id: String,
    pub agent_id: String,
    pub session_id: String,
    pub docking_port: DockingPort,
    pub contract_id: String,
    pub capsule: PQEncryptedCapsule,
    pub sent_at_unix: u64,
}

#[derive(Debug, Error)]
pub enum ChannelError {
    #[error("rate limit exceeded for agent {0}")]
    RateLimited(String),
    #[error("contract {0} not active")]
    ContractInactive(String),
    #[error("delimiter 0x7c forbidden in lattice id {0}")]
    PipeInId(String),
    #[error("crypto: {0}")]
    Crypto(#[from] aep_lattice_crypto::CryptoError),
}

#[derive(Debug, Clone)]
pub struct RateLimiter {
    max_per_window: u32,
    window: Duration,
    counts: HashMap<String, (u32, Instant)>,
    /// MEDIUM: hard cap on unique keys to prevent unbounded map growth / memory DoS
    max_keys: usize,
}

impl RateLimiter {
    pub fn new(max_per_window: u32, window: Duration) -> Self {
        Self {
            max_per_window,
            window,
            counts: HashMap::new(),
            max_keys: 10_000,
        }
    }

    pub fn with_max_keys(mut self, max_keys: usize) -> Self {
        self.max_keys = max_keys.max(1);
        self
    }

    pub fn check(&mut self, agent_id: &str) -> Result<(), ChannelError> {
        let now = Instant::now();
        self.counts
            .retain(|_, (_, started)| now.duration_since(*started) <= self.window);
        if !self.counts.contains_key(agent_id) && self.counts.len() >= self.max_keys {
            return Err(ChannelError::RateLimited(format!(
                "rate-limiter key cap ({}) reached",
                self.max_keys
            )));
        }
        let entry = self.counts.entry(agent_id.to_string()).or_insert((0, now));
        if now.duration_since(entry.1) > self.window {
            *entry = (0, now);
        }
        if entry.0 >= self.max_per_window {
            return Err(ChannelError::RateLimited(agent_id.to_string()));
        }
        entry.0 += 1;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct ContractRegistry {
    active: HashMap<String, bool>,
}

impl ContractRegistry {
    pub fn register(&mut self, contract_id: impl Into<String>) {
        self.active.insert(contract_id.into(), true);
    }

    pub fn is_active(&self, contract_id: &str) -> bool {
        self.active.get(contract_id).copied().unwrap_or(false)
    }
}

pub fn frame_digest(frame: &LatticeChannelFrame) -> String {
    let bytes = serde_json::to_vec(frame).expect("frame serializable");
    hex::encode(Sha256::digest(bytes))
}

fn docking_port_label(docking_port: DockingPort) -> &'static str {
    match docking_port {
        DockingPort::InferenceEngine => "inference_engine",
        DockingPort::ValidationEngine => "validation_engine",
        DockingPort::FutureFeatures => "future_features",
        DockingPort::RegulationModule => "regulation_module",
    }
}

fn reject_pipe_in_id(id: &str, field: &'static str) -> Result<(), ChannelError> {
    if id.as_bytes().iter().any(|b| *b == 0x7c) {
        return Err(ChannelError::PipeInId(field.to_string()));
    }
    Ok(())
}

fn push_len_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    let n = bytes.len() as u32;
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(bytes);
}

/// Canonical binding over LatticeChannelFrame headers (excludes capsule).
/// Included in ML-DSA signature + AES-GCM AAD so headers cannot be rebound.
///
/// AEP28-ENV-047: each field is u32 big-endian length-prefixed. Ids that contain
/// delimiter 0x7c are rejected so a join cannot splice fields.
pub fn frame_header_binding(
    channel_id: &str,
    agent_id: &str,
    session_id: &str,
    docking_port: DockingPort,
    contract_id: &str,
    sent_at_unix: u64,
) -> Result<Vec<u8>, ChannelError> {
    reject_pipe_in_id(channel_id, "channel_id")?;
    reject_pipe_in_id(agent_id, "agent_id")?;
    reject_pipe_in_id(session_id, "session_id")?;
    reject_pipe_in_id(contract_id, "contract_id")?;
    let port = docking_port_label(docking_port);
    let mut out = Vec::new();
    out.extend_from_slice(FRAME_BINDING_MAGIC);
    push_len_prefixed(&mut out, channel_id.as_bytes());
    push_len_prefixed(&mut out, agent_id.as_bytes());
    push_len_prefixed(&mut out, session_id.as_bytes());
    push_len_prefixed(&mut out, port.as_bytes());
    push_len_prefixed(&mut out, contract_id.as_bytes());
    out.extend_from_slice(&sent_at_unix.to_be_bytes());
    Ok(out)
}

pub fn frame_binding_from(frame: &LatticeChannelFrame) -> Result<Vec<u8>, ChannelError> {
    frame_header_binding(
        &frame.channel_id,
        &frame.agent_id,
        &frame.session_id,
        frame.docking_port,
        &frame.contract_id,
        frame.sent_at_unix,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn build_frame(
    channel_id: &str,
    agent_id: &str,
    session_id: &str,
    docking_port: DockingPort,
    contract_id: &str,
    plaintext: &[u8],
    kem: &KemKeypair,
    signer: &SignKeypair,
    sent_at_unix: u64,
) -> Result<LatticeChannelFrame, ChannelError> {
    build_frame_for_dock(
        channel_id,
        agent_id,
        session_id,
        docking_port,
        contract_id,
        plaintext,
        &kem.public,
        signer,
        sent_at_unix,
    )
}

/// Seal payload to the dock recipient KEM public key; sign with the agent keypair.
#[allow(clippy::too_many_arguments)]
pub fn build_frame_for_dock(
    channel_id: &str,
    agent_id: &str,
    session_id: &str,
    docking_port: DockingPort,
    contract_id: &str,
    plaintext: &[u8],
    dock_kem_public: &[u8],
    agent_signer: &SignKeypair,
    sent_at_unix: u64,
) -> Result<LatticeChannelFrame, ChannelError> {
    let binding = frame_header_binding(
        channel_id,
        agent_id,
        session_id,
        docking_port,
        contract_id,
        sent_at_unix,
    )?;
    let capsule = seal_with_binding(plaintext, dock_kem_public, agent_signer, &binding)?;
    Ok(LatticeChannelFrame {
        channel_id: channel_id.into(),
        agent_id: agent_id.into(),
        session_id: session_id.into(),
        docking_port,
        contract_id: contract_id.into(),
        capsule,
        sent_at_unix,
    })
}

/// Verify capsule signature and decrypt using dock KEM keys and agent signer public key.
pub fn verify_and_open_frame(
    frame: &LatticeChannelFrame,
    dock_kem: &KemKeypair,
    signer_public: &[u8],
    contracts: &ContractRegistry,
) -> Result<Vec<u8>, ChannelError> {
    if !contracts.is_active(&frame.contract_id) {
        return Err(ChannelError::ContractInactive(frame.contract_id.clone()));
    }
    open_verified_capsule(frame, dock_kem, signer_public)
}

/// Decrypt and verify signature without enforcing contract registry state.
pub fn open_verified_capsule(
    frame: &LatticeChannelFrame,
    dock_kem: &KemKeypair,
    signer_public: &[u8],
) -> Result<Vec<u8>, ChannelError> {
    let binding = frame_binding_from(frame)?;
    Ok(open_with_binding(
        &frame.capsule,
        &dock_kem.secret,
        &dock_kem.public,
        signer_public,
        &binding,
    )?)
}

pub fn open_frame(
    frame: &LatticeChannelFrame,
    kem: &KemKeypair,
    signer_public: &[u8],
    contracts: &ContractRegistry,
) -> Result<Vec<u8>, ChannelError> {
    if !contracts.is_active(&frame.contract_id) {
        return Err(ChannelError::ContractInactive(frame.contract_id.clone()));
    }
    let binding = frame_binding_from(frame)?;
    Ok(open_with_binding(
        &frame.capsule,
        &kem.secret,
        &kem.public,
        signer_public,
        &binding,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_lattice_crypto::generate_sign_keypair;

    #[test]
    fn rate_limiter_blocks_burst() {
        let mut limiter = RateLimiter::new(2, Duration::from_secs(60));
        assert!(limiter.check("AG-00001").is_ok());
        assert!(limiter.check("AG-00001").is_ok());
        assert!(matches!(
            limiter.check("AG-00001"),
            Err(ChannelError::RateLimited(_))
        ));
    }

    #[test]
    fn contract_enforcement_blocks_inactive() {
        let kem = aep_lattice_crypto::generate_kem_keypair();
        let sign = generate_sign_keypair();
        let mut contracts = ContractRegistry::default();
        let frame = build_frame(
            "ch-1",
            "AG-00001",
            "sess-1",
            DockingPort::ValidationEngine,
            "contract-a",
            b"hello",
            &kem,
            &sign,
            1,
        )
        .unwrap();
        assert!(open_frame(&frame, &kem, &sign.public, &contracts).is_err());
        contracts.register("contract-a");
        let opened = open_frame(&frame, &kem, &sign.public, &contracts).unwrap();
        assert_eq!(opened, b"hello");
    }

    #[test]
    fn delimiter_in_channel_id_rejected() {
        let err = frame_header_binding(
            "ch\u{007c}x",
            "ag",
            "se",
            DockingPort::ValidationEngine,
            "co",
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ChannelError::PipeInId(ref f) if f == "channel_id"));
    }

    #[test]
    fn delimiter_in_agent_id_rejected() {
        let err = frame_header_binding(
            "ch",
            "ag\u{007c}x",
            "se",
            DockingPort::ValidationEngine,
            "co",
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ChannelError::PipeInId(ref f) if f == "agent_id"));
    }

    #[test]
    fn delimiter_in_session_id_rejected() {
        let err = frame_header_binding(
            "ch",
            "ag",
            "se\u{007c}x",
            DockingPort::ValidationEngine,
            "co",
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ChannelError::PipeInId(ref f) if f == "session_id"));
    }

    #[test]
    fn delimiter_in_contract_id_rejected() {
        let err = frame_header_binding(
            "ch",
            "ag",
            "se",
            DockingPort::ValidationEngine,
            "co\u{007c}x",
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ChannelError::PipeInId(ref f) if f == "contract_id"));
    }

    #[test]
    fn build_frame_rejects_delimiter_before_seal() {
        let kem = aep_lattice_crypto::generate_kem_keypair();
        let sign = generate_sign_keypair();
        let err = build_frame(
            "ch\u{007c}x",
            "AG-00001",
            "sess-1",
            DockingPort::ValidationEngine,
            "contract-a",
            b"hello",
            &kem,
            &sign,
            1,
        )
        .unwrap_err();
        assert!(matches!(err, ChannelError::PipeInId(_)));
    }

    #[test]
    fn length_prefix_is_unambiguous() {
        let left = frame_header_binding(
            "ab",
            "c",
            "s",
            DockingPort::ValidationEngine,
            "k",
            1,
        )
        .unwrap();
        let right = frame_header_binding(
            "a",
            "bc",
            "s",
            DockingPort::ValidationEngine,
            "k",
            1,
        )
        .unwrap();
        assert_ne!(left, right);
        assert!(left.starts_with(FRAME_BINDING_MAGIC));
        assert!(right.starts_with(FRAME_BINDING_MAGIC));
        assert!(frame_header_binding(
            "ab\u{007c}",
            "c",
            "s",
            DockingPort::ValidationEngine,
            "k",
            1
        )
        .is_err());
        assert!(frame_header_binding(
            "ab",
            "\u{007c}c",
            "s",
            DockingPort::ValidationEngine,
            "k",
            1
        )
        .is_err());
    }

    #[test]
    fn binding_uses_v2_magic_not_v1_join() {
        let b = frame_header_binding(
            "ch-1",
            "AG-1",
            "sess-1",
            DockingPort::ValidationEngine,
            "c1",
            9,
        )
        .unwrap();
        assert!(b.starts_with(b"aep-frame-v2\0"));
        let needle = b"aep-frame-v1";
        assert!(!b.windows(needle.len()).any(|w| w == needle));
        let ch_len = 4u32.to_be_bytes();
        assert_eq!(&b[FRAME_BINDING_MAGIC.len()..FRAME_BINDING_MAGIC.len() + 4], &ch_len);
    }
}
