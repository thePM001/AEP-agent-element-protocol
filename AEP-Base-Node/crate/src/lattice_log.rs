//! dynAEP Action Lattice event logging for Base Node forensic store.
//! AEP28-ENV-044: aep-lattice-log Record must go through dock Admit or stop being a kernel write path.

use aep_agentmesh::{create_bundle, AgentMeshBundle};
use aep_lattice_channel::{
    build_frame_for_dock, frame_digest, ContractRegistry, DockingPort, LatticeChannelFrame,
};
use crate::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::{enforce_writing_value, init_action_lattice_db, now_unix, EPSCOM_PRIORITY};
use crate::BaseNodeError;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

/// Test flag. When "1", "true" or "yes", a world-writable lattice db parent is allowed.
pub const ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV: &str =
    "AEP_ALLOW_WORLD_WRITABLE_LATTICE_PARENT";

/// AEP data dir: $AEP_DATA or $HOME/.aep. Never a hardcoded tmp root.
pub fn default_aep_data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("AEP_DATA") {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/var/lib/aep".into());
    PathBuf::from(home).join(".aep")
}

/// Default lattice db path under the AEP data dir. Not tmp.
pub fn default_lattice_db_path() -> PathBuf {
    default_aep_data_dir().join("aep-action-lattice.db")
}

pub fn world_writable_lattice_parent_allowed() -> bool {
    match std::env::var(ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV) {
        Ok(v) => {
            let t = v.trim();
            t == "1" || t.eq_ignore_ascii_case("true") || t.eq_ignore_ascii_case("yes")
        }
        Err(_) => false,
    }
}

fn nearest_existing_parent(path: &Path) -> PathBuf {
    let mut cur = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => PathBuf::from("."),
    };
    loop {
        if cur.as_os_str().is_empty() {
            return PathBuf::from(".");
        }
        if cur.exists() {
            return cur;
        }
        match cur.parent() {
            Some(p) => cur = p.to_path_buf(),
            None => return PathBuf::from("."),
        }
    }
}

fn world_writable_parent_err(path: &Path, parent: &Path) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
        Some(format!(
            "world-writable lattice db parent refused: {} parent={}",
            path.display(),
            parent.display()
        )),
    )
}

/// Deny when the nearest existing parent is world-writable unless `allow` is set.
pub fn refuse_world_writable_lattice_parent_with_allow(
    path: &Path,
    allow: bool,
) -> rusqlite::Result<()> {
    if allow {
        return Ok(());
    }
    let parent = nearest_existing_parent(path);
    match std::fs::metadata(&parent) {
        Ok(meta) => {
            if meta.permissions().mode() & 0o002 != 0 {
                return Err(world_writable_parent_err(path, &parent));
            }
            Ok(())
        }
        Err(e) => Err(rusqlite::Error::ToSqlConversionFailure(Box::new(e))),
    }
}

pub fn refuse_world_writable_lattice_parent(path: &Path) -> rusqlite::Result<()> {
    refuse_world_writable_lattice_parent_with_allow(path, world_writable_lattice_parent_allowed())
}


#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DockingPortWire {
    InferenceEngine,
    #[default]
    ValidationEngine,
    FutureFeatures,
    RegulationModule,
}

impl DockingPortWire {
    fn as_port(&self) -> DockingPort {
        match self {
            Self::InferenceEngine => DockingPort::InferenceEngine,
            Self::ValidationEngine => DockingPort::ValidationEngine,
            Self::FutureFeatures => DockingPort::FutureFeatures,
            Self::RegulationModule => DockingPort::RegulationModule,
        }
    }
}

/// Wire format from TypeScript dynAEP bridge (`sdk-aep-base-node-bridge.ts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynAepEventInput {
    pub agent_id: String,
    pub channel_id: String,
    #[serde(default = "default_contract")]
    pub contract_id: String,
    pub event_type: String,
    #[serde(default)]
    pub action_path: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub docking_port: DockingPortWire,
    /// Isolation telemetry. Live Admit does not use this field as a wall.
    /// Isolation telemetry. Live Admit does not use this field as a wall.
    #[serde(default = "default_trust_score")]
    pub trust_score: u16,
    pub payload: Value,
}

