// HVVCAS: multi-base-node-core domain:aep.multi-base-node
pub mod error;
pub mod failover;
pub mod lattice;
pub mod registry;
pub mod sync;
pub mod types;

pub use error::{RegistryError, Result};
pub use failover::{promote_replica, PromotionResult};
pub use lattice::{node_channel, FEDERATION_CHANNEL, GAP_SYNC_CHANNEL};
pub use registry::{
    get_node, list_nodes, load_registry, node_record_from_map, parse_registry_json, register_node,
    save_registry, update_gap_checkpoint, validate_node, validate_registry,
};
pub use sync::merkle_root_hex;
pub use types::{AgentstreamTopology, NodeRecord, NodeRole, NodesRegistryV2};
