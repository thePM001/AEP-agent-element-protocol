//! Key mint: the operator provision CLI and the first mint for data-dock.
//! Provision is the only path that creates an agent sign key. It is idempotent
//! unless AEP_AGENT_SIGN_KEYS_FORCE_REGEN=1, so a reboot never rotates a key.

use aep_lattice_crypto::{generate_sign_keypair, SignKeypair};
use std::path::Path;

use crate::dock_keys_store::AgentSignKeyStore;
use crate::BaseNodeError;

impl AgentSignKeyStore {
 /// Operator provision: the only mint path for agent sign keys.
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
}

/// Operator CLI mint for `aep-base-node --provision-agent-sign-key`.
pub fn provision_agent_sign_key(data_dir: &Path, agent_id: &str) -> Result<SignKeypair, BaseNodeError> {
    let mut store = AgentSignKeyStore::load(data_dir);
    let sign = store.provision(agent_id)?;
    store.flush()?;
    Ok(sign)
}

/// First mint for the Data Dock server agent. A key that already exists is
/// returned unchanged, so a second boot does not rotate it.
pub fn first_mint_data_dock(store: &mut AgentSignKeyStore, agent_id: &str) -> Result<SignKeypair, BaseNodeError> {
    let sign = store.provision(agent_id)?;
    store.flush()?;
    Ok(sign)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dock_keys::KEYS_ENV_LOCK as ENV_LOCK;
    use crate::dock_keys_store::agent_sign_keys_path;
    use std::fs;

    fn restrict_secret_file_permissions(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
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
    fn cli_provision_persists_and_is_idempotent() {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let dir = tempfile::tempdir().expect("tempdir");
        let a = provision_agent_sign_key(dir.path(), "AG-CLI").expect("first");
        let b = provision_agent_sign_key(dir.path(), "AG-CLI").expect("second");
        assert_eq!(a.public, b.public);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(agent_sign_keys_path(dir.path())).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }
}
