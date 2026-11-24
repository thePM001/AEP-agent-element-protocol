//! AEP Base Node - mandatory local governance kernel for AEP 2.9.

pub mod dock_keys;
mod dock_keys_provision;
mod dock_keys_store;
pub mod dock_log;
pub mod dock_parts;
pub mod docking;
#[cfg(test)]
mod docking_fixtures;
// docking/ holds the facade children freshness, pulse, rate, serve and apply.
pub mod caw_kernel_dock;
pub mod correctwriting_en;
pub mod data_dock;
pub mod envelope_admit;
pub mod error;
pub mod lattice_log;
pub mod lattice_memory;
pub mod side_channel_monitor;
pub mod task_manifest;

use aep_agentmesh::{create_bundle, AgentMeshBundle, AgentMeshError, LedgerMeshRecord};
use aep_lattice_channel::{
    frame_digest, open_verified_capsule, verify_and_open_frame, ContractRegistry, DockingPort,
    LatticeChannelFrame, CHANNEL_VERSION,
};
use aep_lattice_crypto::KemKeypair;
pub use aep_potomitan::PlaneProof;
use aep_potomitan::{detect_network_mode, status, MeshMode, MeshSupervisor, MESH_PEERS_FILE};
pub use docking::{
    drain_docking_servers, process_request, pulse_beat, run_docking_servers, sockets_exist,
    unlink_sockets, DockFrameResponse, DockVerdict, DockingRuntime,
};
pub use lattice_log::{
    build_transport_frame, default_aep_data_dir, default_lattice_db_path, export_dynaep_events,
    open_lattice_db, record_dynaep_event, refuse_world_writable_lattice_parent,
    refuse_world_writable_lattice_parent_with_allow, world_writable_lattice_parent_allowed,
    DynAepEventExport, DynAepEventInput, DynAepEventRecord,
    ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
pub use side_channel_monitor::{
    record_side_channel_anomaly, SideChannelAnomaly, SideChannelAnomalyKind,
    SIDE_CHANNEL_EVENT_TYPE,
};
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
    enforce_writing_payload, enforce_writing_text, enforce_writing_value, lint_writing_prose,
    value_has_writing_violations, WritingEnforceResult, WritingViolation,
    CORRECTWRITING_EN_CORE_ID, WRITING_GAP_DOMAIN, WRITING_RULE_IDS,
    WRITING_RULE_NO_DASH_SUBSTITUTES, WRITING_RULE_NO_DOUBLE_HYPHEN, WRITING_RULE_NO_EM_DASHES,
    WRITING_RULE_NO_EN_DASHES, WRITING_RULE_NO_MINUS_AS_DASH, WRITING_RULE_NO_OXFORD_COMMA,
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
    /// Active peers in the peer file: a count, not a proof of reach.
    pub mesh_peers: u32,
    pub internet_up: bool,
    /// In POTOMITAN mode true only when a bound packet plane accepted a datagram from a
    /// known peer.
    pub mesh_reachable: bool,
    /// Routes of the bound packet plane, zero when no plane is bound.
    pub mesh_routes: u32,
    /// A mesh packet plane is bound.
    pub mesh_packet_plane: bool,
    /// Known peers whose datagrams the bound plane accepted.
    pub mesh_proven_peers: u32,
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
    /// Bits of the fingerprint of a recorded shape.
    pub lattice_memory_dim: u32,
    pub vector_store: &'static str,
    /// Records of the memory in the domains of judged proposals: one for each verdict
    /// the memory took and wrote.
    pub lattice_memory_records: u64,
    /// Verdicts the dock could not hand to the memory because its queue was full.
    pub lattice_memory_dropped: u64,
    /// Verdicts the memory could not write.
    pub lattice_memory_failed: u64,
    /// Verdicts that wait in the queue of the memory.
    pub lattice_memory_queue_depth: u64,
    /// Recorded proposals whose shape, or one near it, was accepted before.
    pub lattice_memory_hot: u64,
    /// Recorded proposals of a shape that was not accepted before.
    pub lattice_memory_cold: u64,
    /// Proposals whose writing rows Admit took from the memo.
    pub lattice_memory_memo_replayed: u64,
    /// Verdict rows of the Evidence Ledger minus records of the memory, counted from
    /// the first start of the memory on. Null when a node that is not running is asked.
    pub lattice_memory_ledger_gap: Option<i64>,
    /// True when the memory flushes every record to the disk.
    pub lattice_memory_durable: bool,
    /// `ok`, `failing` while writes fail, `off`, `absent` when no store exists yet
    /// or `error` when the store could not be opened.
    pub lattice_memory_status: &'static str,
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
    pub lattice_memory: lattice_memory::MemoryReport,
    pub docking_ports_listening: bool,
    /// What a bound packet plane proved. Unbound when the node binds no plane.
    pub mesh_plane: PlaneProof,
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
            std::fs::create_dir_all(parent)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
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
    sign_public: &[u8],
) -> Result<AgentMeshBundle, AgentMeshError> {
    create_bundle(
        agent_id,
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

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.seen.is_empty()
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
            assert!(g.check_and_record(&format!("d{i}"), i as u64), "insert {i}");
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

/// Write the ledger row of a frame. The AgentMesh column is `mesh`: the certificate the
/// peer presented on the connection that carried the frame. It is empty when no
/// certificate was presented.
pub fn record_channel_frame(
    conn: &Connection,
    frame: &LatticeChannelFrame,
    event_type: &str,
    mesh: &LedgerMeshRecord,
    replay_guard: Option<&mut ReplayGuard>,
) -> rusqlite::Result<i64> {
    let digest =
        frame_digest(frame).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    if let Some(guard) = replay_guard {
        if !guard.check_and_record(&digest, frame.sent_at_unix) {
            return Err(rusqlite::Error::InvalidParameterName(
                "frame replay rejected".into(),
            ));
        }
    }
    let applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1",
        [digest.as_str()],
        |r| r.get(0),
    )?;
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
    let agentmesh_json = match serde_json::to_string(mesh) {
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
    let _ = conn.execute(
        "DELETE FROM held_frame_digests WHERE frame_digest = ?1",
        params![digest],
    );
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
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM action_lattice_events", [], |r| {
        r.get(0)
    })?;
    Ok(count as u64)
}

