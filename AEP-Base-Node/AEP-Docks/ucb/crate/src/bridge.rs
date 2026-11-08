//! Ingest and rollback. UCB is not a second evaluator.

use crate::config::UcbConfig;
use crate::ingress::ForeignIngestBody;
use crate::journal::{persist_journal_if_admit, DiffJournal};
use crate::lattice::{admit_allow, DockResponse, LatticeDeny, LatticeRuntime};
use crate::manifest;
use crate::store::ManifestStore;
use crate::translator::translate_foreign_ingest;
use aep_ucb_perimeter_v1::reject_over_cap;
use aep_wall_set_backpressure::DenyReport;
use serde_json::Value;
use crate::validate_process::{encode_request, ValidateWaitError, ValidatorProcess};
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Live validator processes at one time. A third check waits for a slot.
pub const VALIDATE_SLOT_LIMIT: usize = 2;

pub fn validation_to_deny(v: &crate::ingress::ValidationResult) -> Value {
    let mut report = DenyReport::from_error(
        &v.error
            .clone()
            .unwrap_or_else(|| String::from("ingest validation refused")),
    );
    if let Some(pred) = v.predicate {
        report.error = format!("{}:{}", pred, report.error);
    }
    let mut val = deny_to_value(report);
    if let Value::Object(map) = &mut val {
        if let Some(pred) = v.predicate {
            map.insert(String::from("predicate"), Value::String(String::from(pred)));
        }
        if let Some(sid) = v.scanner_id {
            if let Ok(sv) = serde_json::to_value(sid) {
                map.insert(String::from("scanner_id"), sv);
            }
        }
    }
    val
}

pub struct UcbRuntime {
    pub config: UcbConfig,
    pub lattice: LatticeRuntime,
    pub journal: DiffJournal,
    pub manifests: ManifestStore,
    pub validate_slots: Arc<Semaphore>,
    /// Program that runs each ingest check in its own confined process.
    pub validator: ValidatorProcess,
}

impl UcbRuntime {
    pub fn new(config: UcbConfig) -> std::io::Result<Self> {
        let lattice = LatticeRuntime::from_env(&config.data_dir);
        let journal = DiffJournal::with_max_bytes(&config.data_dir, config.wire_limits.journal_max_bytes);
        let manifests = ManifestStore::new(config.manifest_dir.clone())?;
        Ok(Self {
            config,
            lattice,
            journal,
            manifests,
            validate_slots: Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT)),
            validator: ValidatorProcess::beside_current_exe(),
        })
    }
}

pub fn deny_to_value(report: DenyReport) -> Value {
    serde_json::to_value(&report).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
}

/// Write the manifest's computed field pointers into payload.ucm.computed_fields. Whatever
/// the foreign agent put there is replaced. It is removed when the manifest declares none, so
/// an agent can neither widen nor narrow the set of fields that need a UCM receipt.
pub fn bind_computed_fields(payload: &mut Value, computed_fields: &[String]) {
    let Some(obj) = payload.as_object_mut() else { return };
    if computed_fields.is_empty() {
        if let Some(ucm) = obj.get_mut("ucm").and_then(Value::as_object_mut) {
            ucm.remove("computed_fields");
        }
        return;
    }
    let ucm = obj.entry("ucm").or_insert_with(|| Value::Object(serde_json::Map::new()));
    if !ucm.is_object() {
        *ucm = Value::Object(serde_json::Map::new());
    }
    if let Some(u) = ucm.as_object_mut() {
        u.insert(
            String::from("computed_fields"),
            Value::Array(computed_fields.iter().cloned().map(Value::String).collect()),
        );
    }
}

fn ingest_ok(fields: serde_json::Map<String, Value>) -> Value {
    let mut m = fields;
    m.insert(String::from("ok"), Value::Bool(true));
    m.insert(String::from("status"), Value::String(String::from("integrated")));
    Value::Object(m)
}

fn attach_ok_admit(mut body: Value, ok: bool, rows: Vec<Value>) -> Value {
    if let Value::Object(map) = &mut body {
        map.insert(String::from("ok"), Value::Bool(ok));
        map.insert(String::from("admit"), Value::Array(rows));
    }
    body
}

