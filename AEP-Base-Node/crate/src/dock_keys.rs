//! Persistent dock KEM keys and per-agent signing keys for lattice transport.
//! Secrets are AES-256-GCM sealed at rest (v2 envelope). Legacy plaintext v1
//! is still readable and re-sealed on next write when a seal key is available.

use aep_lattice_crypto::{generate_kem_keypair, generate_sign_keypair, KemKeypair, SignKeypair};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::BaseNodeError;

const DOCK_KEM_FILE: &str = "dock-kem.json";
const AGENT_SIGN_KEYS_FILE: &str = "agent-sign-keys.json";
const DOCK_SEAL_KEY_FILE: &str = "dock-seal.key";

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

/// v2 sealed envelope: AES-256-GCM over UTF-8 JSON of the inner key file.
#[derive(Debug, Serialize, Deserialize)]
struct SealedEnvelope {
    v: u32,
    alg: String,
    nonce_hex: String,
    ciphertext_hex: String,
}

pub fn dock_kem_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DOCK_KEM_FILE)
}

pub fn agent_sign_keys_path(data_dir: &Path) -> PathBuf {
    data_dir.join(AGENT_SIGN_KEYS_FILE)
}

fn dock_seal_key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(DOCK_SEAL_KEY_FILE)
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

fn write_secret_json(path: &Path, json: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    fs::write(path, format!("{json}\n"))?;
    restrict_secret_file_permissions(path);
    Ok(())
}

/// Resolve AES-256 seal key: AEP_DOCK_SEAL_KEY (64 hex chars) or local dock-seal.key.
fn resolve_seal_key(data_dir: &Path) -> Result<[u8; 32], BaseNodeError> {
    if let Ok(hex_key) = std::env::var("AEP_DOCK_SEAL_KEY") {
        let trimmed = hex_key.trim();
        if !trimmed.is_empty() {
            let bytes = hex::decode(trimmed).map_err(|e| BaseNodeError::SealKeyDecode(e.to_string()))?;
            if bytes.len() != 32 {
                return Err(BaseNodeError::SealKeyLength(bytes.len()));
            }
            let mut out = [0u8; 32];
            out.copy_from_slice(&bytes);
            return Ok(out);
        }
    }
    let path = dock_seal_key_path(data_dir);
    if path.exists() {
        if !secret_file_permissions_ok(&path) {
            return Err(BaseNodeError::SealKeyPermissions { path: path.display().to_string() });
        }
        let raw = fs::read(&path)?;
        if raw.len() != 32 {
            return Err(BaseNodeError::SealKeyFileLength { got: raw.len(), path: path.display().to_string() });
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&raw);
        return Ok(out);
    }
    // Generate local seal key once (0600).
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    fs::write(&path, key)?;
    restrict_secret_file_permissions(&path);
    Ok(key)
}

fn seal_plaintext(data_dir: &Path, plaintext: &[u8]) -> Result<String, BaseNodeError> {
    let key = resolve_seal_key(data_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| BaseNodeError::Crypto(e.to_string()))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| BaseNodeError::SealEncrypt(e.to_string()))?;
    let env = SealedEnvelope {
        v: 2,
        alg: "aes-256-gcm".into(),
        nonce_hex: hex::encode(nonce_bytes),
        ciphertext_hex: hex::encode(ct),
    };
    Ok(serde_json::to_string_pretty(&env)?)
}

fn open_sealed_or_plaintext(data_dir: &Path, raw: &str) -> Result<String, BaseNodeError> {
    let trimmed = raw.trim();
    // v2 sealed envelope
    if let Ok(env) = serde_json::from_str::<SealedEnvelope>(trimmed) {
        if env.v != 2 || env.alg != "aes-256-gcm" {
            return Err(BaseNodeError::SealedEnvelopeUnsupported { v: env.v, alg: env.alg.clone() });
        }
        let key = resolve_seal_key(data_dir)?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| BaseNodeError::Crypto(e.to_string()))?;
        let nonce_bytes = hex::decode(&env.nonce_hex)?;
        if nonce_bytes.len() != 12 {
            return Err(BaseNodeError::SealedEnvelopeNonce);
        }
        let ct = hex::decode(&env.ciphertext_hex)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let pt = cipher
            .decrypt(nonce, ct.as_ref())
            .map_err(|_| BaseNodeError::SealedEnvelopeDecrypt)?;
        return Ok(String::from_utf8(pt)?);
    }
    // Legacy v1 plaintext JSON (still accepted; re-sealed on write)
    Ok(trimmed.to_string())
}

