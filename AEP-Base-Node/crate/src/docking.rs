//! Unix socket listeners for AEP 2.8 Base Node docking ports (Phase 4).
//! AEP28-ENV-079 facade. Split modules: dock_freshness, dock_pulse, dock_rate, dock_serve, dock_apply.

use aep_lattice_channel::{
    frame_digest, ContractRegistry, DockingPort, LatticeChannelFrame,
};
use aep_lattice_gated_fetch::{execute_bound_http_after_allow, gateway_spec_from_plaintext, DockHttp};
use aep_dock_request_poison::{lock_or_poison, poisoned_lock_message};
use aep_wall_set_backpressure::{
    ClosedWall, DenyReport, CLASS_POISON, CLASS_SECURITY, CLASS_TEMPORAL, CLASS_WRITING,
};
#[allow(unused_imports)]
use aep_base_node_pulse::{MAX_FRAME_AGE_SECS, MAX_FRAME_FUTURE_SKEW_SECS};
use crate::dock_keys::signer_rate_key;
#[allow(unused_imports)]
use crate::envelope_admit::admit_sealed_payload_report;
use crate::{
    frame_digest_exists, record_side_channel_anomaly, BaseNodeError, SideChannelAnomalyKind,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;

#[path = "dock_freshness.rs"]
mod dock_freshness;
#[path = "dock_pulse.rs"]
mod dock_pulse;
#[path = "dock_rate.rs"]
mod dock_rate;
#[path = "dock_serve.rs"]
mod dock_serve;
#[path = "dock_apply.rs"]
mod dock_apply;

pub use dock_pulse::{pulse_beat, DockingRuntime, PulseState};
pub use dock_serve::{drain_docking_servers, run_docking_servers, sockets_exist, unlink_sockets};

use dock_apply::{
    attested_trust_score, enforce_epscom_on_payload, is_lrp_allowlisted, reject_side_channel,
    resolve_agent_bundle, resolve_signer_public,
};
use dock_freshness::frame_is_fresh;
use dock_pulse::{collect_applied, pulse_enqueue};
use dock_rate::rate_limit_response;
use dock_serve::DockRequest;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockFrameResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pong: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http: Option<DockHttp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny: Option<DenyReport>,
}

fn poisoned_lock_response(name: &'static str) -> DockFrameResponse {
    let detail = poisoned_lock_message(name);
    deny_closed(None, detail, "lock.poison", CLASS_POISON)
}

pub(crate) fn lock_or_deny<'a, T>(
    mutex: &'a Mutex<T>,
    name: &'static str,
) -> Result<std::sync::MutexGuard<'a, T>, DockFrameResponse> {
    match lock_or_poison(mutex, name) {
        Ok(g) => Ok(g),
        Err(_) => Err(poisoned_lock_response(name)),
    }
}

macro_rules! dock_lock {
    ($mutex:expr, $name:literal) => {
        match $crate::docking::lock_or_deny($mutex, $name) {
            Ok(g) => g,
            Err(resp) => return resp,
        }
    };
}
pub(crate) use dock_lock;

pub fn port_event_type(port: &DockingPort) -> &'static str {
    match port {
        DockingPort::InferenceEngine => "docking_inference_engine",
        DockingPort::ValidationEngine => "docking_validation_engine",
        DockingPort::FutureFeatures => "docking_future_features",
        DockingPort::RegulationModule => "docking_regulation_module",
    }
}

pub(crate) fn deny_closed(digest: Option<String>, error: String, id: &str, class: &str) -> DockFrameResponse {
    deny_resp_report(
        digest,
        error.clone(),
        DenyReport::from_error_and_closed(
            &error,
            &[ClosedWall::with_class(id, error.clone(), class)],
        ),
    )
}

pub(crate) fn deny_resp(digest: Option<String>, error: String) -> DockFrameResponse {
    deny_resp_report(digest, error.clone(), DenyReport::from_error(&error))
}

pub(crate) fn deny_resp_report(
    digest: Option<String>,
    error: String,
    deny: DenyReport,
) -> DockFrameResponse {
    DockFrameResponse {
        ok: false,
        event_id: None,
        digest,
        error: Some(error),
        pong: None,
        http: None,
        deny: Some(deny),
    }
}

pub(crate) fn attach_gateway_http_after_allow(plaintext: &[u8], resp: &mut DockFrameResponse) {
    let Some(spec) = gateway_spec_from_plaintext(plaintext) else {
        return;
    };
    match execute_bound_http_after_allow(&spec) {
        Ok(http) => {
            resp.http = Some(http);
        }
        Err(detail) => {
            resp.ok = false;
            resp.error = Some(detail.clone());
            resp.http = None;
            resp.deny = Some(DenyReport::from_error(&detail));
        }
    }
}

