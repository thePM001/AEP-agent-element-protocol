//! Collect-all Admit then Apply for held dock capsules.

use super::outbound::{self, OutboundJob};
use super::pulse::{settle_held, HeldCapsule};
use super::{
    deny_closed, deny_resp, deny_resp_report, dock_lock, lock_or_deny, port_event_type,
    DockFrameResponse, DockingRuntime,
};
use crate::dock_keys::decode_signer_public_hex;
use crate::envelope_admit::admit_sealed_payload_report_recorded;
use crate::{
    enforce_writing_value, record_channel_frame, record_side_channel_anomaly,
    value_has_writing_violations, BaseNodeError, SideChannelAnomalyKind,
};
use aep_admit::AdmitWall;
use aep_lattice_channel::DockingPort;
use aep_lattice_gated_fetch::gateway_request_of;
use aep_wall_set_backpressure::CLASS_SECURITY;
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
    runtime.admit.lrps.iter().any(|lrp| lrp == contract_id)
}

pub(crate) fn enforce_correctwriting_en_on_payload(plaintext: &[u8]) -> Result<(), BaseNodeError> {
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
        return Err(BaseNodeError::CorrectwritingEnWriting);
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
    let db = dock_lock!(&runtime.record.db, "db");
    let _ = record_side_channel_anomaly(&db, kind, agent_id, port, detail.clone());
    deny_resp(None, detail)
}

/// Bind dock verify key to the registered agent key only.
/// Wire `signer_public_hex` is never trusted alone (CRITICAL: impersonation).
/// If both registered and wire keys are present they must match; mismatch fails closed.
// DockFrameResponse is the reply the node sends as is, so the deny path returns it unboxed.
#[allow(clippy::result_large_err)]
pub(crate) fn resolve_signer_public(
    runtime: &DockingRuntime,
    agent_id: &str,
    signer_public_hex: Option<String>,
) -> Result<Option<Vec<u8>>, DockFrameResponse> {
    let registered = {
        let from_store =
            lock_or_deny(&runtime.keys.agent_sign_keys, "agent_sign_keys")?.public_for(agent_id);
        let from_manifest = {
            let manifests = lock_or_deny(&runtime.admit.manifests, "manifests")?;
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
pub(crate) fn attested_trust_score(
    plaintext: &[u8],
    _wire_trust_score: Option<u16>,
) -> Option<u16> {
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

// DockFrameResponse is the reply the node sends as is, so the deny path returns it unboxed.
#[allow(clippy::result_large_err)]
pub(crate) fn resolve_agent_bundle(
    runtime: &DockingRuntime,
    agent_id: &str,
    trust_score: Option<u16>,
    sign_public: &[u8],
) -> Result<aep_agentmesh::AgentMeshBundle, DockFrameResponse> {
    let score = match trust_score {
        Some(s) => s,
        None => {
            let map = lock_or_deny(&runtime.keys.agent_trust, "agent_trust")?;
            map.get(agent_id).copied().unwrap_or(0)
        }
    };
    let mut bundles = lock_or_deny(&runtime.keys.agent_bundles, "agent_bundles")?;
    let mut trust_map = lock_or_deny(&runtime.keys.agent_trust, "agent_trust")?;
    trust_map.insert(agent_id.to_string(), score);
    let entry = match bundles.entry(agent_id.to_string()) {
        std::collections::hash_map::Entry::Occupied(slot) => slot.into_mut(),
        std::collections::hash_map::Entry::Vacant(slot) => {
            match crate::agentmesh_bundle_for_frame(agent_id, score, sign_public) {
                Ok(bundle) => slot.insert(bundle),
                Err(e) => {
                    return Err(deny_closed(
                        None,
                        e.to_string(),
                        "agentmesh.identity",
                        CLASS_SECURITY,
                    ))
                }
            }
        }
    };
    entry.trust_score = score;
    Ok(entry.clone())
}

/// Settles a held digest with a Deny when the apply step ends before it recorded an answer.
///
/// The frame remains in the held map while Admit runs. If the step unwinds, this
/// guard moves the digest out of the held map with a closed answer, so a caller
/// that collects later reads a Deny and never waits on a frame nobody will finish.
pub(crate) struct HeldGuard<'a> {
    runtime: &'a DockingRuntime,
    digest: &'a str,
    settled: bool,
}

impl<'a> HeldGuard<'a> {
    pub(crate) fn new(runtime: &'a DockingRuntime, digest: &'a str) -> Self {
        Self {
            runtime,
            digest,
            settled: false,
        }
    }

    pub(crate) fn settle(&mut self, resp: DockFrameResponse) {
        self.settled = true;
        if let Ok(mut pulse) = lock_or_deny(&self.runtime.record.pulse, "pulse") {
            settle_held(&mut pulse, self.digest, resp);
        }
    }

    /// Hand an admitted gateway frame to its outbound request. The request records the
    /// answer when it settles.
    pub(crate) fn hand_off(&mut self, job: OutboundJob) {
        self.settled = true;
        outbound::start(
            &self.runtime.record.pulse,
            self.runtime.outbound.policy,
            job,
        );
    }
}

impl Drop for HeldGuard<'_> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        self.settle(deny_closed(
            Some(String::from(self.digest)),
            String::from("apply ended before the answer was recorded"),
            "apply.interrupted",
            CLASS_SECURITY,
        ));
    }
}

