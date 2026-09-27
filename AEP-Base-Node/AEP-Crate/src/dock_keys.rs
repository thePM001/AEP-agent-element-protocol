//! Dock key facade. Persistent dock KEM keys and per-agent signing keys for
//! lattice transport. The store (load, permissions and the refusal of a silent
//! regen) lives in dock_keys_store.rs and the mint (operator CLI and the first
//! mint for data-dock) lives in dock_keys_provision.rs.

pub use crate::dock_keys_provision::{first_mint_data_dock, provision_agent_sign_key};
pub use crate::dock_keys_store::{
    agent_sign_keys_path, dock_kem_path, load_or_create_dock_kem, try_load_or_create_dock_kem,
    AgentSignKeyStore,
};

/// Serializes env mutations across the key tests (cargo test runs in parallel).
#[cfg(test)]
pub(crate) static KEYS_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn decode_signer_public_hex(hex_str: &str) -> Option<Vec<u8>> {
    let trimmed = hex_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    hex::decode(trimmed).ok()
}

pub fn signer_rate_key(signer_public: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(signer_public))
}

