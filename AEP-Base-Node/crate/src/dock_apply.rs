//! Collect-all Admit then Apply for held dock capsules. AEP28-ENV-079.

use super::{
    attach_gateway_http_after_allow, deny_resp, deny_resp_report, dock_lock, lock_or_deny,
    port_event_type, DockFrameResponse, DockingRuntime,
};
use aep_lattice_channel::DockingPort;
use crate::dock_keys::decode_signer_public_hex;
use crate::envelope_admit::admit_sealed_payload_report;
use crate::{
    enforce_writing_value, record_channel_frame, record_side_channel_anomaly,
    value_has_writing_violations, BaseNodeError, SideChannelAnomalyKind,
};
use serde_json::Value;

pub(crate) fn dock_port_name(port: &DockingPort) -> &'static str {
    match port {
        DockingPort::InferenceEngine => "inference_engine",
        DockingPort::ValidationEngine => "validation_engine",
        DockingPort::FutureFeatures => "future_features",
        DockingPort::RegulationModule => "regulation_module",
    }
}

pub(crate) fn is_lrp_allowlisted(runtime: &DockingRuntime, contract_id: &str) -> bool {
    runtime.lrps.iter().any(|lrp| lrp == contract_id)
}

pub(crate) fn enforce_epscom_on_payload(plaintext: &[u8]) -> Result<(), BaseNodeError> {
    let Ok(value) = serde_json::from_slice::<Value>(plaintext) else {
        return Ok(());
    };
    let target = if let Some(payload) = value.get("payload") {
        payload
    } else {
        &value
    };
    let enforced = enforce_writing_value(target);
    if value_has_writing_violations(&enforced) {
        return Err(BaseNodeError::EpscomWriting);
    }
    Ok(())
}

pub(crate) fn reject_side_channel(
    runtime: &DockingRuntime,
    port: &DockingPort,
    agent_id: &str,
    kind: SideChannelAnomalyKind,
    detail: String,
) -> DockFrameResponse {
    let db = dock_lock!(&runtime.db, "db");
    let _ = record_side_channel_anomaly(&db, kind, agent_id, port, detail.clone());
    deny_resp(None, detail)
}

/// Bind dock verify key to the registered agent key only.
/// Wire `signer_public_hex` is never trusted alone (CRITICAL: impersonation).
/// If both registered and wire keys are present they must match; mismatch fails closed.
pub(crate) fn resolve_signer_public(
    runtime: &DockingRuntime,
    agent_id: &str,
    signer_public_hex: Option<String>,
) -> Result<Option<Vec<u8>>, DockFrameResponse> {
    let registered = {
        let from_store = match lock_or_deny(&runtime.agent_sign_keys, "agent_sign_keys") {
            Ok(g) => g.public_for(agent_id),
            Err(resp) => return Err(resp),
        };
        let from_manifest = {
            let manifests = match lock_or_deny(&runtime.manifests, "manifests") {
                Ok(g) => g,
                Err(resp) => return Err(resp),
            };
            manifests
                .signer_public_hex(agent_id)
                .and_then(|hex_str| decode_signer_public_hex(&hex_str))
        };
        match (from_store, from_manifest) {
            (Some(store_pk), Some(manifest_pk)) => {
                if signer_public_keys_equal(&store_pk, &manifest_pk) {
                    Some(store_pk)
                } else {
                    None
                }
            }
            (Some(store_pk), None) => Some(store_pk),
            (None, Some(manifest_pk)) => Some(manifest_pk),
            (None, None) => None,
        }
    };

    let wire = signer_public_hex
        .as_ref()
        .and_then(|hex_str| decode_signer_public_hex(hex_str));

    Ok(match (registered, wire) {
        (Some(reg), Some(wire_pk)) => {
            if signer_public_keys_equal(&reg, &wire_pk) {
                Some(reg)
            } else {
                None
            }
        }
        (Some(reg), None) => Some(reg),
        (None, Some(_)) => None,
        (None, None) => None,
    })
}

fn signer_public_keys_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// BM-07: derive trust only from signed plaintext; ignore unbound wire field.
pub(crate) fn attested_trust_score(plaintext: &[u8], _wire_trust_score: Option<u16>) -> Option<u16> {
    let Ok(value) = serde_json::from_slice::<Value>(plaintext) else {
        return None;
    };
    let t = value
        .get("trust_score")
        .or_else(|| value.get("payload").and_then(|p| p.get("trust_score")))
        .and_then(|v| v.as_u64())?;
    if t > 1000 {
        return None;
    }
    Some(t as u16)
}

