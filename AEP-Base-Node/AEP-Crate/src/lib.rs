//! AEP Base Node - mandatory local governance kernel for AEP 2.8.6.

pub mod dock_keys;
pub mod docking;
pub mod dock_display;
// dock_freshness, dock_pulse, dock_rate, dock_serve and dock_apply are docking facade modules.
pub mod envelope_admit;
pub mod error;
pub mod correctwriting_en;
pub mod lattice_log;
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
    drain_docking_servers, process_request, pulse_beat, run_docking_servers, sockets_exist,
    unlink_sockets, DockFrameResponse, DockingRuntime,
};
pub use lattice_log::{
    build_transport_frame, default_aep_data_dir, default_lattice_db_path, export_dynaep_events,
    open_lattice_db, record_dynaep_event, refuse_world_writable_lattice_parent,
    refuse_world_writable_lattice_parent_with_allow, world_writable_lattice_parent_allowed,
    ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV, DynAepEventExport, DynAepEventInput, DynAepEventRecord,
};
use aep_potomitan::{detect_network_mode, status, MeshMode, MeshSupervisor, MESH_PEERS_FILE};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const COMPONENT_ID: &str = "aep-base-node";
pub const CORRECTWRITING_EN_PRIORITY: u8 = 255;

pub use error::{AdmitDeny, BaseNodeError};
// the Base Node facades the one public kernel type set.
// Every name below is a re-export of the single definition site in aep-kernel-types.
pub use aep_kernel_types::{
    AdmitResult, AdmitWall, AgentPermission, AgentPermissionLookup, ClosedWall, DenyReport,
    Envelope, ProcessSealed, Pulse, DENY_NO_PERMISSION, PULSE_MS, WALL_AGENT_PERMISSION,
};
pub use aep_live_entry::agent_permission;
pub use envelope_admit::admit_sealed_payload as process_sealed;

pub use correctwriting_en::{
    enforce_writing_text, enforce_writing_value, lint_writing_prose, value_has_writing_violations,
    WritingEnforceResult, WritingViolation, CORRECTWRITING_EN_CORE_ID, WRITING_GAP_DOMAIN,
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
    pub correctwriting_en_priority: u8,
    pub hub_loaded: bool,
    pub hub_sessions: u32,
    pub hub_mounts: u32,
    pub hub_permissions: u32,
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
            name: "kernel-admit-dock",
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
            port: DockingPort::RegulationModule,
            name: "regulation-module-dock",
            priority: 150,
            listen_path: format!("{base_socket}/regulation"),
        },
        DockingPortSpec {
            port: DockingPort::DisplayApi,
            name: "display-api-dock",
            priority: 200,
            listen_path: format!("{base_socket}/display"),
        },
    ]
}

pub fn init_action_lattice_db(path: &Path) -> rusqlite::Result<Connection> {
    lattice_log::refuse_world_writable_lattice_parent(path)?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::ToSqlConversionFailure(Box::new(e))
            })?;
        }
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    conn.execute("CREATE TABLE IF NOT EXISTS held_frame_digests (frame_digest TEXT PRIMARY KEY, held_at_unix INTEGER NOT NULL, row_class TEXT NOT NULL DEFAULT 'held')", [])?;
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
    /// Returns false if digest already seen (replay).
    /// Evicts oldest entries past REPLAY_CACHE_MAX (TASK-A28-H06).
    /// Callers must still persist digests to SQLite unique index for durable anti-replay.
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

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.seen.len()
    }
}

#[cfg(test)]
mod replay_guard_tests {
    use super::*;

    #[test]
    fn replay_guard_rejects_duplicate_digest() {
        let mut g = ReplayGuard::default();
        assert!(g.check_and_record("d1", 1));
        assert!(!g.check_and_record("d1", 2));
    }

    #[test]
    fn replay_guard_evicts_oldest_at_capacity() {
        let mut g = ReplayGuard::default();
        for i in 0..REPLAY_CACHE_MAX {
            assert!(
                g.check_and_record(&format!("d{i}"), i as u64),
                "insert {i}"
            );
        }
        assert_eq!(g.len(), REPLAY_CACHE_MAX);
        // One more forces eviction of d0
        assert!(g.check_and_record("d-new", 99_999));
        assert_eq!(g.len(), REPLAY_CACHE_MAX);
        // Evicted digest can re-enter memory (durable protection is SQLite unique index)
        assert!(g.check_and_record("d0", 1));
        // Still-cached mid digest is rejected
        assert!(!g.check_and_record("d500", 500));
    }
}