fn write_sealed_secret(data_dir: &Path, path: &Path, plaintext_json: &str) -> Result<(), BaseNodeError> {
    let sealed = seal_plaintext(data_dir, plaintext_json.as_bytes())?;
    write_secret_json(path, &sealed)?;
    Ok(())
}

/// Load dock KEM or create once if absent.
///
/// TASK-A28-H05: never silently regenerate a new identity over a corrupt or
/// world-readable existing key file (that would replace docking identity
/// without detection). Force rotation only with `AEP_DOCK_KEM_FORCE_REGEN=1`.
pub fn try_load_or_create_dock_kem(data_dir: &Path) -> Result<KemKeypair, BaseNodeError> {
    let path = dock_kem_path(data_dir);
    if path.exists() {
        let perms_ok = secret_file_permissions_ok(&path);
        if !perms_ok {
            tracing::error!(
                path = %path.display(),
                "dock-kem.json permissions too open; attempting load without silent regen"
            );
        }
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(plain) = open_sealed_or_plaintext(data_dir, &raw) {
                if let Ok(file) = serde_json::from_str::<KemKeyFile>(&plain) {
                    if let (Ok(public), Ok(secret)) = (
                        hex::decode(&file.public_hex),
                        hex::decode(&file.secret_hex),
                    ) {
                        if !public.is_empty() && !secret.is_empty() {
                            if !perms_ok {
                                return Err(BaseNodeError::DockKemPermissions { path: path.display().to_string() });
                            }
                            // Migrate legacy plaintext to sealed v2 on load when possible.
                            if serde_json::from_str::<SealedEnvelope>(raw.trim()).is_err() {
                                let _ = write_sealed_secret(
                                    data_dir,
                                    &path,
                                    &serde_json::to_string_pretty(&file).unwrap_or_default(),
                                );
                            }
                            return Ok(KemKeypair { public, secret });
                        }
                    }
                }
            }
        }
        let force = std::env::var("AEP_DOCK_KEM_FORCE_REGEN")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !force {
            return Err(BaseNodeError::DockKemCorrupt { path: path.display().to_string() });
        }
        tracing::warn!(path = %path.display(), "AEP_DOCK_KEM_FORCE_REGEN set; rotating dock KEM");
    }
    let kem = generate_kem_keypair();
    let file = KemKeyFile {
        public_hex: hex::encode(&kem.public),
        secret_hex: hex::encode(&kem.secret),
    };
    let json = serde_json::to_string_pretty(&file)?;
    write_sealed_secret(data_dir, &path, &json)?;
    Ok(kem)
}

pub fn load_or_create_dock_kem(data_dir: &Path) -> KemKeypair {
    try_load_or_create_dock_kem(data_dir).unwrap_or_else(|e| {
        panic!("dock KEM load failed (TASK-A28-H05 fail-closed): {e}");
    })
}

#[derive(Debug, Default)]
pub struct AgentSignKeyStore {
    data_dir: PathBuf,
    path: PathBuf,
    keys: HashMap<String, SignKeypair>,
    dirty: bool,
    /// HIGH: world-readable key file was discarded; refuse silent overwrite.
    permissions_poisoned: bool,
}