/// Active peer count of the peer file of `data_dir` with its load error. With no peer
/// file it is `fallback` peers from the config. A count selects the mesh mode. It never
/// proves a route: routes and reach come from a bound plane only.
pub fn resolve_mesh_peers(
    data_dir: Option<&Path>,
    internet_up: bool,
    fallback: u32,
) -> (u32, Option<String>) {
    if let Some(dir) = data_dir {
        let sup = MeshSupervisor::load(dir, internet_up);
        let peers = sup.peer_count();
        if sup.config_path.exists() || peers > 0 || sup.load_error.is_some() {
            return (peers, sup.load_error);
        }
    }
    (fallback, None)
}

pub fn rollup_status(
    docking_ports_listening: bool,
    hub_loaded: bool,
    mesh_peers_load_error: Option<&str>,
    sqlite_closed: bool,
) -> &'static str {
    if sqlite_closed {
        "error"
    } else if !docking_ports_listening || !hub_loaded || mesh_peers_load_error.is_some() {
        "degraded"
    } else {
        "ok"
    }
}

pub fn health(input: HealthInput<'_>) -> BaseNodeHealth {
    let mesh_mode = detect_network_mode(input.internet_up, input.mesh_peers);
    let mesh = status(mesh_mode, input.mesh_peers, input.mesh_plane);
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
        mesh_routes: mesh.routes,
        mesh_packet_plane: mesh.packet_plane,
        mesh_proven_peers: mesh.proven_peers,
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
        lattice_memory_attractors: input.lattice_memory.attractors,
        lattice_memory_dim: lattice_memory::FINGERPRINT_BITS,
        vector_store: lattice_memory::VECTOR_STORE,
        lattice_memory_records: input.lattice_memory.records,
        lattice_memory_dropped: input.lattice_memory.dropped,
        lattice_memory_failed: input.lattice_memory.failed,
        lattice_memory_queue_depth: input.lattice_memory.queue_depth,
        lattice_memory_hot: input.lattice_memory.hot,
        lattice_memory_cold: input.lattice_memory.cold,
        lattice_memory_memo_replayed: input.lattice_memory.memo_replayed,
        lattice_memory_ledger_gap: input.lattice_memory.ledger_gap,
        lattice_memory_durable: input.lattice_memory.durable,
        lattice_memory_status: input.lattice_memory.status,
        sqlite_closed: input.sqlite_closed,
        last_tls_handshake_err: input.last_tls_handshake_err,
        drain_aborted_tasks: input.drain_aborted_tasks,
    }
}