/// The answer of one released capsule: now, or when its outbound request settles.
pub(crate) enum HeldAnswer {
    Now(DockFrameResponse),
    Outbound(OutboundJob),
}

/// Run Admit then Apply for one released capsule.
///
/// The frame is copied out of the held map and remains there while Admit runs.
/// The answer is recorded and the frame leaves the held map in the same pulse
/// lock step, so a collect that arrives at any moment reads pending or the answer.
/// An admitted gateway frame moves to the outbound book in one step instead and reads
/// pending until its request settles.
pub(crate) fn apply_held_capsule(
    runtime: &DockingRuntime,
    cap: &aep_base_node_pulse::QueuedCapsule,
) {
    let held = match lock_or_deny(&runtime.record.pulse, "pulse") {
        Ok(pulse) => match pulse.held.get(&cap.digest) {
            Some(h) => h.clone(),
            None => return,
        },
        Err(_) => return,
    };
    let mut guard = HeldGuard::new(runtime, &cap.digest);
    match answer_held_capsule(runtime, cap, &held) {
        HeldAnswer::Now(resp) => guard.settle(resp),
        HeldAnswer::Outbound(job) => guard.hand_off(job),
    }
}

/// Action path of the opened event. Empty when the plaintext is not JSON or names none.
fn action_path_of(event: Option<&Value>) -> String {
    event
        .and_then(|v| v.get("action_path"))
        .and_then(|x| x.as_str())
        .map(String::from)
        .unwrap_or_default()
}

/// Write the ledger row of an admitted frame. Runs as the record step of Admit, after
/// every wall is open and before Apply, so no state changes without its row.
// DockFrameResponse is the reply the node sends as is, so the deny path returns it unboxed.
#[allow(clippy::result_large_err)]
fn record_admitted_frame(
    runtime: &DockingRuntime,
    cap: &aep_base_node_pulse::QueuedCapsule,
    held: &HeldCapsule,
    event_type: &str,
) -> Result<i64, DockFrameResponse> {
    let db = lock_or_deny(&runtime.record.db, "db")?;
    match record_channel_frame(&db, &held.frame, event_type, &held.bundle, None) {
        Ok(event_id) => Ok(event_id),
        Err(e) => Err(deny_closed(
            Some(cap.digest.clone()),
            format!("ledger unavailable: {e}"),
            "ledger.unavailable",
            "ledger.unavailable",
        )),
    }
}