impl AgentSignKeyStore {
    /// TM-21: fail closed on decrypt/parse errors. Never silently empty a non-empty key file
    /// and later flush a re-minted map over real agent ML-DSA secrets.
    pub fn load(data_dir: &Path) -> Self {
        let path = agent_sign_keys_path(data_dir);
        let mut permissions_poisoned = false;
        let force = std::env::var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let keys = if path.exists() {
            if !secret_file_permissions_ok(&path) {
                tracing::error!(
                    path = %path.display(),
                    "agent-sign-keys.json permissions too open; keys discarded and create/flush blocked until operator fixes mode 0600"
                );
                permissions_poisoned = true;
                HashMap::new()
            } else {
                match fs::read_to_string(&path) {
                    Ok(raw) => match open_sealed_or_plaintext(data_dir, &raw) {
                        Ok(plain) => match serde_json::from_str::<AgentSignKeysFile>(&plain) {
                            Ok(file) => {
                                let entry_count = file.keys.len();
                                let parsed: HashMap<String, SignKeypair> = file
                                    .keys
                                    .into_iter()
                                    .filter_map(|(agent_id, entry)| {
                                        let public = hex::decode(&entry.public_hex).ok()?;
                                        let secret = hex::decode(&entry.secret_hex).ok()?;
                                        Some((agent_id, SignKeypair { public, secret }))
                                    })
                                    .collect();
                                if entry_count > 0 && parsed.is_empty() {
                                    tracing::error!(
                                        path = %path.display(),
                                        entry_count,
                                        "agent-sign-keys entries failed hex decode; refusing empty recovery"
                                    );
                                    if !force {
                                        permissions_poisoned = true;
                                    }
                                    HashMap::new()
                                } else {
                                    parsed
                                }
                            }
                            Err(e) => {
                                tracing::error!(
                                    path = %path.display(),
                                    error = %e,
                                    "agent-sign-keys JSON parse failed; refusing silent empty recovery"
                                );
                                if !force {
                                    permissions_poisoned = true;
                                } else {
                                    tracing::warn!(
                                        path = %path.display(),
                                        "AEP_AGENT_SIGN_KEYS_FORCE_REGEN set; allowing empty store after parse failure"
                                    );
                                }
                                HashMap::new()
                            }
                        },
                        Err(e) => {
                            tracing::error!(
                                path = %path.display(),
                                error = %e,
                                "agent-sign-keys decrypt/open failed; refusing silent empty recovery"
                            );
                            if !force {
                                permissions_poisoned = true;
                            } else {
                                tracing::warn!(
                                    path = %path.display(),
                                    "AEP_AGENT_SIGN_KEYS_FORCE_REGEN set; allowing empty store after decrypt failure"
                                );
                            }
                            HashMap::new()
                        }
                    },
                    Err(e) => {
                        tracing::error!(
                            path = %path.display(),
                            error = %e,
                            "agent-sign-keys unreadable; refusing silent empty recovery"
                        );
                        if !force {
                            permissions_poisoned = true;
                        }
                        HashMap::new()
                    }
                }
            }
        } else {
            HashMap::new()
        };
        Self {
            data_dir: data_dir.to_path_buf(),
            path,
            keys,
            dirty: false,
            permissions_poisoned,
        }
    }

    fn force_regen() -> bool {
        std::env::var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
    }

    fn validate_agent_id(agent_id: &str) -> Result<(), BaseNodeError> {
        let t = agent_id.trim();
        if t.is_empty() {
            return Err(BaseNodeError::AgentIdEmpty);
        }
        if t.len() > 128 {
            return Err(BaseNodeError::AgentIdTooLong);
        }
        if t.chars().any(|c| {
            !(c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == ':')
        }) {
            return Err(BaseNodeError::AgentIdChars);
        }
        Ok(())
    }

    /// Lookup a provisioned agent sign key. Does not mint.
    /// AEP28-ENV-046: first-mint is not the identity issuer.
    pub fn get(&self, agent_id: &str) -> Result<SignKeypair, BaseNodeError> {
        Self::validate_agent_id(agent_id)?;
        if let Some(existing) = self.keys.get(agent_id) {
            return Ok(existing.clone());
        }
        if self.permissions_poisoned {
            tracing::error!(
                agent_id,
                "refusing get: agent-sign-keys load poisoned (permissions or corrupt seal)"
            );
            return Err(BaseNodeError::SignKeysPoisoned);
        }
        Err(BaseNodeError::SignKeyMissing { agent_id: agent_id.to_string() })
    }

