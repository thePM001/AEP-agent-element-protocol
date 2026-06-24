//! Persistent dock KEM keys and per-agent signing keys for lattice transport.

use aep_lattice_crypto::{generate_kem_keypair, generate_sign_keypair, KemKeypair, SignKeypair};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

const DOCK_KEM_FILE: &str = "dock-kem.json";
const AGENT_SIGN_KEYS_FILE: &str = "agent-sign-keys.json";

#[derive(Debug, Serialize, Deserialize)]
struct KemKeyFile {
    public_hex: String,
    secret_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SignKeyFile {
    public_hex: String,
    secret_hex: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AgentSignKeysFile {
    keys: HashMap<String, SignKeyFile>,
}

pub fn dock_kem_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DOCK_KEM_FILE)
}

pub fn agent_sign_keys_path(data_dir: &Path) -> PathBuf {
    data_dir.join(AGENT_SIGN_KEYS_FILE)
}

fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(dir) {
            let mut perms = meta.permissions();
            perms.set_mode(0o700);
            let _ = fs::set_permissions(dir, perms);
        }
    }
    Ok(())
}

fn restrict_secret_file_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

#[cfg(unix)]
fn secret_file_permissions_ok(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| (meta.permissions().mode() & 0o077) == 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn secret_file_permissions_ok(_path: &Path) -> bool {
    true
}

fn write_secret_json(path: &Path, json: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    fs::write(path, format!("{json}\n"))?;
    restrict_secret_file_permissions(path);
    Ok(())
}

pub fn load_or_create_dock_kem(data_dir: &Path) -> KemKeypair {
    let path = dock_kem_path(data_dir);
    if path.exists() {
        if !secret_file_permissions_ok(&path) {
            tracing::warn!(path = %path.display(), "dock-kem.json permissions too open; regenerating");
        } else if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(file) = serde_json::from_str::<KemKeyFile>(&raw) {
                if let (Ok(public), Ok(secret)) = (
                    hex::decode(&file.public_hex),
                    hex::decode(&file.secret_hex),
                ) {
                    return KemKeypair { public, secret };
                }
            }
        }
    }
    let kem = generate_kem_keypair();
    let file = KemKeyFile {
        public_hex: hex::encode(&kem.public),
        secret_hex: hex::encode(&kem.secret),
    };
    if let Ok(json) = serde_json::to_string_pretty(&file) {
        let _ = write_secret_json(&path, &json);
    }
    kem
}

#[derive(Debug, Default)]
pub struct AgentSignKeyStore {
    path: PathBuf,
    keys: HashMap<String, SignKeypair>,
    dirty: bool,
}

impl AgentSignKeyStore {
    pub fn load(data_dir: &Path) -> Self {
        let path = agent_sign_keys_path(data_dir);
        let keys = if path.exists() {
            if !secret_file_permissions_ok(&path) {
                tracing::warn!(path = %path.display(), "agent-sign-keys.json permissions too open");
                HashMap::new()
            } else if let Ok(raw) = fs::read_to_string(&path) {
                serde_json::from_str::<AgentSignKeysFile>(&raw)
                    .ok()
                    .map(|file| {
                        file.keys
                            .into_iter()
                            .filter_map(|(agent_id, entry)| {
                                let public = hex::decode(&entry.public_hex).ok()?;
                                let secret = hex::decode(&entry.secret_hex).ok()?;
                                Some((agent_id, SignKeypair { public, secret }))
                            })
                            .collect()
                    })
                    .unwrap_or_default()
            } else {
                HashMap::new()
            }
        } else {
            HashMap::new()
        };
        Self {
            path,
            keys,
            dirty: false,
        }
    }

    pub fn get_or_create(&mut self, agent_id: &str) -> SignKeypair {
        if let Some(existing) = self.keys.get(agent_id) {
            return existing.clone();
        }
        let sign = generate_sign_keypair();
        self.keys.insert(agent_id.to_string(), sign.clone());
        self.dirty = true;
        sign
    }

    pub fn public_for(&self, agent_id: &str) -> Option<Vec<u8>> {
        self.keys.get(agent_id).map(|k| k.public.clone())
    }

    pub fn flush(&mut self) -> std::io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        let file = AgentSignKeysFile {
            keys: self
                .keys
                .iter()
                .map(|(agent_id, key)| {
                    (
                        agent_id.clone(),
                        SignKeyFile {
                            public_hex: hex::encode(&key.public),
                            secret_hex: hex::encode(&key.secret),
                        },
                    )
                })
                .collect(),
        };
        write_secret_json(
            &self.path,
            &serde_json::to_string_pretty(&file)?,
        )?;
        self.dirty = false;
        Ok(())
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dock_kem_roundtrip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let kem1 = load_or_create_dock_kem(dir.path());
        let kem2 = load_or_create_dock_kem(dir.path());
        assert_eq!(kem1.public, kem2.public);
        assert_eq!(kem1.secret, kem2.secret);
    }

    #[test]
    fn agent_sign_keys_persist() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        let key = store.get_or_create("AG-TEST");
        store.flush().expect("flush");
        let reloaded = AgentSignKeyStore::load(dir.path());
        assert_eq!(
            reloaded.public_for("AG-TEST").as_deref(),
            Some(key.public.as_slice())
        );
    }

    #[cfg(unix)]
    #[test]
    fn secret_files_restrict_permissions() {
        let dir = tempfile::tempdir().expect("tempdir");
        load_or_create_dock_kem(dir.path());
        let path = dock_kem_path(dir.path());
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}