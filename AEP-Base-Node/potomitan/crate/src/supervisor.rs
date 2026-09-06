//! POTOMITAN mesh supervisor: failover when internet is unavailable.
//! AEP28-ENV-055: binds the mesh packet plane when mesh transport is selected.

use crate::packet::MeshPacket;
use crate::peer::{PeerRegistry, MESH_PEERS_FILE};
use crate::plane::MeshPacketPlane;
use crate::routing::RoutingTable;
use crate::transport::{MemoryFabric, MemoryTransport, PlaneError, UdpTransport};
use crate::{detect_network_mode, status, MeshMode, MeshStatus};
use std::path::{Path, PathBuf};

pub enum BoundPacketPlane {
    Memory(MeshPacketPlane<MemoryTransport>),
    Udp(MeshPacketPlane<UdpTransport>),
}

pub struct MeshSupervisor {
    pub registry: PeerRegistry,
    pub routing: RoutingTable,
    pub internet_up: bool,
    pub config_path: PathBuf,
    pub load_error: Option<String>,
    pub plane: Option<BoundPacketPlane>,
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
            plane: None,
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

    fn sync_plane_routes(&mut self) {
        match self.plane.as_mut() {
            Some(BoundPacketPlane::Memory(p)) => p.set_routing(self.routing.clone()),
            Some(BoundPacketPlane::Udp(p)) => p.set_routing(self.routing.clone()),
            None => {}
        }
    }

    pub fn open_memory_plane(&mut self, local_node_id: String, fabric: MemoryFabric) {
        let transport = MemoryTransport::bind(fabric, &local_node_id);
        self.plane = Some(BoundPacketPlane::Memory(MeshPacketPlane::new(
            local_node_id,
            transport,
            self.routing.clone(),
        )));
    }

    pub fn open_udp_plane(&mut self, local_node_id: String, bind: &str) -> Result<String, PlaneError> {
        let transport = UdpTransport::bind(bind)?;
        let endpoint = transport.local_udp_endpoint().to_string();
        self.plane = Some(BoundPacketPlane::Udp(MeshPacketPlane::new(
            local_node_id,
            transport,
            self.routing.clone(),
        )));
        Ok(endpoint)
    }

    pub fn send_packet(&mut self, dst: &str, payload: Vec<u8>) -> Result<u64, PlaneError> {
        if self.should_use_mesh_transport() == false && self.plane.is_some() {
            // Plane may still send while internet is up; supervisor prefers internet
            // only as a mode signal. Packet plane remains available when bound.
        }
        match self.plane.as_mut() {
            Some(BoundPacketPlane::Memory(p)) => p.send(dst, payload),
            Some(BoundPacketPlane::Udp(p)) => p.send(dst, payload),
            None => Err(PlaneError::Io("packet plane not bound".into())),
        }
    }

    pub fn poll_packet(&mut self) -> Result<Option<MeshPacket>, PlaneError> {
        match self.plane.as_mut() {
            Some(BoundPacketPlane::Memory(p)) => p.poll(),
            Some(BoundPacketPlane::Udp(p)) => p.poll(),
            None => Ok(None),
        }
    }

    pub fn upsert_peer(&mut self, peer: crate::peer::MeshPeer) -> Result<(), crate::peer::PeerError> {
        self.registry.upsert(peer);
        self.routing = RoutingTable::rebuild_from_peers(&self.registry.list());
        self.sync_plane_routes();
        self.registry.save(&self.config_path)?;
        Ok(())
    }

    pub fn remove_peer(&mut self, node_id: &str) -> Result<(), crate::peer::PeerError> {
        self.registry.remove(node_id);
        self.routing = RoutingTable::rebuild_from_peers(&self.registry.list());
        self.sync_plane_routes();
        self.registry.save(&self.config_path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer::MeshPeer;
    use crate::transport::MemoryFabric;

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

    #[test]
    fn load_error_falls_back_to_empty_registry() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(MESH_PEERS_FILE);
        std::fs::write(&path, "not-json{").expect("write");
        let sup = MeshSupervisor::load(dir.path(), false);
        assert!(sup.load_error.is_some());
        assert_eq!(sup.peer_count(), 0);
        assert_eq!(sup.mesh_mode(), MeshMode::Offline);
    }

    #[test]
    fn memory_plane_send_recv_through_supervisor() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(dir.path().join("a")).expect("a");
        std::fs::create_dir_all(dir.path().join("b")).expect("b");
        let fabric = MemoryFabric::new();
        let mut a = MeshSupervisor::load(&dir.path().join("a"), false);
        let mut b = MeshSupervisor::load(&dir.path().join("b"), false);
        a.upsert_peer(MeshPeer {
            node_id: "b".into(),
            endpoint: "mem://b".into(),
            public_key_hex: None,
            active: true,
        })
        .expect("upsert a");
        b.upsert_peer(MeshPeer {
            node_id: "a".into(),
            endpoint: "mem://a".into(),
            public_key_hex: None,
            active: true,
        })
        .expect("upsert b");
        a.open_memory_plane("a".into(), fabric.clone());
        b.open_memory_plane("b".into(), fabric);
        a.send_packet("b", b"mesh-hi".to_vec()).expect("send");
        let got = b.poll_packet().expect("poll").expect("pkt");
        assert_eq!(got.payload, b"mesh-hi");
        assert_eq!(got.src, "a");
    }
}
