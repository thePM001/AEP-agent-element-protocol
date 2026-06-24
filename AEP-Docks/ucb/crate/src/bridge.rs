//! Ingest and rollback orchestration (dock-first ordering).

use crate::config::UcbConfig;
use crate::ingress::{validate_foreign_ingest_with_context, ForeignIngestBody};
use crate::journal::DiffJournal;
use crate::lattice::LatticeRuntime;
use crate::manifest::{SynthesisRequest, SynthesisError};
use crate::store::{ManifestStore, TaskManifestV1};
use crate::translator::translate_foreign_ingest;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct UcbRuntime {
    pub config: UcbConfig,
    pub lattice: LatticeRuntime,
    pub journal: DiffJournal,
    pub manifests: ManifestStore,
}

impl UcbRuntime {
    pub fn new(config: UcbConfig) -> std::io::Result<Self> {
        let lattice = LatticeRuntime::from_env(&config.data_dir);
        let journal = DiffJournal::new(&config.data_dir);
        let manifests = ManifestStore::new(config.manifest_dir.clone())?;
        Ok(Self {
            config,
            lattice,
            journal,
            manifests,
        })
    }
}

pub async fn ingest_foreign_payload(
    rt: &Arc<UcbRuntime>,
    body: ForeignIngestBody,
) -> Value {
    let prior = rt.journal.prior_fingerprints(200);
    let validation = validate_foreign_ingest_with_context(&body, &prior);
    if !validation.ok {
        return json!({
            "ok": false,
            "status": "rejected",
            "validation": validation,
        });
    }

    let event = match translate_foreign_ingest(&body) {
        Ok(e) => e,
        Err(err) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "validation": validation,
                "error": err,
            });
        }
    };

    let provided_manifest = body
        .task_manifest
        .as_ref()
        .and_then(|v| serde_json::from_value::<TaskManifestV1>(v.clone()).ok());

    let synth_req = SynthesisRequest {
        agent_id: event.agent_id.clone(),
        session_id: event.session_id.clone(),
        intent_summary: intent_summary(&body),
        allowed_operations: allowed_operations(&body),
        trust_score: event.trust_score,
    };

    let manifest = match crate::manifest::synthesize_or_load(
        &rt.config,
        &rt.manifests,
        &synth_req,
        provided_manifest,
    )
    .await
    {
        Ok(m) => m,
        Err(SynthesisError::NoManifestSource) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "error": SynthesisError::NoManifestSource.to_string(),
                "hint": "provide task_manifest in ingest body, or configure UCB_GAP_ENGINE_URL / UCB_CONSTRAINED_DECODER_URL / UCB_LLM_SYNTHESIS_URL",
            });
        }
        Err(SynthesisError::TiersFailed) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "error": SynthesisError::TiersFailed.to_string(),
            });
        }
        Err(SynthesisError::Http(e)) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "error": e,
            });
        }
    };

    let dock_port = event.docking_port.clone();
    let socket_path = match rt.lattice.dock_path(&dock_port) {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "validation": validation,
                "error": e,
            });
        }
    };

    let built = match rt.lattice.build_frame(&event) {
        Ok(b) => b,
        Err(e) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "validation": validation,
                "error": e,
            });
        }
    };

    let docked = match rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame.clone(),
            event.trust_score,
            built.signer_public_hex.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "validation": validation,
                "error": e,
            });
        }
    };

    let recorded = match rt.lattice.seal_and_record(&event) {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "validation": validation,
                "error": e,
            });
        }
    };

    let event_id = recorded.event_id.or(docked.event_id);
    let frame_digest = recorded
        .frame_digest
        .or(docked.digest)
        .or(built.digest);

    let diff = rt
        .journal
        .with_lock(|| {
            rt.journal.append(json!({
                "operation": "extend_write",
                "event_id": event_id,
                "frame_digest": frame_digest,
                "binding_fingerprint": event.payload.get("binding_fingerprint").cloned(),
                "foreign_protocol": event.payload.get("foreign_protocol").cloned(),
                "session_id": event.session_id,
                "snapshot": {
                    "agent_id": event.agent_id,
                    "event_type": event.event_type,
                    "payload": event.payload,
                    "task_manifest_id": manifest.id,
                },
            }))
        })
        .await;

    let diff = match diff {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "status": "rejected",
                "error": e.to_string(),
            });
        }
    };

    json!({
        "ok": true,
        "status": "integrated",
        "validation": validation,
        "event_id": event_id,
        "frame_digest": frame_digest,
        "diff_id": diff.diff_id,
        "task_manifest_id": manifest.id,
        "task_manifest_provisional": manifest.provisional,
        "synthesized_by": manifest.synthesized_by,
        "lattice_event": event,
    })
}

