//! CAW kernel dock identity.
//!
//! AEP-CAW refuses to start a host command while the Base Node kernel is silent.
//! The docks accept only sealed LatticeChannelFrames, so the CAW probe proves a
//! live kernel with one sealed root:ping on the validation dock and passes only
//! when that frame is admitted. The frame is signed as caw-kernel-dock.
//!
//! Every boot provisions that identity the same way the Data Dock server
//! identity is provisioned: an agent sign key in the key store and a system tier
//! task manifest. The key is minted once and a later boot reuses it. The
//! identity grants nothing by itself. Admit still needs root:ping granted to
//! caw-kernel-dock in the lattice and in a caw-*.gap hub policy.

use crate::task_manifest::{TaskManifestTrust, TaskManifestV1};
use crate::docking::DockingRuntime;
use serde_json::json;
use std::path::{Path, PathBuf};

pub const CAW_KERNEL_DOCK_AGENT: &str = "caw-kernel-dock";
pub const CAW_KERNEL_DOCK_SESSION: &str = "caw-kernel-dock-session";
pub const CAW_KERNEL_DOCK_CHANNEL: &str = "ch-caw-kernel-dock";

/// Mint the caw-kernel-dock sign key when it is missing, write its task
/// manifest and reload the manifest store. A second boot keeps the key.
pub fn provision_caw_kernel_dock_identity(
    runtime: &DockingRuntime,
    data_dir: &Path,
) -> Result<(), crate::BaseNodeError> {
    {
        let mut store = match runtime.keys.agent_sign_keys.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        store.provision(CAW_KERNEL_DOCK_AGENT)?;
        store.flush()?;
    }
    let manifest_dir = std::env::var("AEP_TASK_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("ucb").join("manifests"));
    std::fs::create_dir_all(&manifest_dir).map_err(|e| {
        crate::BaseNodeError::Io(format!("caw-kernel-dock manifest dir: {e}"))
    })?;
    let manifest = TaskManifestV1 {
        manifest_version: String::from("1"),
        id: String::from("m-caw-kernel-dock"),
        agent_id: String::from(CAW_KERNEL_DOCK_AGENT),
        session_id: Some(String::from(CAW_KERNEL_DOCK_SESSION)),
        intent: json!({ "op": "caw-kernel-dock" }),
        trust: TaskManifestTrust {
            tier: String::from("system"),
        },
        agentmesh: None,
        provisional: false,
        synthesized_by: String::from("provided"),
        promotion_required: Vec::new(),
    };
    let path = manifest_dir.join("caw-kernel-dock.json");
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| {
        crate::BaseNodeError::Io(format!("caw-kernel-dock manifest encode: {e}"))
    })?;
    std::fs::write(&path, text).map_err(|e| {
        crate::BaseNodeError::Io(format!("caw-kernel-dock manifest write: {e}"))
    })?;
    let mut manifests = match runtime.admit.manifests.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    manifests.reload();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docking_fixtures::data_dock_runtime as fixture_runtime;
    use crate::open_lattice_db;

    fn public_hex(runtime: &DockingRuntime) -> String {
        let store = runtime.keys.agent_sign_keys.lock().expect("keys");
        hex::encode(store.public_for(CAW_KERNEL_DOCK_AGENT).expect("caw-kernel-dock key"))
    }

    #[test]
    fn boot_provisions_key_and_system_manifest() {
        let _guard = crate::dock_keys::KEYS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let (dir, runtime) = fixture_runtime();
        provision_caw_kernel_dock_identity(&runtime, dir.path()).expect("provision");
        assert!(!public_hex(&runtime).is_empty());
        let manifests = runtime.admit.manifests.lock().expect("manifests");
        let m = manifests.get(CAW_KERNEL_DOCK_AGENT).expect("manifest loaded");
        assert_eq!(m.trust.tier, "system");
        assert_eq!(m.session_id.as_deref(), Some(CAW_KERNEL_DOCK_SESSION));
        assert!(!m.provisional);
    }

    #[test]
    fn second_boot_does_not_rotate_the_key() {
        let _guard = crate::dock_keys::KEYS_ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        std::env::remove_var("AEP_AGENT_SIGN_KEYS_FORCE_REGEN");
        let (dir, first) = fixture_runtime();
        provision_caw_kernel_dock_identity(&first, dir.path()).expect("first boot");
        let first_key = public_hex(&first);
        drop(first);
        let conn = open_lattice_db(&dir.path().join("aep-action-lattice.db")).expect("reopen");
        let second = DockingRuntime::with_data_dir(
            dir.path().join("sockets").to_string_lossy().into_owned(),
            conn,
            &[],
            dir.path(),
        )
        .expect("second runtime");
        provision_caw_kernel_dock_identity(&second, dir.path()).expect("second boot");
        assert_eq!(first_key, public_hex(&second));
    }
}