pub fn admit_ledger_row(docked: &DockResponse) -> Value {
    let mut m = serde_json::Map::new();
    m.insert(
        String::from("event_id"),
        docked.event_id.map(Value::from).unwrap_or(Value::Null),
    );
    m.insert(
        String::from("digest"),
        docked
            .digest
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null),
    );
    m.insert(
        String::from("deny"),
        docked
            .deny
            .as_ref()
            .and_then(|d| serde_json::to_value(d).ok())
            .unwrap_or(Value::Null),
    );
    m.insert(
        String::from("allow"),
        docked
            .allow
            .clone()
            .unwrap_or(Value::Bool(admit_allow(docked))),
    );
    Value::Object(m)
}

fn dock_denied_ack(docked: &DockResponse, rows: Vec<Value>) -> Value {
    let body = if let Some(deny) = docked.deny.clone() {
        deny_to_value(deny)
    } else {
        deny_to_value(DenyReport::from_error(
            docked
                .error
                .as_deref()
                .unwrap_or("collect-all Admit refused"),
        ))
    };
    attach_ok_admit(body, false, rows)
}

fn ingest_from_lattice_deny(e: LatticeDeny) -> Value {
    let docked = DockResponse {
        ok: false,
        event_id: e.event_id,
        digest: e.digest.clone(),
        error: Some(e.error.clone()),
        deny: e.deny.clone(),
        allow: e.allow.clone(),
        pending: None,
    };
    let rows = vec![admit_ledger_row(&docked)];
    let body = if let Some(deny) = e.deny {
        deny_to_value(deny)
    } else {
        deny_to_value(DenyReport::from_error(&e.error))
    };
    attach_ok_admit(body, false, rows)
}

pub fn ingest_ack_from_admit(
    docked: &DockResponse,
    persist: impl FnOnce() -> Result<serde_json::Map<String, Value>, String>,
) -> Value {
    let rows = vec![admit_ledger_row(docked)];
    match persist_journal_if_admit(admit_allow(docked), persist) {
        None => dock_denied_ack(docked, rows),
        Some(Ok(mut fields)) => {
            fields.insert(String::from("admit"), Value::Array(rows));
            ingest_ok(fields)
        }
        Some(Err(e)) => attach_ok_admit(deny_to_value(DenyReport::from_error(&e)), false, rows),
    }
}

