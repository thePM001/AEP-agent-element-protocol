//! AEP Base Node - mandatory local governance kernel for AEP 2.8.6.

pub mod dock_keys;
mod dock_keys_provision;
mod dock_keys_store;
pub mod dock_log;
pub mod dock_parts;
pub mod docking;
#[cfg(test)]
mod docking_fixtures;
// docking/ holds the facade children freshness, pulse, rate, serve and apply.
pub mod envelope_admit;
pub mod error;
pub mod correctwriting_en;
pub mod lattice_log;
pub mod side_channel_monitor;
pub mod task_manifest;
pub mod data_dock;

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
    pub sqlite_closed: bool,
    pub last_tls_handshake_err: Option<String>,
    pub drain_aborted_tasks: u64,
    pub status: &'static str,
}

impl BaseNodeHealth {
    /// Process exit code for `aep-base-node --health`: 0 ok, 1 degraded, 2 error.
    pub fn exit_code(&self) -> u8 {
        status_exit_code(self.status)
    }
}

/// Exit code for a rollup status: 0 ok, 1 degraded, 2 error.
pub fn status_exit_code(status: &str) -> u8 {
    match status {
        "ok" => 0,
        "degraded" => 1,
        _ => 2,
    }
}

/// Live inputs for one health report. Every field is read from the running
/// node, so the rollup never sees a literal default.
#[derive(Debug, Clone)]
pub struct HealthInput<'a> {
    pub version: &'a str,
    pub mesh_peers: u32,
    pub internet_up: bool,
    pub base_socket: &'a str,
    pub lattice_events: u64,
    pub correctwriting_en_priority: u8,
    pub hub_loaded: bool,
    pub hub_sessions: u32,
    pub hub_mounts: u32,
    pub hub_permissions: u32,
    pub mesh_peers_load_error: Option<String>,
    pub lattice_memory_attractors: u64,
    pub lattice_memory_dim: u32,
    pub sqlite_vec_version: Option<String>,
    pub docking_ports_listening: bool,
    pub mesh_routes: u32,
    pub data_dir: Option<&'a Path>,
    pub sqlite_closed: bool,
    pub last_tls_handshake_err: Option<String>,
    pub drain_aborted_tasks: u64,
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
    let payload_json = serde_json::to_string(&payload)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let agentmesh_json = serde_json::to_string(&mesh)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
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
            payload_json,
            agentmesh_json,
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


pub fn rollup_status(
    docking_ports_listening: bool,
    hub_loaded: bool,
    mesh_peers_load_error: Option<&str>,
    sqlite_closed: bool,
) -> &'static str {
    if sqlite_closed {
        "error"
    } else if docking_ports_listening == false {
        "degraded"
    } else if hub_loaded == false {
        "degraded"
    } else if mesh_peers_load_error.is_some() {
        "degraded"
    } else {
        "ok"
    }
}

pub fn health(input: HealthInput<'_>) -> BaseNodeHealth {
    let mesh_mode = detect_network_mode(input.internet_up, input.mesh_peers);
    let mesh = status(mesh_mode, input.mesh_peers);
    let potomitan_config = input
        .data_dir
        .map(|d| d.join(MESH_PEERS_FILE).to_string_lossy().to_string())
        .unwrap_or_else(|| MESH_PEERS_FILE.to_string());
    let status = rollup_status(
        input.docking_ports_listening,
        input.hub_loaded,
        input.mesh_peers_load_error.as_deref(),
        input.sqlite_closed,
    );
    BaseNodeHealth {
        component: COMPONENT_ID.into(),
        version: input.version.into(),
        channel_version: CHANNEL_VERSION.into(),
        mesh_mode,
        mesh_peers: input.mesh_peers,
        internet_up: input.internet_up,
        mesh_reachable: mesh.reachable,
        mesh_routes: input.mesh_routes,
        potomitan_config,
        correctwriting_en_priority: input.correctwriting_en_priority,
        hub_loaded: input.hub_loaded,
        hub_sessions: input.hub_sessions,
        hub_mounts: input.hub_mounts,
        hub_permissions: input.hub_permissions,
        status,
        mesh_peers_load_error: input.mesh_peers_load_error,
        docking_ports: docking_port_specs(input.base_socket),
        docking_ports_listening: input.docking_ports_listening,
        action_lattice_events: input.lattice_events,
        lattice_memory_attractors: input.lattice_memory_attractors,
        lattice_memory_dim: input.lattice_memory_dim,
        vector_store: "sqlite-vec+usearch",
        sqlite_vec_version: input.sqlite_vec_version,
        sqlite_closed: input.sqlite_closed,
        last_tls_handshake_err: input.last_tls_handshake_err,
        drain_aborted_tasks: input.drain_aborted_tasks,
    }
}

