//! POTOMITAN peer registry (Yggdrasil-inspired node list).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use thiserror::Error;

pub const MESH_PEERS_FILE: &str = "mesh-peers.json";

#[derive(Debug, Error)]
pub enum PeerError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeshPeer {
    pub node_id: String,
    pub endpoint: String,
    #[serde(default)]
    pub public_key_hex: Option<String>,
    #[serde(default = "default_active")]
    pub active: bool,
}

fn default_active() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MeshPeerFile {
    pub version: String,
    pub peers: Vec<MeshPeer>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

impl Default for MeshPeerFile {
    fn default() -> Self {
        Self {
            version: "2.8.0".into(),
            peers: Vec::new(),
            updated_at: None,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct PeerRegistry {
    peers: BTreeMap<String, MeshPeer>,
}

impl PeerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_peers(peers: Vec<MeshPeer>) -> Self {
        let mut reg = Self::new();
        for peer in peers {
            reg.upsert(peer);
        }
        reg
    }

    pub fn load(path: &Path) -> Result<Self, PeerError> {
        if !path.exists() {
            return Ok(Self::new());
        }
        let raw = fs::read_to_string(path)?;
        let file: MeshPeerFile = serde_json::from_str(&raw)?;
        Ok(Self::from_peers(file.peers))
    }

    pub fn save(&self, path: &Path) -> Result<MeshPeerFile, PeerError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let file = MeshPeerFile {
            version: "2.8.0".into(),
            peers: self.peers.values().cloned().collect(),
            updated_at: Some(chrono_lite_now()),
        };
        fs::write(path, format!("{}\n", serde_json::to_string_pretty(&file)?))?;
        restrict_mesh_peers_permissions(path);
        Ok(file)
    }

    pub fn upsert(&mut self, peer: MeshPeer) {
        self.peers.insert(peer.node_id.clone(), peer);
    }

    pub fn remove(&mut self, node_id: &str) -> bool {
        self.peers.remove(node_id).is_some()
    }

    pub fn active_count(&self) -> u32 {
        self.peers.values().filter(|p| p.active).count() as u32
    }

    pub fn list(&self) -> Vec<MeshPeer> {
        self.peers.values().cloned().collect()
    }
}

fn restrict_mesh_peers_permissions(path: &Path) {
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

fn chrono_lite_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_restricts_mesh_peers_file_permissions() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(MESH_PEERS_FILE);
        let mut reg = PeerRegistry::new();
        reg.upsert(MeshPeer {
            node_id: "node-a".into(),
            endpoint: "tls://peer.a:12345".into(),
            public_key_hex: None,
            active: true,
        });
        reg.save(&path).expect("save");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn registry_counts_active_peers() {
        let mut reg = PeerRegistry::new();
        reg.upsert(MeshPeer {
            node_id: "node-a".into(),
            endpoint: "tls://peer.a:12345".into(),
            public_key_hex: None,
            active: true,
        });
        reg.upsert(MeshPeer {
            node_id: "node-b".into(),
            endpoint: "tls://peer.b:12345".into(),
            public_key_hex: None,
            active: false,
        });
        assert_eq!(reg.active_count(), 1);
    }
}