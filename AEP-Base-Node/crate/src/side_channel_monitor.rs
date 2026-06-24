//! Side-channel defense hooks: forensic logging when dock enforcement triggers.

use aep_lattice_channel::DockingPort;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::now_unix;

pub const SIDE_CHANNEL_EVENT_TYPE: &str = "SIDE_CHANNEL_ANOMALY";

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SideChannelAnomalyKind {
    PlainPingRejected,
    PlainEventRejected,
    PlainRegisterLrpRejected,
    RateLimited,
    ContractInactive,
    PortMismatch,
    OversizedLine,
    InvalidJson,
    MissingTaskManifest,
    ProvisionalManifestRejected,
    TrustScoreExceedsManifest,
    CryptoVerificationFailed,
    FrameReplayRejected,
    StaleFrameRejected,
    EpscomViolationRejected,
    LrpNotAllowlisted,
}

#[derive(Debug, Clone, Serialize)]
pub struct SideChannelAnomaly {
    pub kind: SideChannelAnomalyKind,
    pub agent_id: String,
    pub docking_port: DockingPort,
    pub detail: String,
    pub recorded_at_unix: u64,
}

pub fn record_side_channel_anomaly(
    conn: &Connection,
    kind: SideChannelAnomalyKind,
    agent_id: &str,
    port: &DockingPort,
    detail: impl Into<String>,
) -> rusqlite::Result<i64> {
    let recorded_at = now_unix();
    let anomaly = SideChannelAnomaly {
        kind,
        agent_id: agent_id.into(),
        docking_port: *port,
        detail: detail.into(),
        recorded_at_unix: recorded_at,
    };
    let payload_json = serde_json::to_string(&anomaly).unwrap_or_else(|_| "{}".into());
    conn.execute(
        "INSERT INTO action_lattice_events
         (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            anomaly.agent_id,
            "ch-side-channel-monitor",
            "dynaep-action-lattice",
            format!("side-channel:{:?}:{recorded_at}", kind),
            recorded_at as i64,
            SIDE_CHANNEL_EVENT_TYPE,
            payload_json,
            "{}",
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{event_count, open_lattice_db};

    #[test]
    fn records_anomaly_to_action_lattice() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("anomaly.db");
        let conn = open_lattice_db(&path).expect("open");
        let id = record_side_channel_anomaly(
            &conn,
            SideChannelAnomalyKind::RateLimited,
            "AG-PROBE",
            &DockingPort::ValidationEngine,
            "burst exceeded",
        )
        .expect("record");
        assert!(id > 0);
        assert_eq!(event_count(&conn).expect("count"), 1);
    }
}