/// Rollup status of a running node from its live parts.
pub fn runtime_status(runtime: &DockingRuntime, mesh_peers_load_error: Option<&str>) -> &'static str {
    rollup_status(
        runtime.docking_ports_listening(),
        runtime.admit.hub.is_loaded(),
        mesh_peers_load_error,
        runtime.sqlite_is_closed(),
    )
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

    fn isolated_input() -> HealthInput<'static> {
        HealthInput {
            version: "2.8.6-alpha.1",
            mesh_peers: 0,
            internet_up: false,
            base_socket: "/tmp/sock",
            lattice_events: 0,
            correctwriting_en_priority: CORRECTWRITING_EN_PRIORITY,
            hub_loaded: false,
            hub_sessions: 0,
            hub_mounts: 0,
            hub_permissions: 0,
            mesh_peers_load_error: None,
            lattice_memory_attractors: 0,
            lattice_memory_dim: 128,
            sqlite_vec_version: None,
            docking_ports_listening: false,
            mesh_routes: 0,
            data_dir: None,
            sqlite_closed: false,
            last_tls_handshake_err: None,
            drain_aborted_tasks: 0,
        }
    }

    fn ready_input() -> HealthInput<'static> {
        HealthInput {
            mesh_peers: 1,
            internet_up: true,
            hub_loaded: true,
            hub_sessions: 1,
            hub_mounts: 1,
            hub_permissions: 1,
            docking_ports_listening: true,
            mesh_routes: 1,
            ..isolated_input()
        }
    }

    #[test]
    fn health_reports_offline_when_isolated() {
        let report = health(isolated_input());
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

    #[test]
    fn health_status_ok_when_docks_and_hub_ready() {
        let report = health(ready_input());
        assert_eq!(report.status, "ok");
        assert_eq!(report.exit_code(), 0);
    }

    #[test]
    fn health_status_degraded_when_isolated() {
        let report = health(isolated_input());
        assert_eq!(report.status, "degraded");
        assert_eq!(report.exit_code(), 1);
    }

    #[test]
    fn health_status_error_when_sqlite_closed() {
        let report = health(HealthInput {
            sqlite_closed: true,
            ..ready_input()
        });
        assert_eq!(report.status, "error");
        assert_eq!(report.sqlite_closed, true);
        assert_eq!(report.exit_code(), 2);
    }

    #[test]
    fn health_carries_tls_and_drain_state() {
        let report = health(HealthInput {
            last_tls_handshake_err: Some(String::from("refused")),
            drain_aborted_tasks: 3,
            ..ready_input()
        });
        assert_eq!(report.status, "ok");
        assert_eq!(report.last_tls_handshake_err.as_deref(), Some("refused"));
        assert_eq!(report.drain_aborted_tasks, 3);
    }

    #[test]
    fn rollup_status_error_when_sqlite_closed() {
        assert_eq!(rollup_status(true, true, None, true), "error")
    }

    #[test]
    fn rollup_status_degraded_when_mesh_peers_load_error() {
        assert_eq!(rollup_status(true, true, Some("load failed"), false), "degraded")
    }

    #[test]
    fn rollup_status_ok_when_ready() {
        assert_eq!(rollup_status(true, true, None, false), "ok")
    }

}
