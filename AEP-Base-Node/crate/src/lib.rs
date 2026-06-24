//! AEP Base Node - mandatory local governance kernel for AEP 2.8.

pub mod dock_keys;
pub mod docking;
pub mod epscom;
pub mod lattice_log;
pub mod pera;
pub mod side_channel_monitor;
pub mod task_manifest;

use aep_agentmesh::{create_bundle, AgentMeshBundle};
use aep_lattice_channel::{
    frame_digest, open_verified_capsule, verify_and_open_frame, ContractRegistry, DockingPort,
    CHANNEL_VERSION, LatticeChannelFrame,
};
use aep_lattice_crypto::KemKeypair;
pub use side_channel_monitor::{
    record_side_channel_anomaly, SideChannelAnomaly, SideChannelAnomalyKind,
    SIDE_CHANNEL_EVENT_TYPE,
};
pub use docking::{
    process_request, run_docking_servers, sockets_exist, DockFrameResponse, DockingRuntime,
};
pub use lattice_log::{
    build_transport_frame, export_dynaep_events, open_lattice_db, record_dynaep_event,
    DynAepEventExport, DynAepEventInput, DynAepEventRecord,
};
use aep_potomitan::{detect_network_mode, status, MeshMode, MeshSupervisor, MESH_PEERS_FILE};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const COMPONENT_ID: &str = "aep-base-node";
pub const EPSCOM_PRIORITY: u8 = 255;

pub use epscom::{
    enforce_writing_text, enforce_writing_value, lint_writing_prose, value_has_writing_violations,
    WritingEnforceResult, WritingViolation, EPSCOM_CORE_ID, WRITING_GAP_DOMAIN,
    WRITING_RULE_IDS, WRITING_RULE_NO_DASH_SUBSTITUTES, WRITING_RULE_NO_DOUBLE_HYPHEN,
    WRITING_RULE_NO_EM_DASHES, WRITING_RULE_NO_EN_DASHES, WRITING_RULE_NO_MINUS_AS_DASH,
    WRITING_RULE_NO_OXFORD_COMMA,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockingPortSpec {
    pub port: DockingPort,
    pub name: &'static str,
    pub priority: u8,
    pub listen_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseNodeHealth {
    pub component: String,
    pub version: String,
    pub channel_version: String,
    pub mesh_mode: MeshMode,
    pub mesh_peers: u32,
    pub internet_up: bool,
    pub mesh_reachable: bool,
    pub mesh_routes: u32,
    pub potomitan_config: String,
    pub epscom_priority: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epscom_signatures_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epscom_signatures_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_peers_load_error: Option<String>,
    pub docking_ports: Vec<DockingPortSpec>,
    pub docking_ports_listening: bool,
    pub action_lattice_events: u64,
    pub lattice_memory_attractors: u64,
    pub lattice_memory_dim: u32,
    pub vector_store: &'static str,
    pub sqlite_vec_version: Option<String>,
    pub status: &'static str,
}

pub fn docking_port_specs(base_socket: &str) -> Vec<DockingPortSpec> {
    vec![
        DockingPortSpec {
            port: DockingPort::InferenceEngine,
            name: "inference-engine-dock",
            priority: 200,
            listen_path: format!("{base_socket}/inference"),
        },
        DockingPortSpec {
            port: DockingPort::ValidationEngine,
            name: "validation-engine-dock",
            priority: 200,
            listen_path: format!("{base_socket}/validation"),
        },
        DockingPortSpec {
            port: DockingPort::FutureFeatures,
            name: "future-features-dock",
            priority: 200,
            listen_path: format!("{base_socket}/future"),
        },
        DockingPortSpec {
            port: DockingPort::Pera,
            name: "pera-dock",
            priority: 200,
            listen_path: format!("{base_socket}/pera"),
        },
        DockingPortSpec {
            port: DockingPort::RegulationModule,
            name: "regulation-module-dock",
            priority: 150,
            listen_path: format!("{base_socket}/regulation"),
        },
    ]
}

pub fn init_action_lattice_db(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(e))
            })?;
        }
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS action_lattice_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            contract_id TEXT NOT NULL,
            frame_digest TEXT NOT NULL,
            recorded_at_unix INTEGER NOT NULL
        );",
    )?;
    Ok(conn)
}