pub fn process_request(
    runtime: &DockingRuntime,
    port: &DockingPort,
    line: &str,
) -> DockFrameResponse {
    let req: DockRequest = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            let db = dock_lock!(&runtime.db, "db");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::InvalidJson,
                "unknown",
                port,
                format!("invalid JSON: {e}"),
            );
            return deny_resp(None, format!("invalid JSON: {e}"));
        }
    };

    match req {
        DockRequest::Frame {
            frame,
            trust_score,
            signer_public_hex,
        } => {
            let _ = pulse_beat(runtime);
            handle_frame(runtime, port, &frame, trust_score, signer_public_hex)
        }
        DockRequest::Ping { .. } => reject_side_channel(
            runtime,
            port,
            "unknown",
            SideChannelAnomalyKind::PlainPingRejected,
            "plain ping rejected: LatticeChannelFrame required".into(),
        ),
        DockRequest::Event { event } => reject_side_channel(
            runtime,
            port,
            &event.agent_id,
            SideChannelAnomalyKind::PlainEventRejected,
            "plain event rejected: seal payload into LatticeChannelFrame via aep-lattice-log build-frame"
                .into(),
        ),
        DockRequest::Collect { collect } => collect_applied(runtime, &collect),
        DockRequest::RegisterLrp { register_lrp } => reject_side_channel(
            runtime,
            port,
            "unknown",
            SideChannelAnomalyKind::PlainRegisterLrpRejected,
            format!(
                "plain register_lrp rejected for {}: use LatticeChannelFrame on regulation_module dock",
                register_lrp.lrp_id
            ),
        ),
    }
}