pub(crate) fn resolve_agent_bundle(
    runtime: &DockingRuntime,
    agent_id: &str,
    trust_score: Option<u16>,
    sign_public: &[u8],
) -> Result<aep_agentmesh::AgentMeshBundle, DockFrameResponse> {
    let score = match trust_score {
        Some(s) => s,
        None => {
            let map = match lock_or_deny(&runtime.agent_trust, "agent_trust") {
                Ok(g) => g,
                Err(resp) => return Err(resp),
            };
            map.get(agent_id).copied().unwrap_or(0)
        }
    };
    let mut bundles = match lock_or_deny(&runtime.agent_bundles, "agent_bundles") {
        Ok(g) => g,
        Err(resp) => return Err(resp),
    };
    let mut trust_map = match lock_or_deny(&runtime.agent_trust, "agent_trust") {
        Ok(g) => g,
        Err(resp) => return Err(resp),
    };
    trust_map.insert(agent_id.to_string(), score);
    let entry = bundles
        .entry(agent_id.to_string())
        .or_insert_with(|| crate::agentmesh_bundle_for_frame(agent_id, score, sign_public));
    entry.trust_score = score;
    Ok(entry.clone())
}

pub(crate) fn apply_held_capsule(runtime: &DockingRuntime, cap: &aep_base_node_pulse::QueuedCapsule) {
    let held = match lock_or_deny(&runtime.pulse, "pulse") {
        Ok(mut pulse) => match pulse.held.remove(&cap.digest) {
            Some(h) => h,
            None => return,
        },
        Err(_) => return,
    };
    let dock = aep_admit_live_dock::LiveDockContext::from_open_frame(
        &held.frame.channel_id,
        &held.frame.agent_id,
        &held.frame.session_id,
        dock_port_name(&held.expected_port),
        &held.frame.contract_id,
    );
    let admit_res = match lock_or_deny(&runtime.live_entry, "live_entry") {
        Ok(mut live) => {
            live.freeze_temporal_snapshot(cap.freeze.bridge_ts_ms);
            let r = admit_sealed_payload_report(&mut live, &held.plaintext, &dock);
            live.clear_temporal_freeze();
            r
        }
        Err(resp) => {
            if let Ok(mut pulse) = lock_or_deny(&runtime.pulse, "pulse") {
                pulse.last_applied.insert(cap.digest.clone(), resp);
            }
            return;
        }
    };
    if let Err(report) = admit_res {
        let detail = report.error.clone();
        if let Ok(db) = lock_or_deny(&runtime.db, "db") {
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::EnvelopeAdmitRejected,
                &held.frame.agent_id,
                &held.expected_port,
                detail.clone(),
            );
        }
        if let Ok(mut pulse) = lock_or_deny(&runtime.pulse, "pulse") {
            pulse.last_applied.insert(
                cap.digest.clone(),
                deny_resp_report(Some(cap.digest.clone()), detail, report),
            );
        }
        return;
    }
    let event_type = if held.expected_port == DockingPort::RegulationModule {
        "docking_regulation_lattice"
    } else {
        port_event_type(&held.expected_port)
    };
    let recorded = match lock_or_deny(&runtime.db, "db") {
        Ok(db) => record_channel_frame(&db, &held.frame, event_type, &held.bundle, None),
        Err(resp) => {
            if let Ok(mut pulse) = lock_or_deny(&runtime.pulse, "pulse") {
                pulse.last_applied.insert(cap.digest.clone(), resp);
            }
            return;
        }
    };
    let resp = match recorded {
        Ok(event_id) => {
            let mut resp = DockFrameResponse {
                ok: true,
                event_id: Some(event_id),
                digest: Some(cap.digest.clone()),
                error: None,
                pong: None,
                http: None,
                deny: None,
            };
            attach_gateway_http_after_allow(&held.plaintext, &mut resp);
            resp
        }
        Err(e) => deny_resp(None, e.to_string()),
    };
    if let Ok(mut pulse) = lock_or_deny(&runtime.pulse, "pulse") {
        pulse.last_applied.insert(cap.digest.clone(), resp);
    }
}