pub fn agentmesh_bundle_for_frame(
    agent_id: &str,
    trust_score: u16,
    sign_public: &[u8],
) -> AgentMeshBundle {
    create_bundle(
        agent_id,
        trust_score,
        sign_public,
        vec!["lattice.channel".into(), "docking.transport".into()],
        now_unix(),
    )
}

const REPLAY_CACHE_MAX: usize = 10_000;

#[derive(Debug, Default)]
pub struct ReplayGuard {
    seen: std::collections::HashMap<String, u64>,
    order: std::collections::VecDeque<String>,
}

impl ReplayGuard {
    pub fn check_and_record(&mut self, digest: &str, at_unix: u64) -> bool {
        if self.seen.contains_key(digest) {
            return false;
        }
        while self.seen.len() >= REPLAY_CACHE_MAX {
            let Some(old) = self.order.pop_front() else {
                break;
            };
            self.seen.remove(&old);
        }
        self.seen.insert(digest.to_string(), at_unix);
        self.order.push_back(digest.to_string());
        true
    }
}

pub fn frame_digest_exists(conn: &Connection, digest: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1",
        [digest],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

pub fn verify_inbound_dock_frame(
    frame: &LatticeChannelFrame,
    dock_kem: &KemKeypair,
    signer_public: &[u8],
    contracts: &ContractRegistry,
    allow_inactive_contract: bool,
) -> Result<Vec<u8>, String> {
    let result = if allow_inactive_contract {
        open_verified_capsule(frame, dock_kem, signer_public)
    } else {
        verify_and_open_frame(frame, dock_kem, signer_public, contracts)
    };
    result.map_err(|e| e.to_string())
}

pub fn record_channel_frame(
    conn: &Connection,
    frame: &LatticeChannelFrame,
    event_type: &str,
    bundle: &AgentMeshBundle,
    replay_guard: Option<&mut ReplayGuard>,
) -> rusqlite::Result<i64> {
    let digest = frame_digest(frame);
    if let Some(guard) = replay_guard {
        if !guard.check_and_record(&digest, frame.sent_at_unix) {
            return Err(rusqlite::Error::InvalidParameterName(
                "frame replay rejected".into(),
            ));
        }
    }
    if frame_digest_exists(conn, &digest)? {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE),
            Some("frame replay rejected".into()),
        ));
    }
    let payload_json =
        serde_json::to_string(frame).unwrap_or_else(|_| "{}".to_string());
    let agentmesh_json =
        serde_json::to_string(bundle).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT INTO action_lattice_events
         (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            frame.agent_id,
            frame.channel_id,
            frame.contract_id,
            digest,
            frame.sent_at_unix as i64,
            event_type,
            payload_json,
            agentmesh_json,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn record_lattice_event(
    conn: &Connection,
    agent_id: &str,
    channel_id: &str,
    contract_id: &str,
    frame_digest: &str,
    recorded_at_unix: u64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO action_lattice_events
         (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            agent_id,
            channel_id,
            contract_id,
            frame_digest,
            recorded_at_unix as i64,
            "base_node_self_test",
            "{}",
            "{}",
        ],
    )?;
    Ok(())
}

pub fn event_count(conn: &Connection) -> rusqlite::Result<u64> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM action_lattice_events", [], |r| r.get(0))?;
    Ok(count as u64)
}