/// Rollup status of a running node from its live parts.
pub fn runtime_status(
    runtime: &DockingRuntime,
    mesh_peers_load_error: Option<&str>,
) -> &'static str {
    rollup_status(
        runtime.docking_ports_listening(),
        runtime.admit.hub.is_loaded(),
        mesh_peers_load_error,
        runtime.sqlite_is_closed(),
    )
}

pub fn persist_held_digest(conn: &Connection, digest: &str, at_unix: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO held_frame_digests (frame_digest, held_at_unix) VALUES (?1, ?2)",
        params![digest, at_unix],
    )?;
    Ok(())
}
/// Take back the held record of a digest whose capsule never entered the pulse queue.
pub fn forget_held_digest(conn: &Connection, digest: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM held_frame_digests WHERE frame_digest = ?1",
        params![digest],
    )?;
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
            version: "2.9.0-alpha.1",
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
            lattice_memory: lattice_memory::MemoryReport::absent(),
            docking_ports_listening: false,
            mesh_plane: PlaneProof::unbound(),
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
    fn health_reports_the_mesh_only_from_a_bound_authenticated_plane() {
        // Peers on file and internet down: POTOMITAN is selected, nothing is proved.
        let on_file = health(HealthInput {
            internet_up: false,
            mesh_peers: 3,
            ..ready_input()
        });
        assert_eq!(on_file.mesh_mode, MeshMode::Potomitan);
        assert!(!on_file.mesh_reachable);
        assert!(!on_file.mesh_packet_plane);
        assert_eq!(on_file.mesh_routes, 0);
        assert_eq!(on_file.mesh_proven_peers, 0);
        // A bound plane that no known peer reached yet proves no reach.
        let bound = health(HealthInput {
            internet_up: false,
            mesh_peers: 3,
            mesh_plane: PlaneProof {
                bound: true,
                proven_peers: 0,
                routes: 3,
            },
            ..ready_input()
        });
        assert!(!bound.mesh_reachable);
        assert!(bound.mesh_packet_plane);
        assert_eq!(bound.mesh_routes, 3);
        // A bound plane that a known peer reached is the mesh path health reports.
        let proven = health(HealthInput {
            internet_up: false,
            mesh_peers: 3,
            mesh_plane: PlaneProof {
                bound: true,
                proven_peers: 1,
                routes: 3,
            },
            ..ready_input()
        });
        assert!(proven.mesh_reachable);
        assert_eq!(proven.mesh_proven_peers, 1);
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
        assert!(report.sqlite_closed);
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
        assert_eq!(
            rollup_status(true, true, Some("load failed"), false),
            "degraded"
        )
    }

    #[test]
    fn rollup_status_ok_when_ready() {
        assert_eq!(rollup_status(true, true, None, false), "ok")
    }
}