/// Admit, the ledger row, Apply and only then the side effects of one held capsule.
///
/// Order of one admitted frame:
/// 1. Admit: every wall, the hub permission of the signer among them, in one collect-all.
///    On the gateway path the route list and the request bound of the signer are walls too.
/// 2. Record: the ledger row is written while the live entry is still unchanged.
/// 3. Apply: the live entry records the action, the sequence number and the budget spend.
/// 4. Side effects: the LRP contract registration, and on the gateway path the bound
///    outbound request, which runs on a thread of its own.
///
/// A Deny at step 1 or a ledger error at step 2 leaves the live entry unchanged, registers
/// nothing and sends nothing. Lock order: the live entry guard is held while the record
/// step takes record.db. No path takes record.db first and the live entry second. The
/// request slot is reserved under the pulse lock before the live entry lock is taken.
fn answer_held_capsule(
    runtime: &DockingRuntime,
    cap: &aep_base_node_pulse::QueuedCapsule,
    held: &HeldCapsule,
) -> HeldAnswer {
    let event = serde_json::from_slice::<Value>(&held.plaintext).ok();
    let action = action_path_of(event.as_ref());
    // The hub is asked for the signer of the frame. Its answer is an Admit wall, so a hub
    // deny is decided with every other wall and never after Apply.
    let hub_permitted = runtime.admit.hub.agent_may(&held.frame.agent_id, &action);
    let dock = aep_admit_live_dock::LiveDockContext::from_open_frame(
        &held.frame.channel_id,
        &held.frame.agent_id,
        &held.frame.session_id,
        dock_port_name(&held.expected_port),
        &held.frame.contract_id,
    )
    .with_hub_permission(hub_permitted);
    // Only an event on the gateway path is a request. A url field of any other event is
    // data. The route list and the slot of the signer become Admit walls. The slot guard
    // returns the slot on every path except the one that hands it to the request.
    let gateway = event.as_ref().and_then(gateway_request_of);
    let mut slot: Option<outbound::SlotGuard<'_>> = None;
    let dock = match &gateway {
        None => dock,
        Some(request) => {
            let route = match request {
                Ok(spec) => runtime.outbound.route_verdict(spec),
                Err(e) => Err(e.clone()),
            };
            slot = outbound::reserve_slot(&runtime.record.pulse, &held.frame.agent_id);
            dock.with_gateway(route, slot.is_some())
        }
    };
    let event_id = match admit_and_apply(runtime, cap, held, event.as_ref(), dock) {
        Ok(event_id) => event_id,
        Err(resp) => return HeldAnswer::Now(resp),
    };
    match (gateway, slot) {
        (Some(Ok(spec)), Some(slot)) => {
            slot.hand_to_request();
            HeldAnswer::Outbound(OutboundJob {
                digest: cap.digest.clone(),
                agent_id: held.frame.agent_id.clone(),
                event_id,
                spec,
            })
        }
        _ => HeldAnswer::Now(DockFrameResponse {
            ok: true,
            event_id: Some(event_id),
            digest: Some(cap.digest.clone()),
            error: None,
            pong: None,
            http: None,
            deny: None,
            pending: None,
            http_queued: None,
        }),
    }
}

/// Admit, the record step and Apply of one held capsule. Returns the event id of the row.
// DockFrameResponse is the reply the node sends as is, so the deny path returns it unboxed.
#[allow(clippy::result_large_err)]
fn admit_and_apply(
    runtime: &DockingRuntime,
    cap: &aep_base_node_pulse::QueuedCapsule,
    held: &HeldCapsule,
    event: Option<&Value>,
    dock: aep_admit_live_dock::LiveDockContext,
) -> Result<i64, DockFrameResponse> {
    let event_type = if held.expected_port == DockingPort::RegulationModule {
        "docking_regulation_lattice"
    } else {
        port_event_type(&held.expected_port)
    };
    let mut recorded: Option<i64> = None;
    let mut record_deny: Option<DockFrameResponse> = None;
    // The live entry guard lives for this block only, so the lock is released
    // before the record check and before Apply.
    let admit_res = {
        let mut live = lock_or_deny(&runtime.admit.live_entry, "live_entry")?;
        // The time walls of Admit measure against the event time that the kernel
        // checked against its own clock at enqueue. The hold and the age of the
        // capsule were judged by the kernel clock alone in the pulse queue.
        live.freeze_temporal_snapshot(held.wall_bridge_ms);
        let r =
            admit_sealed_payload_report_recorded(&mut live, &held.plaintext, &dock, &mut || {
                match record_admitted_frame(runtime, cap, held, event_type) {
                    Ok(event_id) => {
                        recorded = Some(event_id);
                        Ok(())
                    }
                    Err(resp) => {
                        let reason = resp.error.clone().unwrap_or_default();
                        record_deny = Some(resp);
                        Err(AdmitWall::close("ledger.unavailable", reason))
                    }
                }
            });
        live.clear_temporal_freeze();
        r
    };
    // The record step refused: nothing was applied and the ledger cannot take a row.
    if let Some(resp) = record_deny {
        return Err(resp);
    }
    if let Err(report) = admit_res {
        let detail = report.error.clone();
        if let Ok(db) = lock_or_deny(&runtime.record.db, "db") {
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::EnvelopeAdmitRejected,
                &held.frame.agent_id,
                &held.expected_port,
                detail.clone(),
            );
        }
        return Err(deny_resp_report(Some(cap.digest.clone()), detail, report));
    }
    let Some(event_id) = recorded else {
        return Err(deny_closed(
            Some(cap.digest.clone()),
            String::from("apply ended without a ledger row"),
            "ledger.unavailable",
            "ledger.unavailable",
        ));
    };
    crate::dock_event!(debug, crate::dock_log::DockEvent::FrameApply, event_id, digest = %cap.digest, "frame applied");
    let register_lrp = held.expected_port == DockingPort::RegulationModule
        && event.and_then(|v| v.get("action")).and_then(|x| x.as_str()) == Some("register_lrp");
    if register_lrp {
        if let Ok(mut contracts) = lock_or_deny(&runtime.admit.contracts, "contracts") {
            contracts.register(&held.frame.contract_id)
        }
    }
    Ok(event_id)
}
