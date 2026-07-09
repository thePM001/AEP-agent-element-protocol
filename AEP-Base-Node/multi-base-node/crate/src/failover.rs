// HVVCAS: promote_replica domain:aep.multi-base-node
use crate::error::{RegistryError, Result};
use crate::registry::validate_registry;
use crate::types::{NodeRole, NodesRegistryV2};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PromotionResult {
    pub promoted_node_id: String,
    pub demoted_node_id: String,
    pub previous_role: String,
    pub new_role: String,
}

pub fn promote_replica(registry: &mut NodesRegistryV2, from_node_id: &str) -> Result<PromotionResult> {
    let candidate_idx = registry
        .nodes
        .iter()
        .position(|n| n.node_id == from_node_id)
        .ok_or_else(|| RegistryError::NotFound(from_node_id.to_string()))?;

    let candidate_role = registry.nodes[candidate_idx].role;
    match candidate_role {
        NodeRole::Primary => {
            return Err(RegistryError::Invalid(format!(
                "{from_node_id} is already primary"
            )));
        }
        NodeRole::ScienceIsolated => {
            return Err(RegistryError::Invalid(
                "science-isolated nodes cannot be promoted".into(),
            ));
        }
        NodeRole::Replica | NodeRole::Edge => {}
    }

    let primary_idx = registry
        .nodes
        .iter()
        .position(|n| n.role == NodeRole::Primary)
        .ok_or_else(|| RegistryError::Invalid("no primary node in registry".into()))?;

    if primary_idx == candidate_idx {
        return Err(RegistryError::Invalid("cannot promote primary over itself".into()));
    }

    let demoted_node_id = registry.nodes[primary_idx].node_id.clone();
    let previous_role = candidate_role.as_str().to_string();

    registry.nodes[primary_idx].role = NodeRole::Replica;
    registry.nodes[candidate_idx].role = NodeRole::Primary;

    validate_registry(registry)?;

    Ok(PromotionResult {
        promoted_node_id: from_node_id.to_string(),
        demoted_node_id,
        previous_role,
        new_role: NodeRole::Primary.as_str().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::register_node;
    use crate::types::{AgentstreamTopology, NodeRecord, NodesRegistryV2};

    fn sample_node(id: &str, role: NodeRole) -> NodeRecord {
        NodeRecord {
            node_id: id.into(),
            role,
            base_node_url: format!("http://127.0.0.1:780{}", if id.contains("edge") { 1 } else { 0 }),
            lattice_channel: format!("ex.aep.node.{id}"),
            trust_ring: "operator".into(),
            agentstream_topology: AgentstreamTopology::AsFederated,
            agentstream_peers: vec!["as-peer-edge".into()],
            gap_bundle_checkpoint: String::new(),
            health_sla_ms: 5000,
        }
    }

    #[test]
    fn promote_edge_to_primary_demotes_old_primary() {
        let mut registry = NodesRegistryV2::empty();
        register_node(&mut registry, sample_node("primary", NodeRole::Primary)).unwrap();
        register_node(
            &mut registry,
            NodeRecord {
                agentstream_peers: vec!["as-peer-edge".into()],
                ..sample_node("edge-replica", NodeRole::Edge)
            },
        )
        .unwrap();

        let result = promote_replica(&mut registry, "edge-replica").unwrap();
        assert_eq!(result.promoted_node_id, "edge-replica");
        assert_eq!(result.demoted_node_id, "primary");
        assert_eq!(registry.nodes[0].role, NodeRole::Replica);
        assert_eq!(registry.nodes[1].role, NodeRole::Primary);
    }
}