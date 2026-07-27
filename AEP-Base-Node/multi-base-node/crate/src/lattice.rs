//! Lattice channel ID templates for multi-base-node registry.

/// Federation control plane channel (shared across nodes).
pub const FEDERATION_CHANNEL: &str = "aep.multi_base_node";

/// Policy bundle sync channel between Base Node kernels.
pub const GAP_SYNC_CHANNEL: &str = "aep.gap_sync";

/// Per-node lattice channel from `node_id`.
pub fn node_channel(node_id: &str) -> String {
    format!("aep.node.{node_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_channel_is_template_based() {
        assert_eq!(node_channel("primary"), "aep.node.primary");
        assert_eq!(node_channel("edge-replica"), "aep.node.edge-replica");
        assert!(!node_channel("primary").contains("nla-"));
    }
}