fn default_contract() -> String {
    "dynaep-action-lattice".into()
}

fn default_trust_score() -> u16 {
    // Fail-closed: omitted ingest score is least privilege.
    0
}

fn resolve_action_path(input: &DynAepEventInput) -> String {
    if input.action_path.is_empty() == false {
        return input.action_path.clone();
    }
    match input.payload.get("action_path").and_then(|v| v.as_str()) {
        Some(p) => String::from(p),
        None => String::new(),
    }
}

fn docking_port_name(port: &DockingPortWire) -> &'static str {
    match port {
        DockingPortWire::InferenceEngine => "inference_engine",
        DockingPortWire::ValidationEngine => "validation_engine",
        DockingPortWire::FutureFeatures => "future_features",
        DockingPortWire::RegulationModule => "regulation_module",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynAepEventRecord {
    pub ok: bool,
    pub event_id: i64,
    pub frame_digest: String,
    pub recorded_at_unix: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frame: Option<LatticeChannelFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynAepEventExport {
    pub id: i64,
    pub agent_id: String,
    pub channel_id: String,
    pub contract_id: String,
    pub event_type: String,
    pub frame_digest: String,
    pub recorded_at_unix: u64,
    pub payload: Value,
    pub agentmesh: Value,
}

fn migrate_action_lattice_schema(conn: &Connection) -> rusqlite::Result<()> {
    let mut cols = std::collections::HashSet::new();
    let mut stmt = conn.prepare("PRAGMA table_info(action_lattice_events)")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in rows.flatten() {
        cols.insert(name);
    }
    if !cols.contains("event_type") {
        conn.execute(
            "ALTER TABLE action_lattice_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'unknown'",
            [],
        )?;
    }
    if !cols.contains("payload_json") {
        conn.execute(
            "ALTER TABLE action_lattice_events ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'",
            [],
        )?;
    }
    if !cols.contains("agentmesh_json") {
        conn.execute(
            "ALTER TABLE action_lattice_events ADD COLUMN agentmesh_json TEXT NOT NULL DEFAULT '{}'",
            [],
        )?;
    }
    // TASK-A28-H07: unique index is mandatory for local replay protection.
    // Never swallow create-index failures (silent let _ = ... left digests unprotected).
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_action_lattice_frame_digest
         ON action_lattice_events(frame_digest);",
    )?;
    // Prove the index exists (fail closed if schema cannot enforce uniqueness).
    let idx_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_action_lattice_frame_digest'",
        [],
        |r| r.get(0),
    )?;
    if idx_count < 1 {
        return Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
            Some("idx_action_lattice_frame_digest missing after CREATE".into()),
        ));
    }
    Ok(())
}

pub fn open_lattice_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = init_action_lattice_db(path)?;
    migrate_action_lattice_schema(&conn)?;
    Ok(conn)
}

fn resolve_keys_dir(db_path: &Path) -> std::path::PathBuf {
    db_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(default_aep_data_dir)
}

