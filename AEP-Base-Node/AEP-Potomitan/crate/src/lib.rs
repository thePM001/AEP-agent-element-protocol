//! POTOMITAN provides mesh fallback when normal internet is unavailable.
//!
//! This crate ships a mesh packet plane (encode, decode, hop_limit,
//! transport, send, recv and forward). It is not registry-plus-mode.
//!
//! Adaptation source: https://github.com/yggdrasil-network/yggdrasil-go (MIT)

pub mod packet;
pub mod peer;
pub mod plane;
pub mod routing;
pub mod supervisor;
pub mod transport;

pub use packet::{
    hop_limit_allows_forward, MeshPacket, PacketError, DEFAULT_HOP_LIMIT, PACKET_MAGIC,
    PACKET_VERSION,
};
pub use peer::{MeshPeer, MeshPeerFile, PeerError, PeerRegistry, MESH_PEERS_FILE};
pub use plane::{ForwardOutcome, MeshPacketPlane};
pub use routing::{RouteEntry, RoutingTable};
pub use supervisor::MeshSupervisor;
pub use transport::{
    datagram_target, DatagramTarget, MemoryFabric, MemoryTransport, MeshTransport, PlaneError,
    UdpTransport,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshMode {
    Internet,
    Potomitan,
    Offline,
}

/// What a bound packet plane proved. A peer file proves nothing: the mesh counts as
/// reachable only when a plane is bound and has accepted a datagram from a known peer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaneProof {
    /// A packet plane is bound to a transport.
    pub bound: bool,
    /// Known peers whose datagrams the bound plane accepted. A datagram from a sender
    /// that is not a known peer is dropped and proves nothing.
    pub proven_peers: u32,
    /// Routes of the bound plane.
    pub routes: u32,
}

impl PlaneProof {
    /// No plane is bound.
    pub fn unbound() -> Self {
        Self::default()
    }

    /// A plane is bound and a known peer reached it.
    pub fn authenticated(&self) -> bool {
        self.bound && self.proven_peers > 0
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshStatus {
    pub mode: MeshMode,
    /// Active peers on file. A count, not a proof of reach.
    pub peers: u32,
    /// The node can reach anything in its mode. In POTOMITAN mode only a bound and
    /// authenticated plane makes this true.
    pub reachable: bool,
    /// Routes of the bound plane, zero when no plane is bound.
    pub routes: u32,
    /// A packet plane is bound.
    pub packet_plane: bool,
    /// Known peers whose datagrams the bound plane accepted.
    pub proven_peers: u32,
}

#[derive(Debug, Error)]
pub enum MeshError {
    #[error("mesh unavailable")]
    Unavailable,
}

pub fn detect_network_mode(internet_up: bool, mesh_peers: u32) -> MeshMode {
    if internet_up {
        MeshMode::Internet
    } else if mesh_peers > 0 {
        MeshMode::Potomitan
    } else {
        MeshMode::Offline
    }
}

/// Status of the mesh in `mode`. Routes, the plane flag and POTOMITAN reach come only
/// from what the bound plane proved, never from the peer count.
pub fn status(mode: MeshMode, peers: u32, plane: PlaneProof) -> MeshStatus {
    let reachable = match mode {
        MeshMode::Internet => true,
        MeshMode::Potomitan => plane.authenticated(),
        MeshMode::Offline => false,
    };
    MeshStatus {
        mode,
        peers,
        reachable,
        routes: if plane.bound { plane.routes } else { 0 },
        packet_plane: plane.bound,
        proven_peers: if plane.bound { plane.proven_peers } else { 0 },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proven(peers: u32) -> PlaneProof {
        PlaneProof {
            bound: true,
            proven_peers: peers,
            routes: peers,
        }
    }

    #[test]
    fn internet_available_uses_internet_mode() {
        assert_eq!(detect_network_mode(true, 0), MeshMode::Internet);
        assert!(status(MeshMode::Internet, 0, PlaneProof::unbound()).reachable);
        assert!(!status(MeshMode::Internet, 0, PlaneProof::unbound()).packet_plane);
    }

    #[test]
    fn mesh_fallback_when_internet_down() {
        assert_eq!(detect_network_mode(false, 3), MeshMode::Potomitan);
        let s = status(MeshMode::Potomitan, 3, proven(2));
        assert!(s.reachable);
        assert!(s.packet_plane);
        assert_eq!(s.proven_peers, 2);
    }

    #[test]
    fn peer_file_alone_never_reports_the_mesh_reachable() {
        let unbound = status(MeshMode::Potomitan, 3, PlaneProof::unbound());
        assert!(!unbound.reachable);
        assert!(!unbound.packet_plane);
        assert_eq!(unbound.routes, 0);
        let bound_unproven = status(
            MeshMode::Potomitan,
            3,
            PlaneProof {
                bound: true,
                proven_peers: 0,
                routes: 3,
            },
        );
        assert!(!bound_unproven.reachable);
        assert!(bound_unproven.packet_plane);
        assert_eq!(bound_unproven.routes, 3);
    }

    #[test]
    fn offline_when_no_internet_and_no_peers() {
        assert_eq!(detect_network_mode(false, 0), MeshMode::Offline);
        assert!(!status(MeshMode::Offline, 0, proven(1)).reachable);
    }
}