pub fn frame_digest_exists(conn: &Connection, digest: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1) + (SELECT COUNT(*) FROM held_frame_digests WHERE frame_digest = ?1)",
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
) -> Result<Vec<u8>, BaseNodeError> {
    let result = if allow_inactive_contract {
        open_verified_capsule(frame, dock_kem, signer_public)
    } else {
        verify_and_open_frame(frame, dock_kem, signer_public, contracts)
    };
    result.map_err(|e| BaseNodeError::Channel(e.to_string()))
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
    let applied: i64 = match conn.query_row("SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1", [digest.as_str()], |r| r.get(0)) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    if applied > 0 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE),
            Some("frame replay rejected".into()),
        ));
    }
    let payload_json = match serde_json::to_string(frame) {
        Ok(v) => v,
        Err(e) => {
            return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(e)));
        }
    };
    let agentmesh_json = match serde_json::to_string(bundle) {
        Ok(v) => v,
        Err(e) => {
            return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(e)));
        }
    };
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
    let _ = conn.execute("DELETE FROM held_frame_digests WHERE frame_digest = ?1", params![digest]);
    Ok(conn.last_insert_rowid())
}

#[derive(Serialize)]
struct SelfTestLedgerKind {
    kind: String,
}

pub fn record_lattice_event(
    conn: &Connection,
    agent_id: &str,
    channel_id: &str,
    contract_id: &str,
    frame_digest: &str,
    recorded_at_unix: u64,
) -> rusqlite::Result<()> {
    let payload = SelfTestLedgerKind {
        kind: String::from("base_node_self_test"),
    };
    let mesh = SelfTestLedgerKind {
        kind: String::from("agentmesh"),
    };
    let payload_ser = serde_json::to_string(&payload);
    if payload_ser.is_err() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(payload_ser.unwrap_err())));
    }
    let payload_json = payload_ser.unwrap();
    let mesh_ser = serde_json::to_string(&mesh);
    if mesh_ser.is_err() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(mesh_ser.unwrap_err())));
    }
    let agentmesh_json = mesh_ser.unwrap();
    let exec_r = conn.execute(
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
            payload_json,
            agentmesh_json,
        ],
    );
    if exec_r.is_err() {
        return Err(exec_r.unwrap_err());
    }
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


#[allow(clippy::too_many_arguments)]
pub fn health(
    version: &str,
    mesh_peers: u32,
    internet_up: bool,
    base_socket: &str,
    lattice_events: u64,
    correctwriting_en_priority: u8,
    hub_loaded: bool,
    hub_sessions: u32,
    hub_mounts: u32,
    hub_permissions: u32,
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
        correctwriting_en_priority,
        hub_loaded,
        hub_sessions,
        hub_mounts,
        hub_permissions,
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

pub fn persist_held_digest(conn: &Connection, digest: &str, at_unix: i64) -> rusqlite::Result<()> {
    conn.execute("INSERT OR IGNORE INTO held_frame_digests (frame_digest, held_at_unix) VALUES (?1, ?2)", params![digest, at_unix])?;
    Ok(())
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
    registry.register("correctwriting-en");
    registry.register("dynaep-action-lattice");
    registry.register("aep-display-api");
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
        assert!(registry.is_active("correctwriting-en"));
        assert!(registry.is_active("dynaep-action-lattice"));
        assert!(registry.is_active("lattice-channel-default"));
    }

    #[test]
    fn health_reports_offline_when_isolated() {
        let report = health(
            "2.8.6-alpha.1",
            0,
            false,
            "/tmp/sock",
            0,
            CORRECTWRITING_EN_PRIORITY,
            false,
            0,
            0,
            0,
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

    #[test]
    fn record_lattice_event_binds_eight_columns() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("aep-action-lattice.db");
        let conn = lattice_log::open_lattice_db(&db).expect("open");
        record_lattice_event(
            &conn,
            "AG-BOOT",
            "ch-selftest",
            "dynaep-action-lattice",
            "digest-env046",
            1,
        )
        .expect("record");
        assert_eq!(event_count(&conn).expect("count"), 1);
    }
}
