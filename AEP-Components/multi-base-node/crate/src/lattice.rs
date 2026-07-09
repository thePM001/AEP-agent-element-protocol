//! Lattice channel ID templates for multi-base-node registry.

/// Federation control plane channel (shared across nodes).
pub const FEDERATION_CHANNEL: &str = "ex.aep.multi_base_node";

/// Policy bundle sync channel between Base Node kernels.
pub const GAP_SYNC_CHANNEL: &str = "ex.aep.gap_sync";

/// Per-node lattice channel from `node_id`.
pub fn node_channel(node_id: &str) -> String {
    format!("ex.aep.node.{node_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_channel_is_template_based() {
        assert_eq!(node_channel("primary"), "ex.aep.node.primary");
        assert_eq!(node_channel("edge-replica"), "ex.aep.node.edge-replica");
        assert!(!node_channel("primary").contains("nla-"));
    }
}