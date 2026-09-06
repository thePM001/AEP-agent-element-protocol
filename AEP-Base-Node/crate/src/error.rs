//! Typed kernel errors for Base Node. AEP28-ENV-081.
//! Display text stays the prior String so DenyReport wall mapping still matches.

use aep_wall_set_backpressure::{ClosedWall, DenyReport};
use thiserror::Error;

/// Admit failure that keeps the closed-wall set on the typed error.
#[derive(Debug, Clone, Error)]
#[error("{}", .report.error)]
pub struct AdmitDeny {
    pub report: DenyReport,
}

impl AdmitDeny {
    pub fn from_report(report: DenyReport) -> Self {
        Self { report }
    }
}

#[derive(Debug, Clone, Error)]
pub enum BaseNodeError {
    #[error("{0}")]
    Admit(AdmitDeny),
    #[error("EPSCOM writing violations remain after enforcement")]
    EpscomWriting,
    #[error("frame stale: sent_at_unix={sent_at_unix} older than {max_age}s")]
    FrameStale { sent_at_unix: u64, max_age: u64 },
    #[error("frame clock skew: sent_at_unix={sent_at_unix} too far in future")]
    FrameClockSkew { sent_at_unix: u64 },
    #[error("AEP_DOCK_SEAL_KEY decode: {0}")]
    SealKeyDecode(String),
    #[error("AEP_DOCK_SEAL_KEY must be 32 bytes (64 hex chars), got {0}")]
    SealKeyLength(usize),
    #[error("dock-seal.key at {path} has unsafe permissions (need 0600, owner euid)")]
    SealKeyPermissions { path: String },
    #[error("dock-seal.key must be 32 bytes, got {got} at {path}")]
    SealKeyFileLength { got: usize, path: String },
    #[error("unsupported sealed envelope v={v} alg={alg}")]
    SealedEnvelopeUnsupported { v: u32, alg: String },
    #[error("sealed envelope nonce must be 12 bytes")]
    SealedEnvelopeNonce,
    #[error("sealed envelope decrypt failed (wrong seal key or corrupt file)")]
    SealedEnvelopeDecrypt,
    #[error("seal encrypt: {0}")]
    SealEncrypt(String),
    #[error("dock-kem at {path} has world/group-readable permissions; refusing load (chmod 0600 and set AEP_DOCK_KEM_FORCE_REGEN=1 only after operator rotation)")]
    DockKemPermissions { path: String },
    #[error("corrupt or unreadable dock-kem at {path}; refusing silent regeneration (set AEP_DOCK_KEM_FORCE_REGEN=1 to rotate)")]
    DockKemCorrupt { path: String },
    #[error("agent_id is empty")]
    AgentIdEmpty,
    #[error("agent_id exceeds 128 chars")]
    AgentIdTooLong,
    #[error("agent_id has disallowed characters")]
    AgentIdChars,
    #[error("agent-sign-keys load poisoned; fix mode 0600 / seal key or set AEP_AGENT_SIGN_KEYS_FORCE_REGEN=1 before provisioning keys")]
    SignKeysPoisoned,
    #[error("agent {agent_id} has no provisioned sign key; operator must run aep-base-node --provision-agent-sign-key --agent-id {agent_id}")]
    SignKeyMissing { agent_id: String },
    #[error("task manifest missing for agent_id={agent_id}")]
    ManifestMissing { agent_id: String },
    #[error("provisional task manifest for {agent_id}; promotion required: {required:?}")]
    ManifestProvisional {
        agent_id: String,
        required: Vec<String>,
    },
    #[error("session registration required for {agent_id}: manifest.session_id missing under strict mode")]
    SessionMissing { agent_id: String },
    #[error("session registration mismatch for {agent_id}: frame session_id={got} manifest session_id={bound}")]
    SessionMismatch {
        agent_id: String,
        got: String,
        bound: String,
    },
    #[error("session registration required for {agent_id}: manifest binds session_id={bound}")]
    SessionRequired { agent_id: String, bound: String },
    #[error("contract inactive: {0}")]
    ContractInactive(String),
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Hex(String),
    #[error("{0}")]
    Utf8(String),
    #[error("{0}")]
    Json(String),
    #[error("{0}")]
    Crypto(String),
    #[error("{0}")]
    Sqlite(String),
    #[error("{0}")]
    Channel(String),
}

impl BaseNodeError {
    pub fn from_deny_report(report: DenyReport) -> Self {
        BaseNodeError::Admit(AdmitDeny::from_report(report))
    }

    pub fn deny_report(&self) -> DenyReport {
        match self {
            BaseNodeError::Admit(admit) => admit.report.clone(),
            other => DenyReport::from_error(&other.to_string()),
        }
    }

    pub fn closed_walls(&self) -> &[ClosedWall] {
        match self {
            BaseNodeError::Admit(admit) => admit.report.closed.as_slice(),
            _ => &[],
        }
    }
}

impl From<DenyReport> for BaseNodeError {
    fn from(report: DenyReport) -> Self {
        BaseNodeError::from_deny_report(report)
    }
}

impl From<std::io::Error> for BaseNodeError {
    fn from(e: std::io::Error) -> Self {
        BaseNodeError::Io(e.to_string())
    }
}

impl From<hex::FromHexError> for BaseNodeError {
    fn from(e: hex::FromHexError) -> Self {
        BaseNodeError::Hex(e.to_string())
    }
}

impl From<std::string::FromUtf8Error> for BaseNodeError {
    fn from(e: std::string::FromUtf8Error) -> Self {
        BaseNodeError::Utf8(e.to_string())
    }
}

impl From<serde_json::Error> for BaseNodeError {
    fn from(e: serde_json::Error) -> Self {
        BaseNodeError::Json(e.to_string())
    }
}

impl From<rusqlite::Error> for BaseNodeError {
    fn from(e: rusqlite::Error) -> Self {
        BaseNodeError::Sqlite(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admit_keeps_closed_wall_ids() {
        let report = DenyReport::from_error_and_closed(
            "Admit collect-all walls then Apply: missing action_path",
            &[ClosedWall::with_class("action.path", "missing action_path", "structural")],
        );
        let err = BaseNodeError::from(report);
        assert!(err.to_string().contains("missing action_path"));
        assert!(err.closed_walls().iter().any(|w| w.id == "action.path"));
        assert_eq!(err.deny_report().closed[0].id, "action.path");
    }

    #[test]
    fn frame_stale_display_matches_prior_string() {
        let err = BaseNodeError::FrameStale {
            sent_at_unix: 1,
            max_age: 300,
        };
        assert_eq!(
            err.to_string(),
            "frame stale: sent_at_unix=1 older than 300s"
        );
    }
}