    /// Operator provision: the only mint path for agent sign keys (AEP28-ENV-046).
    /// Idempotent when the agent already has a key unless AEP_AGENT_SIGN_KEYS_FORCE_REGEN=1.
    pub fn provision(&mut self, agent_id: &str) -> Result<SignKeypair, BaseNodeError> {
        Self::validate_agent_id(agent_id)?;
        let force = Self::force_regen();
        if self.permissions_poisoned && !force {
            tracing::error!(
                agent_id,
                "refusing provision: agent-sign-keys load poisoned (permissions or corrupt seal)"
            );
            return Err(BaseNodeError::SignKeysPoisoned);
        }
        if self.permissions_poisoned && force {
            tracing::warn!(
                agent_id,
                "AEP_AGENT_SIGN_KEYS_FORCE_REGEN set; clearing poison so operator provision can mint"
            );
            self.permissions_poisoned = false;
        }
        if let Some(existing) = self.keys.get(agent_id) {
            if !force {
                return Ok(existing.clone());
            }
        }
        let sign = generate_sign_keypair();
        self.keys.insert(agent_id.to_string(), sign.clone());
        self.dirty = true;
        Ok(sign)
    }

    /// Lookup only. First-mint is not the identity issuer (AEP28-ENV-046).
    pub fn get_or_create(&mut self, agent_id: &str) -> Result<SignKeypair, BaseNodeError> {
        self.get(agent_id)
    }

    pub fn public_for(&self, agent_id: &str) -> Option<Vec<u8>> {
        self.keys.get(agent_id).map(|k| k.public.clone())
    }