pub async fn ingest_foreign_payload(rt: &Arc<UcbRuntime>, body: ForeignIngestBody) -> Value {
    if body.has_trust_fields() {
        return deny_to_value(manifest::trust_fields_forbidden());
    }
    let encoded = serde_json::to_vec(&body).unwrap_or_default();
    if let Err(e) = reject_over_cap(encoded.len(), rt.config.wire_limits) {
        return deny_to_value(DenyReport::from_error(&e.to_string()));
    }
    let prior = rt.journal.prior_fingerprints(200);
    let profile = rt.config.predicate_profile;
    let request = match encode_request(&body, &prior, profile) {
        Ok(r) => r,
        Err(_) => return deny_to_value(DenyReport::from_error("validate join refused")),
    };
    let validation = match rt
        .validator
        .validate(&rt.validate_slots, rt.config.wire_limits.validate_timeout_ms, &request)
        .await
    {
        Ok(v) => v,
        Err(ValidateWaitError::Busy) => {
            return deny_to_value(DenyReport::from_error("validate busy"))
        }
        Err(ValidateWaitError::Timeout) => {
            return deny_to_value(DenyReport::from_error("validate timeout"))
        }
        Err(ValidateWaitError::Join) => {
            return deny_to_value(DenyReport::from_error("validate join refused"))
        }
    };
    if !validation.ok {
        return validation_to_deny(&validation);
    }
    let mut event = match translate_foreign_ingest(&body) {
        Ok(e) => e,
        Err(err) => return deny_to_value(DenyReport::from_error(&err)),
    };
    event.dock_wire_score = crate::DOCK_WIRE_SCORE;
    let manifest = match manifest::load_or_provided(
        &rt.manifests,
        &event.agent_id,
        &event.session_id,
        body.task_manifest.clone(),
    ) {
        Ok(m) => m,
        Err(report) => return deny_to_value(report),
    };
    if let Err(report) = manifest::bind_session(&manifest, &event.session_id) {
        return deny_to_value(report);
    }
    // The task manifest, never the foreign agent, says which payload fields are computed.
    // Admit checks each of them for a valid UCM receipt (policy ucm-computed-claims).
    bind_computed_fields(&mut event.payload, &manifest.computed_fields);
    let socket_path = match rt.lattice.dock_path(&event.docking_port) {
        Ok(p) => p,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let built = match rt.lattice.build_frame(&event) {
        Ok(b) => b,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let docked = match rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame.clone(),
            event.dock_wire_score,
            built.signer_public_hex.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => return ingest_from_lattice_deny(e),
    };
    if persist_journal_if_admit(admit_allow(&docked), || ()).is_none() {
        return dock_denied_ack(&docked, vec![admit_ledger_row(&docked)]);
    }
    let recorded = match rt.lattice.seal_and_record(&event) {
        Ok(r) => r,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let event_id = recorded.event_id.or(docked.event_id);
    let frame_digest = recorded
        .frame_digest
        .or(docked.digest.clone())
        .or(built.digest);
    let mut snapshot = serde_json::Map::new();
    snapshot.insert(String::from("agent_id"), Value::String(event.agent_id.clone()));
    snapshot.insert(String::from("event_type"), Value::String(event.event_type.clone()));
    snapshot.insert(String::from("payload"), event.payload.clone());
    snapshot.insert(String::from("task_manifest_id"), Value::String(manifest.id.clone()));
    let mut rec = serde_json::Map::new();
    rec.insert(String::from("operation"), Value::String(String::from("extend_write")));
    if let Some(id) = event_id {
        rec.insert(String::from("event_id"), Value::from(id));
    }
    if let Some(d) = frame_digest.clone() {
        rec.insert(String::from("frame_digest"), Value::String(d));
    }
    rec.insert(
        String::from("binding_fingerprint"),
        event
            .payload
            .get("binding_fingerprint")
            .cloned()
            .unwrap_or(Value::Null),
    );
    rec.insert(
        String::from("foreign_protocol"),
        event
            .payload
            .get("foreign_fixture")
            .cloned()
            .unwrap_or(Value::Null),
    );
    rec.insert(String::from("session_id"), Value::String(event.session_id.clone()));
    rec.insert(String::from("snapshot"), Value::Object(snapshot));
    let diff = rt.journal.with_lock(|| rt.journal.append(Value::Object(rec))).await;
    let diff = match diff {
        Ok(d) => d,
        Err(e) => return deny_to_value(DenyReport::from_error(&e.to_string())),
    };
    let mut out = serde_json::Map::new();
    if let Some(id) = event_id {
        out.insert(String::from("event_id"), Value::from(id));
    }
    if let Some(d) = frame_digest {
        out.insert(String::from("frame_digest"), Value::String(d));
    }
    out.insert(String::from("diff_id"), Value::String(diff.diff_id));
    out.insert(String::from("task_manifest_id"), Value::String(manifest.id));
    out.insert(
        String::from("admit"),
        Value::Array(vec![admit_ledger_row(&docked)]),
    );
    ingest_ok(out)
}

pub async fn rollback_foreign_integrations(rt: &Arc<UcbRuntime>, diff_ids: Vec<String>) -> Value {
    if diff_ids.len() != 1 {
        return deny_to_value(DenyReport::from_error(
            "rollback requires exactly one tail diff id",
        ));
    }
    let diff_id = diff_ids[0].clone();
    if let Err(e) = rt
        .journal
        .with_lock(|| rt.journal.check_rollback_named(&diff_ids))
        .await
    {
        return deny_to_value(DenyReport::from_error(&e));
    }
    let mut payload = serde_json::Map::new();
    payload.insert(String::from("diff_id"), Value::String(diff_id.clone()));
    payload.insert(String::from("bridge"), Value::String(String::from(crate::BRIDGE_ID)));
    let rollback_event = crate::translator::LatticeEvent {
        agent_id: "ucb-bridge".into(),
        channel_id: "ch-ucb-rollback".into(),
        contract_id: "dynaep-action-lattice".into(),
        event_type: "UCB_ROLLBACK".into(),
        session_id: format!("ucb-rollback-{}", now_ms()),
        docking_port: "validation_engine".into(),
        action_path: String::new(),
        dock_wire_score: crate::DOCK_WIRE_SCORE,
        payload: Value::Object(payload),
    };
    let socket_path = match rt.lattice.dock_path("validation_engine") {
        Ok(p) => p,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let built = match rt.lattice.build_frame(&rollback_event) {
        Ok(b) => b,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let docked = match rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame,
            rollback_event.dock_wire_score,
            built.signer_public_hex.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => {
            if let Some(deny) = e.deny {
                return deny_to_value(deny);
            }
            return deny_to_value(DenyReport::from_error(&e.error));
        }
    };
    if persist_journal_if_admit(admit_allow(&docked), || ()).is_none() {
        return deny_to_value(DenyReport::from_error("collect-all Admit refused"));
    }
    let recorded = match rt.lattice.seal_and_record(&rollback_event) {
        Ok(r) => r,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let popped = rt.journal.with_lock(|| rt.journal.rollback_tail(&diff_id)).await;
    let popped = match popped {
        Ok(d) => d,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let mut out = serde_json::Map::new();
    out.insert(String::from("ok"), Value::Bool(true));
    out.insert(String::from("status"), Value::String(String::from("rolled_back")));
    out.insert(String::from("diff_id"), Value::String(popped.diff_id));
    if let Some(id) = recorded.event_id {
        out.insert(String::from("event_id"), Value::from(id));
    }
    if let Some(d) = recorded.frame_digest {
        out.insert(String::from("frame_digest"), Value::String(d));
    }
    Value::Object(out)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingress::{ForeignIngestBody, Provenance};
    use crate::journal::persist_after_admit;
    use crate::validate_process::{decode_validation, encode_validation};
    use aep_ucb_perimeter_v1::{PredicateProfile, ScannerId, WireLimits};
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt};


    fn enqueue_dock() -> DockResponse {
        DockResponse {
            ok: true,
            event_id: None,
            digest: Some(String::from("abc")),
            error: None,
            deny: None,
            allow: None,
            pending: None,
        }
    }

    fn allow_dock() -> DockResponse {
        DockResponse {
            ok: true,
            event_id: Some(9),
            digest: Some(String::from("abc")),
            error: None,
            deny: None,
            allow: Some(Value::Bool(true)),
            pending: None,
        }
    }

    fn deny_dock() -> DockResponse {
        DockResponse {
            ok: false,
            event_id: None,
            digest: Some(String::from("abc")),
            error: Some(String::from("Admit denied")),
            deny: Some(DenyReport::from_error("Admit denied")),
            allow: Some(Value::Bool(false)),
            pending: None,
        }
    }

    #[test]
    fn persist_after_admit_false_skips_journal() {
        let mut wrote = false;
        let out = ingest_ack_from_admit(&deny_dock(), || {
            wrote = true;
            Ok(serde_json::Map::new())
        });
        assert!(!wrote);
        assert_eq!(out.get("ok"), Some(&Value::Bool(false)));
        assert!(out.get("admit").and_then(|v| v.as_array()).is_some());
        assert!(!persist_after_admit(false));
    }

    #[test]
    fn enqueue_is_not_ingest_ok() {
        let mut wrote = false;
        let out = ingest_ack_from_admit(&enqueue_dock(), || {
            wrote = true;
            Ok(serde_json::Map::new())
        });
        assert!(!wrote);
        assert_eq!(out.get("ok"), Some(&Value::Bool(false)));
        let rows = out.get("admit").and_then(|v| v.as_array()).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn computed_fields_come_from_the_manifest_only() {
        let mut p = serde_json::json!({ "amount": "64.54", "ucm": { "computed_fields": ["/other"], "receipts": {} } });
        bind_computed_fields(&mut p, &["/amount".to_string()]);
        assert_eq!(p["ucm"]["computed_fields"], serde_json::json!(["/amount"]));
        assert!(p["ucm"]["receipts"].is_object());
        let mut q = serde_json::json!({ "amount": "1", "ucm": { "computed_fields": ["/amount"] } });
        bind_computed_fields(&mut q, &[]);
        assert!(q["ucm"].get("computed_fields").is_none());
        let mut r = serde_json::json!({ "amount": "1", "ucm": "not an object" });
        bind_computed_fields(&mut r, &["/amount".to_string()]);
        assert_eq!(r["ucm"]["computed_fields"], serde_json::json!(["/amount"]));
    }

    #[test]
    fn ingest_allow_returns_admit_rows() {
        let mut wrote = false;
        let out = ingest_ack_from_admit(&allow_dock(), || {
            wrote = true;
            let mut m = serde_json::Map::new();
            m.insert(String::from("diff_id"), Value::String(String::from("d1")));
            Ok(m)
        });
        assert!(wrote);
        assert_eq!(out.get("ok"), Some(&Value::Bool(true)));
        assert_eq!(
            out.get("diff_id"),
            Some(&Value::String(String::from("d1")))
        );
        let rows = out.get("admit").and_then(|v| v.as_array()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get("event_id"), Some(&Value::from(9)));
        assert_eq!(rows[0].get("allow"), Some(&Value::Bool(true)));
    }

    #[test]
    fn ingest_path_uses_admit_gate() {
        let src = include_str!("bridge.rs");
        assert!(src.contains("persist_journal_if_admit"));
        assert!(src.contains("admit_allow"));
        assert!(src.contains("admit_ledger_row"));
        assert!(src.contains("ingest_ack_from_admit"));
        let _ = persist_after_admit(true);
    }

    #[tokio::test]
    async fn oversize_ingest_hard_cap_refused() {
        let limits = WireLimits::default();
        assert!(reject_over_cap(limits.ingest_default_bytes + 1, limits).is_err());
        assert!(reject_over_cap(limits.ingest_hard_bytes + 1, limits).is_err());
        let mut tight = WireLimits::default();
        tight.ingest_default_bytes = 32;
        tight.ingest_hard_bytes = 64;
        let dir = tempfile::tempdir().unwrap();
        let config = UcbConfig {
            listen_host: String::from("127.0.0.1"),
            listen_port: 8412,
            data_dir: dir.path().to_path_buf(),
            manifest_dir: dir.path().join("manifests"),
            api_key: Some(String::from("k")),
            strict_egress: true,
            socket_base: dir.path().join("sockets"),
            predicate_profile: PredicateProfile::PerimeterV1,
            wire_limits: tight,
            manifest_strict: true,
        };
        let rt = Arc::new(UcbRuntime::new(config).unwrap());
        let mut body = ForeignIngestBody::default();
        body.provenance = Some(Provenance::bound("lg", "1.0", "s1"));
        body.payload = serde_json::json!({"note": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"});
        let encoded = serde_json::to_vec(&body).unwrap_or_default();
        assert!(encoded.len() > tight.ingest_hard_bytes);
        let result = ingest_foreign_payload(&rt, body).await;
        assert_ne!(result.get("ok"), Some(&Value::Bool(true)));
        let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
        assert!(err.contains("hard cap"), "{result}");
    }

    #[test]
    fn validate_runs_in_a_separate_validator_process() {
        let bridge = include_str!("bridge.rs");
        let process = include_str!("validate_process.rs");
        assert!(bridge.contains("validate_timeout_ms"));
        assert!(bridge.contains("validate timeout"));
        assert!(bridge.contains("validate busy"));
        assert!(bridge.contains("VALIDATE_SLOT_LIMIT"));
        assert!(bridge.contains("ValidatorProcess::beside_current_exe"));
        let extern_c = ["extern ", "\"C\""].concat();
        assert!(!bridge.contains(&extern_c), "bridge declares no C functions");
        assert!(!bridge.contains(&["fn ", "fork("].concat()));
        assert!(process.contains("acquire_owned"));
        assert!(process.contains("kill_on_drop(true)"));
        assert!(process.contains("env_clear()"));
        let drain = process.find("read_to_end(&mut out)").expect("drain");
        let wait = process.find("child.wait().await").expect("wait");
        assert!(drain < wait, "the result is read to the end before the exit is awaited");
        assert_eq!(VALIDATE_SLOT_LIMIT, 2);
        assert_eq!(WireLimits::default().validate_timeout_ms, 2000);
    }

    #[test]
    fn encode_decode_preserves_secrets_scanner() {
        let v = crate::ingress::ValidationResult {
            ok: false,
            predicate: Some("P_C"),
            scanner_id: Some(ScannerId::Secrets),
            error: Some(String::from("secrets")),
        };
        let bytes = encode_validation(&v);
        let back = decode_validation(&bytes).expect("decode");
        assert!(!back.ok);
        assert_eq!(back.predicate, Some("P_C"));
        assert_eq!(back.scanner_id, Some(ScannerId::Secrets));
        let deny = validation_to_deny(&back);
        assert_eq!(deny.get("predicate").and_then(|x| x.as_str()), Some("P_C"));
        assert_eq!(
            deny.get("scanner_id").and_then(|x| x.as_str()),
            Some("Secrets")
        );
        let err = deny.get("error").and_then(|x| x.as_str()).unwrap_or("");
        assert!(err.contains("P_C"), "{deny}");
    }

    #[tokio::test]
    async fn ingest_secrets_payload_returns_pc_scanner() {
        let dir = tempfile::tempdir().unwrap();
        let rt = Arc::new(UcbRuntime::new(sample_config(dir.path())).unwrap());
        let mut body = ForeignIngestBody::default();
        body.provenance = Some(Provenance::bound("lg", "1.0", "s1"));
        body.payload = serde_json::json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"});
        let result = ingest_foreign_payload(&rt, body).await;
        assert_ne!(result.get("ok"), Some(&Value::Bool(true)));
        let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
        assert!(err.contains("P_C"), "{result}");
        assert_eq!(
            result.get("predicate").and_then(|v| v.as_str()),
            Some("P_C"),
            "{result}"
        );
        assert_eq!(
            result.get("scanner_id").and_then(|v| v.as_str()),
            Some("Secrets"),
            "{result}"
        );
    }


    #[cfg(unix)]
    fn stand_in(script: &str) -> ValidatorProcess {
        ValidatorProcess::with_args("/bin/sh", ["-c", script])
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn validate_timeout_kills_the_validator_and_frees_the_slot() {
        let slots = Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT));
        let out = stand_in("sleep 30").validate(&slots, 40, b"{}").await;
        assert_eq!(out.err(), Some(ValidateWaitError::Timeout));
        assert_eq!(slots.available_permits(), VALIDATE_SLOT_LIMIT);
        let ok = stand_in("cat >/dev/null; printf '{\"ok\":true}'")
            .validate(&slots, 2000, b"{}")
            .await;
        assert_eq!(ok.as_ref().map(|v| v.ok), Ok(true));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn validate_busy_when_two_slots_are_live() {
        let slots = Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT));
        let slow = "cat >/dev/null; sleep 0.25; printf '{\"ok\":true}'";
        let a = tokio::spawn({
            let slots = slots.clone();
            async move { stand_in(slow).validate(&slots, 2000, b"{}").await }
        });
        let b = tokio::spawn({
            let slots = slots.clone();
            async move { stand_in(slow).validate(&slots, 2000, b"{}").await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        let busy = stand_in(slow).validate(&slots, 40, b"{}").await;
        assert_eq!(busy.err(), Some(ValidateWaitError::Busy));
        let ra = a.await.expect("slow a");
        let rb = b.await.expect("slow b");
        assert_eq!(ra.as_ref().map(|v| v.ok), Ok(true));
        assert_eq!(rb.as_ref().map(|v| v.ok), Ok(true));
    }

    #[tokio::test]
    async fn missing_validator_denies_with_join_refused() {
        let dir = tempfile::tempdir().unwrap();
        let mut rt = UcbRuntime::new(sample_config(dir.path())).unwrap();
        rt.validator = ValidatorProcess::new(dir.path().join("no-such-validator"));
        let result = ingest_foreign_payload(&Arc::new(rt), sample_ingest_body()).await;
        assert_ne!(result.get("ok"), Some(&Value::Bool(true)));
        let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
        assert!(err.contains("validate join refused"), "{result}");
    }

    fn sample_config(dir: &Path) -> UcbConfig {
        UcbConfig {
            listen_host: String::from("127.0.0.1"),
            listen_port: 8412,
            data_dir: dir.to_path_buf(),
            manifest_dir: dir.join("manifests"),
            api_key: Some(String::from("k")),
            strict_egress: true,
            socket_base: dir.join("sockets"),
            predicate_profile: PredicateProfile::PerimeterV1,
            wire_limits: WireLimits::default(),
            manifest_strict: true,
        }
    }

    fn sample_ingest_body() -> ForeignIngestBody {
        let mut body = ForeignIngestBody::default();
        body.provenance = Some(Provenance::bound("lg", "1.0", "s1"));
        body.protocol = Some(String::from("lg"));
        body.session_id = Some(String::from("s1"));
        body.agent_id = Some(String::from("agent-a"));
        body.payload = serde_json::json!({"subject": "a", "predicate": "b", "object": "c"});
        body.task_manifest = Some(serde_json::json!({
            "manifest_version": "1",
            "id": "m1",
            "agent_id": "agent-a",
            "session_id": "s1",
            "intent": {},
            "synthesized_by": "provided",
            "signature": "operator-sig"
        }));
        body
    }

    fn write_fake_lattice_log(dir: &Path) -> PathBuf {
        let path = dir.join("fake-lattice-log");
        let dollar = char::from(36);
        let at = format!("{}@", dollar);
        let va = format!("{}a", dollar);
        let vc = format!("{}cmd", dollar);
        let mut script = String::new();
        script.push_str("#!/bin/sh\ncmd=\n");
        script.push_str(&format!("for a in \"{}\"; do\n", at));
        script.push_str(&format!("  case \"{}\" in\n", va));
        script.push_str("    build-frame) cmd=build-frame ;;\n");
        script.push_str("    record) cmd=record ;;\n");
        script.push_str("  esac\ndone\ncat >/dev/null\n");
        let sq = char::from(39);
        script.push_str(&format!("if [ \"{}\" = \"build-frame\" ]; then\n", vc));
        script.push_str("  printf ");
        script.push(sq);
        script.push_str("%s\\n");
        script.push(sq);
        script.push(32 as char);
        script.push(sq);
        script.push_str("{\"frame\":{\"kind\":\"fixture\"},\"digest\":\"abc\",\"signer_public_hex\":\"ab\"}");
        script.push(sq);
        script.push(10 as char);
        script.push_str("  exit 0\nfi\n");
        script.push_str(&format!("if [ \"{}\" = \"record\" ]; then\n", vc));
        script.push_str("  printf ");
        script.push(sq);
        script.push_str("%s\\n");
        script.push(sq);
        script.push(32 as char);
        script.push(sq);
        script.push_str("{\"ok\":true,\"event_id\":11,\"frame_digest\":\"abc\"}");
        script.push(sq);
        script.push(10 as char);
        script.push_str("  exit 0\nfi\nexit 1\n");
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    fn runtime_with_fake_lattice(dir: &Path) -> Arc<UcbRuntime> {
        let mut rt = UcbRuntime::new(sample_config(dir)).unwrap();
        rt.lattice.socket_base = dir.join("sockets");
        rt.lattice.lattice_log_bin = write_fake_lattice_log(dir);
        Arc::new(rt)
    }


    #[tokio::test]
    async fn ingest_admit_deny_ok_false_no_journal() {
        let dir = tempfile::tempdir().unwrap();
        let sockets = dir.path().join("sockets");
        std::fs::create_dir_all(&sockets).unwrap();
        let sock = sockets.join("validation");
        let listener = tokio::net::UnixListener::bind(&sock).expect("bind unix fixture");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            let (reader, mut writer) = stream.into_split();
            let mut reader = tokio::io::BufReader::new(reader);
            let mut line = String::new();
            reader.read_line(&mut line).await.expect("frame line");
            let enqueue = serde_json::json!({"ok": true, "digest": "abc"});
            let mut out = enqueue.to_string();
            out.push(10 as char);
            writer.write_all(out.as_bytes()).await.expect("enqueue write");
            line.clear();
            reader.read_line(&mut line).await.expect("collect line");
            assert!(line.contains("abc"), "{line}");
            let deny = DenyReport::from_error("Admit denied");
            let admit = serde_json::json!({"ok": false, "digest": "abc", "error": "Admit denied", "deny": deny});
            let mut out = admit.to_string();
            out.push(10 as char);
            writer.write_all(out.as_bytes()).await.expect("deny write");
        });
        let rt = runtime_with_fake_lattice(dir.path());
        let result = ingest_foreign_payload(&rt, sample_ingest_body()).await;
        assert_eq!(result.get("ok"), Some(&Value::Bool(false)));
        let rows = result.get("admit").and_then(|v| v.as_array()).expect("admit rows");
        assert_eq!(rows.len(), 1);
        assert!(rt.journal.list(10).is_empty());
        server.await.expect("fixture task");
    }

    #[tokio::test]
    async fn ingest_missing_dock_ok_false_no_journal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sockets")).unwrap();
        let rt = runtime_with_fake_lattice(dir.path());
        let result = ingest_foreign_payload(&rt, sample_ingest_body()).await;
        assert_eq!(result.get("ok"), Some(&Value::Bool(false)));
        let rows = result.get("admit").and_then(|v| v.as_array()).expect("admit rows");
        assert_eq!(rows.len(), 1);
        assert!(rt.journal.list(10).is_empty());
    }

}
