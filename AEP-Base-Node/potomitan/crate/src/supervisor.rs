//! POTOMITAN mesh supervisor: failover when internet is unavailable.

use crate::peer::{PeerRegistry, MESH_PEERS_FILE};
use crate::routing::RoutingTable;
use crate::{detect_network_mode, status, MeshMode, MeshStatus};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct MeshSupervisor {
    pub registry: PeerRegistry,
    pub routing: RoutingTable,
    pub internet_up: bool,
    pub config_path: PathBuf,
    pub load_error: Option<String>,
}

impl MeshSupervisor {
    pub fn load(data_dir: &Path, internet_up: bool) -> Self {
        let config_path = data_dir.join(MESH_PEERS_FILE);
        let (registry, load_error) = match PeerRegistry::load(&config_path) {
            Ok(reg) => (reg, None),
            Err(e) => (PeerRegistry::new(), Some(e.to_string())),
        };
        let routing = RoutingTable::rebuild_from_peers(&registry.list());
        Self {
            registry,
            routing,
            internet_up,
            config_path,
            load_error,
        }
    }

    pub fn peer_count(&self) -> u32 {
        self.registry.active_count()
    }

    pub fn mesh_mode(&self) -> MeshMode {
        detect_network_mode(self.internet_up, self.peer_count())
    }

    pub fn mesh_status(&self) -> MeshStatus {
        status(self.mesh_mode(), self.peer_count())
    }

    pub fn should_use_mesh_transport(&self) -> bool {
        matches!(self.mesh_mode(), MeshMode::Potomitan)
    }

    pub fn upsert_peer(&mut self, peer: crate::peer::MeshPeer) -> Result<(), crate::peer::PeerError> {
        self.registry.upsert(peer);
        self.routing = RoutingTable::rebuild_from_peers(&self.registry.list());
        self.registry.save(&self.config_path)?;
        Ok(())
    }

    pub fn remove_peer(&mut self, node_id: &str) -> Result<(), crate::peer::PeerError> {
        self.registry.remove(node_id);
        self.routing = RoutingTable::rebuild_from_peers(&self.registry.list());
        self.registry.save(&self.config_path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer::MeshPeer;

    #[test]
    fn failover_to_potomitan_when_internet_down_and_peers_exist() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut sup = MeshSupervisor::load(dir.path(), true);
        sup.upsert_peer(MeshPeer {
            node_id: "peer-1".into(),
            endpoint: "tls://mesh:1".into(),
            public_key_hex: None,
            active: true,
        })
        .expect("upsert");
        sup.internet_up = false;
        assert_eq!(sup.mesh_mode(), MeshMode::Potomitan);
        assert!(sup.should_use_mesh_transport());
    }
}