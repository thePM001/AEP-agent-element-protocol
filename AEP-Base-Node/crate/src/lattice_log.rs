//! dynAEP Action Lattice event logging for Base Node forensic store.

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
    pub session_id: Option<String>,
    #[serde(default)]
    pub docking_port: DockingPortWire,
    #[serde(default = "default_trust_score")]
    pub trust_score: u16,
    pub payload: Value,
}

fn default_contract() -> String {
    "dynaep-action-lattice".into()
}

fn default_trust_score() -> u16 {
    700
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
    let _ = conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_action_lattice_frame_digest
         ON action_lattice_events(frame_digest);",
    );
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
        .unwrap_or_else(|| Path::new("/tmp").to_path_buf())
}

fn build_sealed_frame(
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<(LatticeChannelFrame, AgentMeshBundle), String> {
    if !contracts.is_active(&input.contract_id) {
        return Err(format!("contract inactive: {}", input.contract_id));
    }

    let mut governed = input.clone();
    governed.payload = enforce_writing_value(&input.payload);

    let keys_dir = resolve_keys_dir(db_path);
    let dock_kem = load_or_create_dock_kem(&keys_dir);
    let mut sign_store = AgentSignKeyStore::load(&keys_dir);
    let sign = sign_store.get_or_create(&input.agent_id);
    sign_store.flush().map_err(|e| e.to_string())?;

    let now = now_unix();
    let bundle = create_bundle(
        &input.agent_id,
        input.trust_score,
        &sign.public,
        vec!["dynaep.validate".into(), "dynaep.lattice".into()],
        now,
    );

    let plaintext = serde_json::json!({
        "event_type": governed.event_type,
        "payload": governed.payload,
        "agentmesh": bundle,
    });
    let plain_bytes = serde_json::to_vec(&plaintext).map_err(|e| e.to_string())?;

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
    .map_err(|e| e.to_string())?;
    Ok((frame, bundle))
}

pub fn record_dynaep_event(
    conn: &Connection,
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<DynAepEventRecord, String> {
    let (frame, bundle) = build_sealed_frame(input, contracts, db_path)?;
    let digest = frame_digest(&frame);
    let recorded_at = frame.sent_at_unix;

    let payload_json =
        serde_json::to_string(&enforce_writing_value(&input.payload)).map_err(|e| e.to_string())?;
    let agentmesh_json = serde_json::to_string(&bundle).map_err(|e| e.to_string())?;

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
    .map_err(|e| e.to_string())?;

    let event_id = conn.last_insert_rowid();
    Ok(DynAepEventRecord {
        ok: true,
        event_id,
        frame_digest: digest,
        recorded_at_unix: recorded_at,
        frame: Some(frame),
    })
}

pub fn export_dynaep_events(conn: &Connection, limit: Option<u32>) -> Result<Vec<DynAepEventExport>, String> {
    let lim = limit.unwrap_or(100).min(10_000);
    let mut stmt = conn
        .prepare(
            "SELECT id, agent_id, channel_id, contract_id, event_type, frame_digest,
                    recorded_at_unix, payload_json, agentmesh_json
             FROM action_lattice_events
             ORDER BY id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
    fn temp_db() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("lattice.db");
        (dir, path)
    }

    #[test]
    fn record_and_export_dynaep_event() {
        let (_dir, path) = temp_db();
        let conn = open_lattice_db(&path).expect("open");
        let input = DynAepEventInput {
            agent_id: "dynaep-bridge".into(),
            channel_id: "ch-local-test".into(),
            contract_id: "dynaep-action-lattice".into(),
            event_type: "STATE_DELTA".into(),
            session_id: Some("sess-1".into()),
            docking_port: DockingPortWire::ValidationEngine,
            trust_score: 700,
            payload: serde_json::json!({ "target_id": "CP-00001", "z": 26 }),
        };
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
}

pub fn build_transport_frame(
    input: &DynAepEventInput,
    contracts: &ContractRegistry,
    db_path: &Path,
) -> Result<LatticeChannelFrame, String> {
    let (frame, _bundle) = build_sealed_frame(input, contracts, db_path)?;
    Ok(frame)
}