fn handle_frame(
    runtime: &DockingRuntime,
    expected_port: &DockingPort,
    frame: &LatticeChannelFrame,
    trust_score: Option<u16>,
    signer_public_hex: Option<String>,
) -> DockFrameResponse {
    if &frame.docking_port != expected_port {
        let db = dock_lock!(&runtime.db, "db");
        let detail = format!(
            "docking_port mismatch: frame={:?} listener={:?}",
            frame.docking_port, expected_port
        );
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::PortMismatch,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        return deny_resp(None, detail);
    }

    let signer_public = match resolve_signer_public(runtime, &frame.agent_id, signer_public_hex) {
        Err(resp) => return resp,
        Ok(Some(pk)) => pk,
        Ok(None) => {
            let db = dock_lock!(&runtime.db, "db");
            let detail = format!(
                "signer public key unknown for agent_id={}",
                frame.agent_id
            );
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::CryptoVerificationFailed,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_resp(None, detail);
        }
    };

    let rate_key = signer_rate_key(&signer_public);
    if let Err(e) = dock_lock!(&runtime.global_rate_limiter, "fleet_rate").check("global")
    {
        return rate_limit_response(runtime, expected_port, &frame.agent_id, e.to_string());
    }
    if let Err(e) = dock_lock!(&runtime.rate_limiter, "rate_limiter").check(&rate_key)
    {
        return rate_limit_response(runtime, expected_port, &frame.agent_id, e.to_string());
    }

    if let Err(err) = frame_is_fresh(frame.sent_at_unix) {
        let detail = err.to_string();
        let db = dock_lock!(&runtime.db, "db");
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::StaleFrameRejected,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        let (id, class) = match &err {
            BaseNodeError::FrameStale { .. } => ("temporal:wire_freshness", CLASS_TEMPORAL),
            _ => ("temporal:future_skew", CLASS_TEMPORAL),
        };
        return deny_closed(None, detail, id, class);
    }

    let allow_inactive = expected_port == &DockingPort::RegulationModule;
    let plaintext = if allow_inactive {
        match crate::verify_inbound_dock_frame(
            frame,
            &runtime.dock_kem,
            &signer_public,
            &ContractRegistry::default(),
            true,
        ) {
            Ok(p) => p,
            Err(err) => {
                let detail = err.to_string();
                let db = dock_lock!(&runtime.db, "db");
                let _ = record_side_channel_anomaly(
                    &db,
                    SideChannelAnomalyKind::CryptoVerificationFailed,
                    &frame.agent_id,
                    expected_port,
                    detail.clone(),
                );
                return deny_closed(None, detail, "kem.open", CLASS_SECURITY);
            }
        }
    } else {
        let contracts = dock_lock!(&runtime.contracts, "contracts");
        if !contracts.is_active(&frame.contract_id) {
            let db = dock_lock!(&runtime.db, "db");
            let detail = format!("contract inactive: {}", frame.contract_id);
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::ContractInactive,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_resp(None, detail);
        }
        match crate::verify_inbound_dock_frame(
            frame,
            &runtime.dock_kem,
            &signer_public,
            &contracts,
            false,
        ) {
            Ok(p) => p,
            Err(err) => {
                let detail = err.to_string();
                let db = dock_lock!(&runtime.db, "db");
                let _ = record_side_channel_anomaly(
                    &db,
                    SideChannelAnomalyKind::CryptoVerificationFailed,
                    &frame.agent_id,
                    expected_port,
                    detail.clone(),
                );
                return deny_closed(None, detail, "kem.open", CLASS_SECURITY);
            }
        }
    };

    // BM-07: free outer wire trust_score is NOT authoritative.
    // Only signed plaintext trust_score (or stored agent trust) may drive tier.
    let trust_score = attested_trust_score(&plaintext, trust_score);

    if expected_port == &DockingPort::RegulationModule {
        if let Ok(value) = serde_json::from_slice::<Value>(&plaintext) {
            if value.get("action").and_then(|v| v.as_str()) == Some("register_lrp") {
                if !is_lrp_allowlisted(runtime, &frame.contract_id) {
                    let db = dock_lock!(&runtime.db, "db");
                    let detail = format!(
                        "lrp {} not allowlisted in AEP-Base-Node config lrps[]",
                        frame.contract_id
                    );
                    let _ = record_side_channel_anomaly(
                        &db,
                        SideChannelAnomalyKind::LrpNotAllowlisted,
                        &frame.agent_id,
                        expected_port,
                        detail.clone(),
                    );
                    return deny_resp(None, detail);
                }
                let mut contracts = dock_lock!(&runtime.contracts, "contracts");
                contracts.register(&frame.contract_id);
            }
        }
    }

    {
        let contracts = dock_lock!(&runtime.contracts, "contracts");
        if !contracts.is_active(&frame.contract_id) {
            let db = dock_lock!(&runtime.db, "db");
            let detail = format!("contract inactive: {}", frame.contract_id);
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::ContractInactive,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_resp(None, detail);
        }
    }

    if let Err(err) = enforce_epscom_on_payload(&plaintext) {
        let detail = err.to_string();
        let db = dock_lock!(&runtime.db, "db");
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::EpscomViolationRejected,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        return deny_closed(None, detail, "writing:epscom", CLASS_WRITING);
    }

    // AEP28-ENV-065: freeze and enqueue after digest replay. Admit collect-all then Apply runs on pulse_beat.
    let digest = frame_digest(frame);
    {
        let db = dock_lock!(&runtime.db, "db");
        // Fail closed: DB error treated as replay reject (do not admit frame).
        let seen = match frame_digest_exists(&db, &digest) {
            Ok(v) => v,
            Err(_) => true,
        };
        if seen {
            let detail = format!("frame replay rejected: {digest}");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::FrameReplayRejected,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_closed(None, detail, "digest.replay", CLASS_SECURITY);
        }
    }
    {
        let mut replay = dock_lock!(&runtime.replay_guard, "replay");
        if !replay.check_and_record(&digest, frame.sent_at_unix) {
            let db = dock_lock!(&runtime.db, "db");
            let detail = format!("frame replay rejected: {digest}");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::FrameReplayRejected,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_closed(None, detail, "digest.replay", CLASS_SECURITY);
        }
    }

    {
        let mut manifests = dock_lock!(&runtime.manifests, "manifests");
        manifests.reload_if_stale();
        if let Err(err) =
            manifests.validate_agent(&frame.agent_id, trust_score, Some(frame.session_id.as_str()))
        {
            let detail = err.to_string();
            let kind = match &err {
                BaseNodeError::ManifestProvisional { .. } => SideChannelAnomalyKind::ProvisionalManifestRejected,
                _ => SideChannelAnomalyKind::MissingTaskManifest,
            };
            let db = dock_lock!(&runtime.db, "db");
            let _ = record_side_channel_anomaly(
                &db,
                kind,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_resp(None, detail);
        }
    }

    let bundle = match resolve_agent_bundle(runtime, &frame.agent_id, trust_score, &signer_public) {
        Ok(b) => b,
        Err(resp) => return resp,
    };
    pulse_enqueue(
        runtime,
        frame,
        &plaintext,
        expected_port,
        digest,
        bundle,
    )
}

#[cfg(test)]
#[path = "docking_tests.rs"]
mod tests;
