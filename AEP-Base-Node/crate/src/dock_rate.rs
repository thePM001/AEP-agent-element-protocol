//! Signer and process-wide dock rate limits. AEP28-ENV-079.

use super::{deny_resp, dock_lock, DockFrameResponse, DockingRuntime};
use aep_lattice_channel::DockingPort;
use crate::{record_side_channel_anomaly, SideChannelAnomalyKind};

pub(crate) const GLOBAL_RATE_LIMIT: u32 = 600;
pub(crate) const SIGNER_RATE_LIMIT: u32 = 120;

pub(crate) fn rate_limit_response(
    runtime: &DockingRuntime,
    port: &DockingPort,
    agent_id: &str,
    detail: String,
) -> DockFrameResponse {
    let db = dock_lock!(&runtime.db, "db");
    let _ = record_side_channel_anomaly(
        &db,
        SideChannelAnomalyKind::RateLimited,
        agent_id,
        port,
        detail.clone(),
    );
    deny_resp(None, detail)
}