    pub fn flush(&mut self) -> std::io::Result<()> {
        if !self.dirty {
            return Ok(());
        }
        if self.permissions_poisoned {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "agent-sign-keys.json load poisoned; fix mode/seal or FORCE_REGEN before flush",
            ));
        }
        // Never overwrite a non-empty on-disk store with an empty in-memory map.
        if self.keys.is_empty() && self.path.exists() {
            let force = std::env::var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            if !force {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "refusing to flush empty agent-sign-keys over existing file (set AEP_AGENT_SIGN_KEYS_FORCE_REGEN=1 to wipe)",
                ));
            }
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
        let plain = serde_json::to_string_pretty(&file)?;
        write_sealed_secret(&self.data_dir, &self.path, &plain)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
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
    fn dock_kem_file_is_sealed_not_plaintext_secret() {
        let dir = tempfile::tempdir().expect("tempdir");
        let kem = load_or_create_dock_kem(dir.path());
        let raw = fs::read_to_string(dock_kem_path(dir.path())).expect("read");
        assert!(raw.contains("\"v\": 2") || raw.contains("\"v\":2"));
        assert!(raw.contains("aes-256-gcm"));
        assert!(!raw.contains(&hex::encode(&kem.secret)));
        assert!(dock_seal_key_path(dir.path()).exists());
    }

    #[test]
    fn agent_sign_keys_persist() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        let key = store.provision("AG-TEST").expect("key");
        store.flush().expect("flush");
        let reloaded = AgentSignKeyStore::load(dir.path());
        assert_eq!(
            reloaded.public_for("AG-TEST").as_deref(),
            Some(key.public.as_slice())
        );
        let raw = fs::read_to_string(agent_sign_keys_path(dir.path())).expect("read");
        assert!(!raw.contains(&hex::encode(&key.secret)));
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
        let seal_mode =
            fs::metadata(dock_seal_key_path(dir.path())).expect("meta").permissions().mode()
                & 0o777;
        assert_eq!(seal_mode, 0o600);
    }

    // Serialize env mutations across tests (cargo test runs in parallel).
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn corrupt_dock_kem_refuses_silent_regeneration() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_DOCK_KEM_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dock_kem_path(dir.path());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(&path, b"{not-valid-json").unwrap();
        restrict_secret_file_permissions(&path);
        let err = try_load_or_create_dock_kem(dir.path()).unwrap_err();
        assert!(
            err.to_string().contains("refusing silent regeneration"),
            "unexpected err: {err}"
        );
    }

    #[test]
    fn tm21_corrupt_agent_sign_keys_refuse_empty_recovery() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path()).unwrap();
        let path = agent_sign_keys_path(dir.path());
        fs::write(&path, b"{not-valid-json").unwrap();
        restrict_secret_file_permissions(&path);
        let mut store = AgentSignKeyStore::load(dir.path());
        assert!(
            store.get_or_create("AG-NEW").is_err(),
            "corrupt store must not mint keys"
        );
        let mut poisoned = store;
        poisoned.dirty = true;
        assert!(
            poisoned.flush().is_err(),
            "corrupt store must not flush empty over existing file"
        );
    }

    #[test]
    fn tm21_force_regen_allows_remint_after_corrupt() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path()).unwrap();
        let path = agent_sign_keys_path(dir.path());
        fs::write(&path, b"{broken").unwrap();
        restrict_secret_file_permissions(&path);
        std::env::set_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN", "1");
        let mut store = AgentSignKeyStore::load(dir.path());
        let key = store.provision("AG-ROTATE").expect("remint with force");
        store.flush().expect("flush after force");
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let reloaded = AgentSignKeyStore::load(dir.path());
        assert_eq!(
            reloaded.public_for("AG-ROTATE").as_deref(),
            Some(key.public.as_slice())
        );
    }

    #[test]
    fn force_regen_rotates_corrupt_dock_kem() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dock_kem_path(dir.path());
        fs::create_dir_all(dir.path()).unwrap();
        fs::write(&path, b"{broken").unwrap();
        restrict_secret_file_permissions(&path);
        std::env::set_var("AEP_DOCK_KEM_FORCE_REGEN", "1");
        let kem = try_load_or_create_dock_kem(dir.path()).expect("force regen");
        assert!(!kem.public.is_empty());
        std::env::remove_var("AEP_DOCK_KEM_FORCE_REGEN");
        let again = try_load_or_create_dock_kem(dir.path()).expect("reload");
        assert_eq!(kem.public, again.public);
    }

    #[test]
    fn first_mint_get_or_create_is_not_the_issuer() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        let err = store.get_or_create("AG-NEW").expect_err("first-mint must not issue");
        assert!(
            err.to_string().contains("no provisioned sign key"),
            "unexpected err: {err}"
        );
        assert!(store.public_for("AG-NEW").is_none());
    }

    #[test]
    fn provision_is_the_identity_issuer() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        let key = store.provision("AG-OP").expect("provision");
        store.flush().expect("flush");
        let got = store.get("AG-OP").expect("get after provision");
        assert_eq!(got.public, key.public);
        let reloaded = AgentSignKeyStore::load(dir.path());
        assert_eq!(
            reloaded.public_for("AG-OP").as_deref(),
            Some(key.public.as_slice())
        );
    }

    #[test]
    fn empty_agent_id_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        assert!(store.provision("").is_err());
        assert!(store.provision("   ").is_err());
        assert!(store.get("").is_err());
    }

    #[test]
    fn provision_idempotent_without_force() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let mut store = AgentSignKeyStore::load(dir.path());
        let a = store.provision("AG-SAME").expect("a");
        let b = store.provision("AG-SAME").expect("b");
        assert_eq!(a.public, b.public);
        assert_eq!(a.secret, b.secret);
    }

    #[test]
    fn migrates_legacy_plaintext_to_sealed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dock_kem_path(dir.path());
        let kem = generate_kem_keypair();
        let legacy = KemKeyFile {
            public_hex: hex::encode(&kem.public),
            secret_hex: hex::encode(&kem.secret),
        };
        write_secret_json(&path, &serde_json::to_string_pretty(&legacy).unwrap()).unwrap();
        let loaded = try_load_or_create_dock_kem(dir.path()).expect("load legacy");
        assert_eq!(loaded.public, kem.public);
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("aes-256-gcm"));
        assert!(!raw.contains(&legacy.secret_hex));
    }

    #[cfg(unix)]
    #[test]
    fn world_readable_dock_kem_refuses_load() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_DOCK_KEM_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let _kem = load_or_create_dock_kem(dir.path());
        let path = dock_kem_path(dir.path());
        use std::os::unix::fs::PermissionsExt;
        let mut p = fs::metadata(&path).expect("meta").permissions();
        p.set_mode(0o644);
        fs::set_permissions(&path, p).expect("chmod 0644");
        let err = try_load_or_create_dock_kem(dir.path()).unwrap_err();
        assert!(
            err.to_string().contains("world/group-readable") || err.to_string().contains("refusing load"),
            "unexpected err: {err}"
        );
    }
}