fn build_sealed_frame(
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<(LatticeChannelFrame, AgentMeshBundle, Vec<u8>), BaseNodeError> {
    if !contracts.is_active(&input.contract_id) {
        return Err(BaseNodeError::ContractInactive(input.contract_id.clone()));
    }

    let mut governed = input.clone();
    governed.payload = enforce_writing_value(&input.payload);
    governed.action_path = resolve_action_path(&governed);

    let keys_dir = resolve_keys_dir(db_path);
    let dock_kem = load_or_create_dock_kem(&keys_dir);
    let sign_store = AgentSignKeyStore::load(&keys_dir);
    let sign = sign_store.get(&input.agent_id)?;

    let now = now_unix();
    let ts_ms = (now as i64).saturating_mul(1000);
    let bundle = create_bundle(
        &input.agent_id,
        input.trust_score,
        &sign.public,
        vec!["dynaep.validate".into(), "dynaep.lattice".into()],
        now,
    );

    // AEP28-ENV-044: sealed inner bytes are an Admit event. Dock Admit reads action_path here.
    // AEP28-ENV-066: scene, time and sequence stay bound on the sealed event so unbound fields cannot fail-open.
    let scene_id = governed
        .payload
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let seq = governed
        .payload
        .get("_sequenceNumber")
        .and_then(|v| v.as_i64())
        .unwrap_or(1);
    let plaintext = serde_json::json!({
        "type": governed.event_type,
        "event_type": governed.event_type,
        "action_path": governed.action_path,
        "agent_id": governed.agent_id,
        "payload": governed.payload,
        "timestamp": ts_ms,
        "target_id": scene_id,
        "_sequenceNumber": seq,
    });
    let plain_bytes = serde_json::to_vec(&plaintext)?;

    let frame = build_frame_for_dock(
        &governed.channel_id,
        &governed.agent_id,
        governed.session_id.as_deref().unwrap_or("dynaep-local"),
        governed.docking_port.as_port(),
        &governed.contract_id,
        &plain_bytes,
        &dock_kem.public,
        &sign,
        now,
    )
    .map_err(|e| BaseNodeError::Channel(e.to_string()))?;
    Ok((frame, bundle, plain_bytes))
}

pub fn record_dynaep_event(
    conn: &Connection,
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<DynAepEventRecord, BaseNodeError> {
    let (frame, bundle, plaintext) = build_sealed_frame(input, contracts, db_path)?;
    let digest = frame_digest(&frame);
    let recorded_at = frame.sent_at_unix;

    // AEP28-ENV-044: kernel write only after dock Admit. Deny does not INSERT.
    let keys_dir = resolve_keys_dir(db_path);
    let mut live = crate::envelope_admit::load_live_entry(&keys_dir);
    let ts_ms = (recorded_at as i64).saturating_mul(1000);
    live.set_clock_ms(ts_ms);
    let dock = aep_admit_live_dock::LiveDockContext::from_open_frame(
        &input.channel_id,
        &input.agent_id,
        input.session_id.as_deref().unwrap_or("dynaep-local"),
        docking_port_name(&input.docking_port),
        &input.contract_id,
    );
    crate::envelope_admit::admit_sealed_payload_on_live_dock(&mut live, &plaintext, &dock)?;

    let payload_json =
        serde_json::to_string(&enforce_writing_value(&input.payload))?;
    let agentmesh_json = serde_json::to_string(&bundle)?;

    conn.execute(
        "INSERT INTO action_lattice_events
         (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            input.agent_id,
            input.channel_id,
            input.contract_id,
            digest,
            recorded_at as i64,
            input.event_type,
            payload_json,
            agentmesh_json,
        ],
    )
    ?;

    let event_id = conn.last_insert_rowid();
    Ok(DynAepEventRecord {
        ok: true,
        event_id,
        frame_digest: digest,
        recorded_at_unix: recorded_at,
        frame: Some(frame),
    })
}

pub fn export_dynaep_events(conn: &Connection, limit: Option<u32>) -> Result<Vec<DynAepEventExport>, BaseNodeError> {
    let lim = limit.unwrap_or(100).min(10_000);
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, channel_id, contract_id, event_type, frame_digest,
                    recorded_at_unix, payload_json, agentmesh_json
             FROM action_lattice_events
             ORDER BY id DESC
             LIMIT ?1",
        )
        ?;

    let rows = stmt
        .query_map([lim as i64], |row| {
            let payload_raw: String = row.get(7)?;
            let agentmesh_raw: String = row.get(8)?;
            Ok(DynAepEventExport {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                channel_id: row.get(2)?,
                contract_id: row.get(3)?,
                event_type: row.get(4)?,
                frame_digest: row.get(5)?,
                recorded_at_unix: row.get::<_, i64>(6)? as u64,
                payload: serde_json::from_str(&payload_raw).unwrap_or_else(|_| {
                    serde_json::json!({ "_corrupt": true, "raw": payload_raw })
                }),
                agentmesh: serde_json::from_str(&agentmesh_raw).unwrap_or_else(|_| {
                    serde_json::json!({ "_corrupt": true, "raw": agentmesh_raw })
                }),
            })
        })
        ?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn default_lrps() -> Vec<String> {
    Vec::new()
}

pub fn epscom_priority() -> u8 {
    EPSCOM_PRIORITY
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn temp_db() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("lattice.db");
        (dir, path)
    }

    fn lattice_yaml() -> &'static str {
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_may: []\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_may: [\"dynaep-bridge\"]\n"
    }

    fn plant_lattice(dir: &std::path::Path) {
        std::fs::write(dir.join("lattice.yaml"), lattice_yaml()).expect("lattice");
    }

    fn provision_agent(dir: &std::path::Path, agent_id: &str) {
        let mut store = crate::dock_keys::AgentSignKeyStore::load(dir);
        store.provision(agent_id).expect("provision");
        store.flush().expect("flush");
    }


    fn sample_input(action_path: &str) -> DynAepEventInput {
        DynAepEventInput {
            agent_id: "dynaep-bridge".into(),
            channel_id: "ch-local-test".into(),
            contract_id: "dynaep-action-lattice".into(),
            event_type: "STATE_DELTA".into(),
            action_path: action_path.into(),
            session_id: Some("sess-1".into()),
            docking_port: DockingPortWire::ValidationEngine,
            trust_score: 700,
            payload: serde_json::json!({ "target_id": "CP-00001", "z": 26 }),
        }
    }

    #[test]
    fn record_and_export_dynaep_event() {
        let (dir, path) = temp_db();
        plant_lattice(dir.path());
        provision_agent(dir.path(), "dynaep-bridge");
        let conn = open_lattice_db(&path).expect("open");
        let input = sample_input("root:ping");
        let contracts = crate::bootstrap_contracts_from_lrps(&[]);
        let rec = record_dynaep_event(&conn, &input, &contracts, &path).expect("record");
        assert!(rec.ok);
        assert!(!rec.frame_digest.is_empty());

        let exported = export_dynaep_events(&conn, Some(10)).expect("export");
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].event_type, "STATE_DELTA");
        assert_eq!(exported[0].agent_id, "dynaep-bridge");
        // Must match capsule bundle, not a stale placeholder key.
        assert_ne!(
            exported[0].agentmesh["did"]["verification_key_hex"].as_str(),
            Some("64796e6165702d627269646765"),
        );
    }

    #[test]
    fn record_without_action_path_does_not_write() {
        let (dir, path) = temp_db();
        plant_lattice(dir.path());
        provision_agent(dir.path(), "dynaep-bridge");
        let conn = open_lattice_db(&path).expect("open");
        let input = sample_input("");
        let contracts = crate::bootstrap_contracts_from_lrps(&[]);
        let err = record_dynaep_event(&conn, &input, &contracts, &path).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
        let exported = export_dynaep_events(&conn, Some(10)).expect("export");
        assert_eq!(exported.len(), 0);
    }

    #[test]
    fn record_without_lattice_does_not_write() {
        let (dir, path) = temp_db();
        provision_agent(dir.path(), "dynaep-bridge");
        let conn = open_lattice_db(&path).expect("open");
        let input = sample_input("root:ping");
        let contracts = crate::bootstrap_contracts_from_lrps(&[]);
        let err = record_dynaep_event(&conn, &input, &contracts, &path).expect_err("deny");
        assert!(
            err.to_string().contains("Admit collect-all walls then Apply") || err.to_string().contains("Lattice required")
        );
        let exported = export_dynaep_events(&conn, Some(10)).expect("export");
        assert_eq!(exported.len(), 0);
    }

    #[test]
    fn record_unknown_path_does_not_write() {
        let (dir, path) = temp_db();
        plant_lattice(dir.path());
        provision_agent(dir.path(), "dynaep-bridge");
        let conn = open_lattice_db(&path).expect("open");
        let input = sample_input("bogus:path");
        let contracts = crate::bootstrap_contracts_from_lrps(&[]);
        let err = record_dynaep_event(&conn, &input, &contracts, &path).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
        let exported = export_dynaep_events(&conn, Some(10)).expect("export");
        assert_eq!(exported.len(), 0);
    }

    #[test]
    fn migrates_legacy_action_lattice_schema() {
        let (_dir, path) = temp_db();
        let conn = init_action_lattice_db(&path).expect("legacy open");
        conn.execute(
            "INSERT INTO action_lattice_events (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix)
             VALUES ('legacy', 'ch-legacy', 'dynaep-action-lattice', 'abc', 1)",
            [],
        )
        .expect("legacy insert");

        let migrated = open_lattice_db(&path).expect("migrate");
        let exported = export_dynaep_events(&migrated, Some(10)).expect("export");
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].event_type, "unknown");
    }

    #[test]
    fn omitted_trust_score_is_least_privilege() {
        let raw = r#"{"agent_id":"a","channel_id":"c","event_type":"X","payload":{}}"#;
        let input: DynAepEventInput = serde_json::from_str(raw).expect("parse");
        assert_eq!(input.trust_score, 0);
    }

    #[test]
    fn default_lattice_db_path_fn_body_is_not_tmp() {
        let src = include_str!("lattice_log.rs");
        let start = src
            .find("pub fn default_lattice_db_path")
            .expect("default_lattice_db_path");
        let body = &src[start..start.saturating_add(220)];
        assert!(!body.contains("/tmp"));
        assert!(body.contains("aep-action-lattice.db"));
    }

    #[test]
    fn refuse_world_writable_parent_without_flag() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wide = dir.path().join("wide");
        std::fs::create_dir(&wide).expect("wide");
        let mode = std::fs::Permissions::from_mode(0o0777);
        std::fs::set_permissions(&wide, mode).expect("chmod");
        let db = wide.join("aep-action-lattice.db");
        let err = refuse_world_writable_lattice_parent_with_allow(&db, false)
            .expect_err("refuse");
        let msg = err.to_string();
        assert!(msg.contains("world-writable lattice db parent refused"));
    }

    #[test]
    fn refuse_walks_missing_parent_to_world_writable_ancestor() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wide = dir.path().join("wide");
        std::fs::create_dir(&wide).expect("wide");
        let mode = std::fs::Permissions::from_mode(0o0777);
        std::fs::set_permissions(&wide, mode).expect("chmod");
        let db = wide.join("no-such").join("aep-action-lattice.db");
        let err = refuse_world_writable_lattice_parent_with_allow(&db, false)
            .expect_err("refuse");
        let msg = err.to_string();
        assert!(msg.contains("world-writable lattice db parent refused"));
    }

    #[test]
    fn allow_world_writable_parent_with_flag() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wide = dir.path().join("wide");
        std::fs::create_dir(&wide).expect("wide");
        let mode = std::fs::Permissions::from_mode(0o0777);
        std::fs::set_permissions(&wide, mode).expect("chmod");
        let db = wide.join("aep-action-lattice.db");
        refuse_world_writable_lattice_parent_with_allow(&db, true).expect("allow");
    }

    #[test]
    fn open_lattice_db_private_tempdir_parent_ok() {
        let (_dir, path) = temp_db();
        open_lattice_db(&path).expect("private parent");
    }

    #[test]
    fn open_lattice_db_world_writable_parent_refused() {
        let dir = tempfile::tempdir().expect("tempdir");
        let wide = dir.path().join("wide");
        std::fs::create_dir(&wide).expect("wide");
        let mode = std::fs::Permissions::from_mode(0o0777);
        std::fs::set_permissions(&wide, mode).expect("chmod");
        let db = wide.join("aep-action-lattice.db");
        let err = open_lattice_db(&db).expect_err("refuse open");
        let msg = err.to_string();
        assert!(msg.contains("world-writable lattice db parent refused"));
    }
}

pub fn build_transport_frame(
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<LatticeChannelFrame, BaseNodeError> {
    let (frame, _bundle, _plaintext) = build_sealed_frame(input, contracts, db_path)?;
    Ok(frame)
}