pub async fn rollback_foreign_integrations(rt: &Arc<UcbRuntime>, steps: usize) -> Value {
    let peeked = rt.journal.with_lock(|| rt.journal.peek(steps)).await;
    if peeked.0 == 0 {
        return json!({
            "ok": false,
            "error": "no diff records to rollback",
            "rolled_back": 0,
        });
    }

    let rollback_event = crate::translator::LatticeEvent {
        agent_id: "ucb-bridge".into(),
        channel_id: "ch-ucb-rollback".into(),
        contract_id: "dynaep-action-lattice".into(),
        event_type: "UCB_ROLLBACK".into(),
        session_id: format!("ucb-rollback-{}", now_ms()),
        docking_port: "validation_engine".into(),
        trust_score: 800,
        payload: json!({
            "rolled_back": peeked.0,
            "diff_ids": peeked.1.iter().map(|r| &r.diff_id).collect::<Vec<_>>(),
            "reverted_event_ids": peeked.1.iter().filter_map(|r| r.event_id).collect::<Vec<_>>(),
            "bridge": crate::BRIDGE_ID,
        }),
    };

    let socket_path = match rt.lattice.dock_path("validation_engine") {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e, "rolled_back": 0 }),
    };

    let built = match rt.lattice.build_frame(&rollback_event) {
        Ok(b) => b,
        Err(e) => return json!({ "ok": false, "error": e, "rolled_back": 0 }),
    };

    if let Err(e) = rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame,
            rollback_event.trust_score,
            built.signer_public_hex.as_deref(),
        )
        .await
    {
        return json!({ "ok": false, "error": e, "rolled_back": 0 });
    }

    let recorded = match rt.lattice.seal_and_record(&rollback_event) {
        Ok(r) => r,
        Err(e) => return json!({ "ok": false, "error": e, "rolled_back": 0 }),
    };

    let popped = rt.journal.with_lock(|| rt.journal.pop(steps)).await;

    json!({
        "ok": true,
        "status": "rolled_back",
        "rolled_back": popped.0,
        "diff_ids": popped.1.iter().map(|r| &r.diff_id).collect::<Vec<_>>(),
        "event_id": recorded.event_id,
        "frame_digest": recorded.frame_digest,
    })
}

fn intent_summary(body: &ForeignIngestBody) -> String {
    if let Some(s) = body
        .payload
        .get("intent")
        .or(body.content.as_ref().and_then(|c| c.get("intent")))
        .and_then(|v| v.as_str())
    {
        return s.to_string();
    }
    let payload = if !body.payload.is_null() {
        &body.payload
    } else if let Some(c) = &body.content {
        c
    } else {
        &body.data.clone().unwrap_or(json!({}))
    };
    if let Some(fact) = payload.as_object() {
        if let (Some(s), Some(p), Some(o)) = (
            fact.get("subject").and_then(|v| v.as_str()),
            fact.get("predicate").and_then(|v| v.as_str()),
            fact.get("object").and_then(|v| v.as_str()),
        ) {
            return format!("{s} {p} {o}");
        }
    }
    format!("ucb foreign ingest via {}", body.protocol.as_deref().unwrap_or("custom"))
}

fn allowed_operations(body: &ForeignIngestBody) -> Vec<String> {
    body.payload
        .get("allowed_operations")
        .or(body.task_manifest.as_ref().and_then(|m| m.get("intent")).and_then(|i| i.get("allowed_operations")))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .filter(|v: &Vec<String>| !v.is_empty())
        .unwrap_or_else(|| vec!["ucb.ingest".into()])
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}