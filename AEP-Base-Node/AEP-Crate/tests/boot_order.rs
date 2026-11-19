//! Boot order of the daemon: the identity of the CAW kernel dock exists before any
//! docking socket does. A CAW that sees the validation socket may sign its root:ping
//! at once, so the sign key of caw-kernel-dock and its task manifest must already be
//! in the data folder at that moment.

#![allow(clippy::expect_used)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use aep_base_node::caw_kernel_dock::CAW_KERNEL_DOCK_AGENT;
use aep_base_node::dock_keys::AgentSignKeyStore;

const BOOTS: usize = 3;
const BOOT_LIMIT: Duration = Duration::from_secs(30);

struct Daemon(Child);

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn policy_system_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../AEP-Policy-System")
        .canonicalize()
        .expect("AEP-Policy-System beside the Base Node")
}

/// One data folder with a config and a lattice that grants root:ping to the CAW
/// kernel dock, as a deployment of the CAW writes them.
fn data_folder(dir: &Path) -> PathBuf {
    let sockets = dir.join("sockets");
    std::fs::create_dir_all(&sockets).expect("sockets folder");
    std::fs::create_dir_all(dir.join("ucb").join("manifests")).expect("manifest folder");
    let hub = dir.join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&hub).expect("hub folder");
    std::fs::write(
        hub.join("caw-kernel-dock.gap"),
        "address:\n  domain: dev.aep.caw\n  id: kernel-dock.v1\n\nmetadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: caw-kernel-dock\n      action: root:ping\n",
    )
    .expect("hub grant");
    let config = dir.join("base-node.json");
    let text = serde_json::json!({
        "version": "2.9",
        "base_node": {
            "socket_base": sockets,
            "lattice_db": dir.join("action-lattice.db"),
            "lrps": ["dynaep-action-lattice", "lattice-channel-default"],
            "internet_up": true
        }
    });
    std::fs::write(&config, text.to_string()).expect("config");
    std::fs::write(
        dir.join("lattice.yaml"),
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"caw-kernel-dock\"]\n",
    )
    .expect("lattice");
    config
}

fn start(dir: &Path, config: &Path) -> Daemon {
    let log = std::fs::File::create(dir.join("base-node.log")).expect("log file");
    let child = Command::new(env!("CARGO_BIN_EXE_aep-base-node"))
        .arg("--daemon")
        .arg("--config")
        .arg(config)
        .env("AEP_DATA", dir)
        .env("AEP_SOCKET_BASE", dir.join("sockets"))
        .env("AEP_TASK_MANIFEST_DIR", dir.join("ucb").join("manifests"))
        .env("AEP_POLICY_SYSTEM_DIR", policy_system_dir())
        .env("DATA_DOCK_HOST", "127.0.0.1")
        .env("DATA_DOCK_PORT", "0")
        .env_remove("AEP_LATTICE_TRANSPORT")
        .env_remove("AEP_AGENT_SIGN_KEYS_FORCE_REGEN")
        .stdout(Stdio::null())
        .stderr(Stdio::from(log))
        .spawn()
        .expect("start aep-base-node");
    Daemon(child)
}

#[test]
fn the_caw_kernel_dock_identity_exists_before_the_validation_socket() {
    for boot in 1..=BOOTS {
        let dir = tempfile::tempdir().expect("data folder");
        let config = data_folder(dir.path());
        let validation = dir.path().join("sockets").join("validation");
        let manifest = dir
            .path()
            .join("ucb")
            .join("manifests")
            .join("caw-kernel-dock.json");
        let mut daemon = start(dir.path(), &config);
        let began = Instant::now();
        // The first sight of the socket is the moment that counts, so the poll does
        // not sleep between looks.
        while !validation.exists() {
            if let Some(status) = daemon.0.try_wait().expect("daemon status") {
                let log =
                    std::fs::read_to_string(dir.path().join("base-node.log")).unwrap_or_default();
                panic!("boot {boot}: the daemon left with {status} before it opened the validation socket:\n{log}");
            }
            assert!(
                began.elapsed() < BOOT_LIMIT,
                "boot {boot}: the validation socket did not open in {BOOT_LIMIT:?}"
            );
            std::hint::spin_loop();
        }
        let key = AgentSignKeyStore::load(dir.path()).get(CAW_KERNEL_DOCK_AGENT);
        let has_manifest = manifest.exists();
        drop(daemon);
        assert!(
            key.is_ok(),
            "boot {boot}: the validation socket was open while the sign key of {CAW_KERNEL_DOCK_AGENT} was missing: {:?}",
            key.err()
        );
        assert!(
            has_manifest,
            "boot {boot}: the validation socket was open while the task manifest of {CAW_KERNEL_DOCK_AGENT} was missing"
        );
    }
}
