use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum NodeRole {
    Primary,
    Replica,
    Edge,
    #[serde(rename = "science-isolated")]
    ScienceIsolated,
}

impl NodeRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Replica => "replica",
            Self::Edge => "edge",
            Self::ScienceIsolated => "science-isolated",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "primary" => Some(Self::Primary),
            "replica" => Some(Self::Replica),
            "edge" => Some(Self::Edge),
            "science-isolated" => Some(Self::ScienceIsolated),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentstreamTopology {
    #[serde(rename = "as-single")]
    AsSingle,
    #[serde(rename = "as-federated")]
    AsFederated,
}

impl AgentstreamTopology {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::AsSingle => "as-single",
            Self::AsFederated => "as-federated",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "as-single" => Some(Self::AsSingle),
            "as-federated" => Some(Self::AsFederated),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodeRecord {
    pub node_id: String,
    pub role: NodeRole,
    pub base_node_url: String,
    pub lattice_channel: String,
    pub trust_ring: String,
    pub agentstream_topology: AgentstreamTopology,
    #[serde(default)]
    pub agentstream_peers: Vec<String>,
    #[serde(default)]
    pub gap_bundle_checkpoint: String,
    #[serde(default = "default_health_sla_ms")]
    pub health_sla_ms: u32,
}

fn default_health_sla_ms() -> u32 {
    5000
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NodesRegistryV2 {
    pub manifest_version: String,
    pub schema_version: String,
    pub nodes: Vec<NodeRecord>,
}

impl NodesRegistryV2 {
    pub fn empty() -> Self {
        Self {
            manifest_version: "1".into(),
            schema_version: "2".into(),
            nodes: Vec::new(),
        }
    }
}