#[allow(clippy::too_many_arguments)]
pub fn resolve_mesh_peers(
    data_dir: Option<&Path>,
    internet_up: bool,
    fallback: u32,
) -> (u32, u32, Option<String>) {
    if let Some(dir) = data_dir {
        let sup = MeshSupervisor::load(dir, internet_up);
        let peers = sup.peer_count();
        let routes = sup.routing.reachable_destinations();
        let load_error = sup.load_error;
        if sup.config_path.exists() {
            return (peers, routes, load_error);
        }
        if peers > 0 {
            return (peers, routes, load_error);
        }
        if load_error.is_some() {
            return (peers, routes, load_error);
        }
    }
    (fallback, fallback, None)
}

pub fn count_epscom_signature_entries(signatures_root: &Path) -> Option<u32> {
    let bundle_path = signatures_root.join("trust-bundle/manifest.json");
    let raw = std::fs::read_to_string(bundle_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("entries")
        .and_then(|v| v.as_array())
        .map(|a| a.len() as u32)
}

#[allow(clippy::too_many_arguments)]
pub fn health(
    version: &str,
    mesh_peers: u32,
    internet_up: bool,
    base_socket: &str,
    lattice_events: u64,
    epscom_priority: u8,
    epscom_signatures_enabled: Option<bool>,
    epscom_signatures_count: Option<u32>,
    mesh_peers_load_error: Option<String>,
    lattice_memory_attractors: u64,
    lattice_memory_dim: u32,
    sqlite_vec_version: Option<String>,
    docking_ports_listening: bool,
    mesh_routes: u32,
    data_dir: Option<&Path>,
) -> BaseNodeHealth {
    let mesh_mode = detect_network_mode(internet_up, mesh_peers);
    let mesh = status(mesh_mode, mesh_peers);
    let potomitan_config = data_dir
        .map(|d| d.join(MESH_PEERS_FILE).to_string_lossy().to_string())
        .unwrap_or_else(|| MESH_PEERS_FILE.to_string());
    BaseNodeHealth {
        component: COMPONENT_ID.into(),
        version: version.into(),
        channel_version: CHANNEL_VERSION.into(),
        mesh_mode,
        mesh_peers,
        internet_up,
        mesh_reachable: mesh.reachable,
        mesh_routes,
        potomitan_config,
        epscom_priority,
        epscom_signatures_enabled,
        epscom_signatures_count,
        mesh_peers_load_error,
        docking_ports: docking_port_specs(base_socket),
        docking_ports_listening,
        action_lattice_events: lattice_events,
        lattice_memory_attractors,
        lattice_memory_dim,
        vector_store: "sqlite-vec+usearch",
        sqlite_vec_version,
        status: "ok",
    }
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn bootstrap_contracts() -> ContractRegistry {
    bootstrap_contracts_from_lrps(&[])
}

pub fn bootstrap_contracts_from_lrps(lrps: &[String]) -> ContractRegistry {
    let mut registry = ContractRegistry::default();
    for lrp in lrps {
        registry.register(lrp);
    }
    registry.register("epscom-core");
    registry.register("dynaep-action-lattice");
    registry.register(crate::pera::PERA_CONTRACT_ID);
    registry.register("lattice-channel-default");
    registry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_registers_config_lrps_and_mandatory_contracts() {
        let lrps = vec!["aep-275-eval-chain".into()];
        let registry = bootstrap_contracts_from_lrps(&lrps);
        assert!(registry.is_active("aep-275-eval-chain"));
        assert!(registry.is_active("epscom-core"));
        assert!(registry.is_active("dynaep-action-lattice"));
        assert!(registry.is_active(crate::pera::PERA_CONTRACT_ID));
        assert!(registry.is_active("lattice-channel-default"));
    }

    #[test]
    fn health_reports_offline_when_isolated() {
        let report = health(
            "2.8.0-alpha.1",
            0,
            false,
            "/tmp/sock",
            0,
            EPSCOM_PRIORITY,
            Some(true),
            Some(4),
            None,
            0,
            128,
            None,
            false,
            0,
            None,
        );
        assert_eq!(report.mesh_mode, MeshMode::Offline);
        assert!(!report.mesh_reachable);
        assert!(!report.internet_up);
    }
}