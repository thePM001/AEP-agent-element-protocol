//! Simplified Yggdrasil-style routing table for POTOMITAN mesh fallback.

use crate::peer::MeshPeer;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Adapted from Yggdrasil routing concepts: node key -> next hop + path cost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteEntry {
    pub destination: String,
    pub next_hop: String,
    pub cost: u32,
    pub via_endpoint: String,
}

#[derive(Debug, Default, Clone)]
pub struct RoutingTable {
    routes: BTreeMap<String, RouteEntry>,
}

impl RoutingTable {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn rebuild_from_peers(peers: &[MeshPeer]) -> Self {
        let mut table = Self::new();
        for peer in peers.iter().filter(|p| p.active) {
            table.routes.insert(
                peer.node_id.clone(),
                RouteEntry {
                    destination: peer.node_id.clone(),
                    next_hop: peer.node_id.clone(),
                    cost: 1,
                    via_endpoint: peer.endpoint.clone(),
                },
            );
        }
        table
    }

    pub fn route_to(&self, destination: &str) -> Option<&RouteEntry> {
        self.routes.get(destination)
    }

    pub fn routes(&self) -> Vec<RouteEntry> {
        self.routes.values().cloned().collect()
    }

    pub fn reachable_destinations(&self) -> u32 {
        self.routes.len() as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer::MeshPeer;

    #[test]
    fn builds_direct_routes_for_active_peers() {
        let peers = vec![MeshPeer {
            node_id: "pot-01".into(),
            endpoint: "tls://10.0.0.2:12345".into(),
            public_key_hex: None,
            active: true,
        }];
        let table = RoutingTable::rebuild_from_peers(&peers);
        assert_eq!(table.reachable_destinations(), 1);
        assert_eq!(table.route_to("pot-01").unwrap().via_endpoint, "tls://10.0.0.2:12345");
    }
}