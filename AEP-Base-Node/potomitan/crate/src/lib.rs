//! POTOMITAN provides mesh fallback when normal internet is unavailable.
//!
//! Adaptation source: https://github.com/yggdrasil-network/yggdrasil-go (MIT)

pub mod peer;
pub mod routing;
pub mod supervisor;

pub use peer::{MeshPeer, MeshPeerFile, PeerRegistry, MESH_PEERS_FILE};
pub use routing::{RouteEntry, RoutingTable};
pub use supervisor::MeshSupervisor;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshMode {
    Internet,
    Potomitan,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeshStatus {
    pub mode: MeshMode,
    pub peers: u32,
    pub reachable: bool,
    pub routes: u32,
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

pub fn status(mode: MeshMode, peers: u32) -> MeshStatus {
    let reachable = match mode {
        MeshMode::Internet => true,
        MeshMode::Potomitan => peers > 0,
        MeshMode::Offline => false,
    };
    MeshStatus {
        mode,
        peers,
        reachable,
        routes: peers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internet_available_uses_internet_mode() {
        assert_eq!(detect_network_mode(true, 0), MeshMode::Internet);
        assert!(status(MeshMode::Internet, 0).reachable);
    }

    #[test]
    fn mesh_fallback_when_internet_down() {
        assert_eq!(detect_network_mode(false, 3), MeshMode::Potomitan);
        assert!(status(MeshMode::Potomitan, 3).reachable);
    }

    #[test]
    fn offline_when_no_internet_and_no_peers() {
        assert_eq!(detect_network_mode(false, 0), MeshMode::Offline);
        assert!(!status(MeshMode::Offline, 0).reachable);
    }
}