//! Lattice Channel is the only permitted communication path in AEP 2.8.

use aep_lattice_crypto::{open, seal, KemKeypair, PQEncryptedCapsule, SignKeypair};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use thiserror::Error;

pub const CHANNEL_VERSION: &str = "2.8.0";

/// AEP 2.8 security invariant: no component may bypass Lattice Channels.
pub const LATTICE_CHANNEL_ONLY: bool = true;

/// When true (default in Base Node + Docker), non-frame docking wire formats are rejected.
pub const REJECT_NON_FRAME_DOCKING: bool = true;

/// Lattice scene validation is mandatory for every system topology (not UI-only).
pub const LATTICE_SCENE_VALIDATION_MANDATORY: bool = true;


#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockingPort {
    InferenceEngine,
    ValidationEngine,
    FutureFeatures,
    /// PERA (Perceptive Rails) - sensor ingress, world-model updates (AEP 3.0+ path).
    Pera,
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
    #[error("crypto: {0}")]
    Crypto(#[from] aep_lattice_crypto::CryptoError),
}

#[derive(Debug, Clone)]
pub struct RateLimiter {
    max_per_window: u32,
    window: Duration,
    counts: HashMap<String, (u32, Instant)>,
}

impl RateLimiter {
    pub fn new(max_per_window: u32, window: Duration) -> Self {
        Self {
            max_per_window,
            window,
            counts: HashMap::new(),
        }
    }

    pub fn check(&mut self, agent_id: &str) -> Result<(), ChannelError> {
        let now = Instant::now();
        self.counts
            .retain(|_, (_, started)| now.duration_since(*started) <= self.window);
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
    let capsule = seal(plaintext, dock_kem_public, agent_signer)?;
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
    Ok(open(
        &frame.capsule,
        &dock_kem.secret,
        &dock_kem.public,
        signer_public,
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
    Ok(open(
        &frame.capsule,
        &kem.secret,
        &kem.public,
        signer_public,
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
}