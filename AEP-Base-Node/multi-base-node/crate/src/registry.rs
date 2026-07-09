use std::fs;
use std::path::Path;

use crate::error::{RegistryError, Result};
use crate::sync::merkle_root_hex;
use crate::types::{AgentstreamTopology, NodeRecord, NodeRole, NodesRegistryV2};

pub fn parse_registry_json(raw: &str) -> Result<NodesRegistryV2> {
    let registry: NodesRegistryV2 = serde_json::from_str(raw)?;
    validate_registry(&registry)?;
    Ok(registry)
}

pub fn load_registry(path: &Path) -> Result<NodesRegistryV2> {
    let raw = fs::read_to_string(path)?;
    parse_registry_json(&raw)
}

pub fn save_registry(path: &Path, registry: &NodesRegistryV2) -> Result<()> {
    validate_registry(registry)?;
    let pretty = serde_json::to_string_pretty(registry)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, format!("{pretty}\n"))?;
    Ok(())
}

pub fn list_nodes(registry: &NodesRegistryV2) -> Vec<&NodeRecord> {
    registry.nodes.iter().collect()
}

pub fn get_node<'a>(registry: &'a NodesRegistryV2, node_id: &str) -> Result<&'a NodeRecord> {
    registry
        .nodes
        .iter()
        .find(|n| n.node_id == node_id)
        .ok_or_else(|| RegistryError::NotFound(node_id.to_string()))
}

pub fn register_node(registry: &mut NodesRegistryV2, record: NodeRecord) -> Result<()> {
    validate_node(&record)?;
    if registry.nodes.iter().any(|n| n.node_id == record.node_id) {
        return Err(RegistryError::AlreadyExists(record.node_id));
    }
    if record.role == NodeRole::Primary {
        let primaries = registry
            .nodes
            .iter()
            .filter(|n| n.role == NodeRole::Primary)
            .count();
        if primaries > 0 {
            return Err(RegistryError::Invalid(
                "only one primary node allowed per registry".into(),
            ));
        }
    }
    registry.nodes.push(record);
    Ok(())
}

pub fn update_gap_checkpoint(registry: &mut NodesRegistryV2, node_id: &str, bundle_entries: &[String]) -> Result<String> {
    let root = merkle_root_hex(bundle_entries);
    let node = registry
        .nodes
        .iter_mut()
        .find(|n| n.node_id == node_id)
        .ok_or_else(|| RegistryError::NotFound(node_id.to_string()))?;
    node.gap_bundle_checkpoint = root.clone();
    Ok(root)
}

pub fn validate_registry(registry: &NodesRegistryV2) -> Result<()> {
    if registry.schema_version != "2" {
        return Err(RegistryError::Invalid(format!(
            "unsupported schema_version: {}",
            registry.schema_version
        )));
    }
    let mut seen = std::collections::HashSet::new();
    let mut primary_count = 0usize;
    for node in &registry.nodes {
        validate_node(node)?;
        if !seen.insert(node.node_id.clone()) {
            return Err(RegistryError::Invalid(format!(
                "duplicate node_id: {}",
                node.node_id
            )));
        }
        if node.role == NodeRole::Primary {
            primary_count += 1;
        }
    }
    if primary_count > 1 {
        return Err(RegistryError::Invalid("multiple primary nodes".into()));
    }
    Ok(())
}

pub fn validate_node(node: &NodeRecord) -> Result<()> {
    if node.node_id.trim().is_empty() {
        return Err(RegistryError::Invalid("node_id required".into()));
    }
    if node.base_node_url.trim().is_empty() {
        return Err(RegistryError::Invalid(format!(
            "base_node_url required for {}",
            node.node_id
        )));
    }
    if node.lattice_channel.trim().is_empty() {
        return Err(RegistryError::Invalid(format!(
            "lattice_channel required for {}",
            node.node_id
        )));
    }
    if node.trust_ring.trim().is_empty() {
        return Err(RegistryError::Invalid(format!(
            "trust_ring required for {}",
            node.node_id
        )));
    }
    if node.agentstream_topology == AgentstreamTopology::AsFederated && node.agentstream_peers.is_empty() {
        return Err(RegistryError::Invalid(format!(
            "as-federated requires agentstream_peers for {}",
            node.node_id
        )));
    }
    Ok(())
}

pub fn node_record_from_map(map: &serde_json::Map<String, serde_json::Value>) -> Result<NodeRecord> {
    let node_id = map
        .get("node_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RegistryError::Invalid("node_id required".into()))?
        .to_string();
    let role_str = map
        .get("role")
        .and_then(|v| v.as_str())
        .ok_or_else(|| RegistryError::Invalid("role required".into()))?;
    let role = NodeRole::parse(role_str)
        .ok_or_else(|| RegistryError::Invalid(format!("invalid role: {role_str}")))?;
    let topology_str = map
        .get("agentstream_topology")
        .and_then(|v| v.as_str())
        .unwrap_or("as-single");
    let agentstream_topology = AgentstreamTopology::parse(topology_str)
        .ok_or_else(|| RegistryError::Invalid(format!("invalid topology: {topology_str}")))?;

    let agentstream_peers = map
        .get("agentstream_peers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Ok(NodeRecord {
        node_id,
        role,
        base_node_url: map
            .get("base_node_url")
            .and_then(|v| v.as_str())
            .unwrap_or("http://127.0.0.1:7800")
            .to_string(),
        lattice_channel: map
            .get("lattice_channel")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| {
                let id = map
                    .get("node_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                format!("ex.aep.node.{id}")
            }),
        trust_ring: map
            .get("trust_ring")
            .and_then(|v| v.as_str())
            .unwrap_or("internal")
            .to_string(),
        agentstream_topology,
        agentstream_peers,
        gap_bundle_checkpoint: map
            .get("gap_bundle_checkpoint")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        health_sla_ms: map
            .get("health_sla_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(5000) as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn register_and_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nodes.json");
        let mut registry = NodesRegistryV2::empty();
        register_node(
            &mut registry,
            NodeRecord {
                node_id: "primary".into(),
                role: NodeRole::Primary,
                base_node_url: "http://127.0.0.1:7800".into(),
                lattice_channel: "ex.aep.node.primary".into(),
                trust_ring: "operator".into(),
                agentstream_topology: AgentstreamTopology::AsSingle,
                agentstream_peers: vec![],
                gap_bundle_checkpoint: String::new(),
                health_sla_ms: 5000,
            },
        )
        .unwrap();
        save_registry(&path, &registry).unwrap();
        let loaded = load_registry(&path).unwrap();
        assert_eq!(loaded.nodes.len(), 1);
        assert_eq!(loaded.nodes[0].node_id, "primary");
    }

    #[test]
    fn rejects_duplicate_primary() {
        let mut registry = NodesRegistryV2::empty();
        let primary = NodeRecord {
            node_id: "primary".into(),
            role: NodeRole::Primary,
            base_node_url: "http://127.0.0.1:7800".into(),
            lattice_channel: "ex.aep.node.primary".into(),
            trust_ring: "operator".into(),
            agentstream_topology: AgentstreamTopology::AsSingle,
            agentstream_peers: vec![],
            gap_bundle_checkpoint: String::new(),
            health_sla_ms: 5000,
        };
        register_node(&mut registry, primary.clone()).unwrap();
        let err = register_node(
            &mut registry,
            NodeRecord {
                node_id: "primary-2".into(),
                ..primary
            },
        )
        .unwrap_err();
        assert!(matches!(err, RegistryError::Invalid(_)));
    }
}