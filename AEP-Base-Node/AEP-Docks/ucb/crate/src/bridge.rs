//! Ingest and rollback. UCB is not a second evaluator.

use crate::auth::load_manifest_signers;
use crate::config::UcbConfig;
use crate::ingress::ForeignIngestBody;
use crate::journal::{persist_journal_if_admit, DiffJournal};
use crate::lattice::{
    admit_allow, DockResponse, LatticeDeny, LatticeRuntime, ACTION_ROLLBACK, BRIDGE_AGENT,
};
use crate::manifest;
use crate::store::ManifestStore;
use crate::translator::translate_foreign_ingest;
use crate::validate_process::{encode_request, ValidateWaitError, ValidatorProcess};
use aep_ucb_perimeter_v1::{reject_over_cap, ManifestSigners};
use aep_wall_set_backpressure::DenyReport;
use serde_json::Value;
use std::sync::{Arc, RwLock};
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
    /// The registered manifest signer key of each agent.
    pub signers: ManifestSigners,
    pub validate_slots: Arc<Semaphore>,
    /// Program that runs each ingest check in its own confined process.
    pub validator: ValidatorProcess,
    /// The last health snapshot. Requests read it; only the refresh task writes it.
    pub health: RwLock<Value>,
}

/// The health refresh runs one lattice ping this often.
pub const HEALTH_REFRESH_MS: u64 = 10_000;

impl UcbRuntime {
    pub fn new(config: UcbConfig) -> std::io::Result<Self> {
        let lattice = LatticeRuntime::from_env(&config.data_dir);
        let journal =
            DiffJournal::with_max_bytes(&config.data_dir, config.wire_limits.journal_max_bytes);
        let manifests = ManifestStore::new(config.manifest_dir.clone())?;
        let signers = load_manifest_signers(&config.data_dir);
        let health = RwLock::new(crate::http::health_document(
            &lattice,
            &crate::http::lattice_not_probed(),
        ));
        Ok(Self {
            config,
            lattice,
            journal,
            manifests,
            signers,
            validate_slots: Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT)),
            validator: ValidatorProcess::beside_current_exe(),
            health,
        })
    }

    /// The last health snapshot, from memory.
    pub fn health_snapshot(&self) -> Value {
        self.health
            .read()
            .map(|h| h.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    /// Ping the lattice once and store the result as the health snapshot. The ping
    /// is bounded by the build and dock timeouts of the lattice runtime.
    pub async fn refresh_health(&self) {
        let lattice = crate::http::lattice_probe(self.lattice.health_ping().await);
        let doc = crate::http::health_document(&self.lattice, &lattice);
        match self.health.write() {
            Ok(mut h) => *h = doc,
            Err(poisoned) => *poisoned.into_inner() = doc,
        }
    }

    /// Refresh the health snapshot now and then every HEALTH_REFRESH_MS on its own task.
    pub fn spawn_health_refresh(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let rt = Arc::clone(self);
        tokio::spawn(async move {
            let mut tick =
                tokio::time::interval(std::time::Duration::from_millis(HEALTH_REFRESH_MS));
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                tick.tick().await;
                rt.refresh_health().await;
            }
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
    let Some(obj) = payload.as_object_mut() else {
        return;
    };
    if computed_fields.is_empty() {
        if let Some(ucm) = obj.get_mut("ucm").and_then(Value::as_object_mut) {
            ucm.remove("computed_fields");
        }
        return;
    }
    let ucm = obj
        .entry("ucm")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
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

/// Bind the manifest's computed fields on a translated UCB event payload. The translator keeps
/// the foreign payload under raw, so the fields, their receipts and the pointers all live there.
pub fn bind_manifest_computed_fields(event_payload: &mut Value, computed_fields: &[String]) {
    let raw_is_object = event_payload
        .get("raw")
        .map(Value::is_object)
        .unwrap_or(false);
    if raw_is_object {
        bind_computed_fields(&mut event_payload["raw"], computed_fields);
    } else {
        bind_computed_fields(event_payload, computed_fields);
    }
}

fn ingest_ok(fields: serde_json::Map<String, Value>) -> Value {
    let mut m = fields;
    m.insert(String::from("ok"), Value::Bool(true));
    m.insert(
        String::from("status"),
        Value::String(String::from("integrated")),
    );
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
        deny: e.deny.as_deref().cloned(),
        allow: e.allow.clone(),
        pending: None,
    };
    let rows = vec![admit_ledger_row(&docked)];
    let body = if let Some(deny) = e.deny {
        deny_to_value(*deny)
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
        .validate(
            &rt.validate_slots,
            rt.config.wire_limits.validate_timeout_ms,
            &request,
        )
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
    let manifest = match manifest::load_or_provided(
        &rt.manifests,
        &rt.signers,
        manifest::strict_mode(rt.config.manifest_strict),
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
    bind_manifest_computed_fields(&mut event.payload, &manifest.computed_fields);
    let socket_path = match rt.lattice.dock_path(&event.docking_port) {
        Ok(p) => p,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let built = match rt.lattice.build_frame(&event).await {
        Ok(b) => b,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let docked = match rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame.clone(),
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
    // The dock Admit of the frame is the one Admit of this ingest and its ledger row
    // is the one ledger row. Nothing records the event a second time.
    let event_id = docked.event_id;
    let frame_digest = docked.digest.clone().or(built.digest);
    let mut snapshot = serde_json::Map::new();
    snapshot.insert(
        String::from("agent_id"),
        Value::String(event.agent_id.clone()),
    );
    snapshot.insert(
        String::from("event_type"),
        Value::String(event.event_type.clone()),
    );
    snapshot.insert(String::from("payload"), event.payload.clone());
    snapshot.insert(
        String::from("task_manifest_id"),
        Value::String(manifest.id.clone()),
    );
    let mut rec = serde_json::Map::new();
    rec.insert(
        String::from("operation"),
        Value::String(String::from("extend_write")),
    );
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
    rec.insert(
        String::from("session_id"),
        Value::String(event.session_id.clone()),
    );
    rec.insert(String::from("snapshot"), Value::Object(snapshot));
    let diff = rt
        .journal
        .with_lock(|| rt.journal.append(Value::Object(rec)))
        .await;
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

/// Roll back the tail diff. `acting_agent` is the agent of an agent key: such a key
/// rolls back only a diff of its own agent. The operator key passes None.
pub async fn rollback_foreign_integrations(
    rt: &Arc<UcbRuntime>,
    diff_ids: Vec<String>,
    acting_agent: Option<&str>,
) -> Value {
    if diff_ids.len() != 1 {
        return deny_to_value(DenyReport::from_error(
            "rollback requires exactly one tail diff id",
        ));
    }
    let diff_id = diff_ids[0].clone();
    if let Err(e) = rt
        .journal
        .with_lock(|| {
            rt.journal.check_rollback_named(&diff_ids)?;
            rt.journal.check_diff_agent(&diff_id, acting_agent)
        })
        .await
    {
        return deny_to_value(DenyReport::from_error(&e));
    }
    let mut payload = serde_json::Map::new();
    payload.insert(String::from("diff_id"), Value::String(diff_id.clone()));
    payload.insert(
        String::from("bridge"),
        Value::String(String::from(crate::BRIDGE_ID)),
    );
    let rollback_event = crate::translator::LatticeEvent {
        agent_id: BRIDGE_AGENT.into(),
        channel_id: "ch-ucb-rollback".into(),
        contract_id: "dynaep-action-lattice".into(),
        event_type: "UCB_ROLLBACK".into(),
        session_id: format!("ucb-rollback-{}", now_ms()),
        docking_port: "validation_engine".into(),
        action_path: ACTION_ROLLBACK.into(),
        payload: Value::Object(payload),
    };
    let socket_path = match rt.lattice.dock_path("validation_engine") {
        Ok(p) => p,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let built = match rt.lattice.build_frame(&rollback_event).await {
        Ok(b) => b,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let docked = match rt
        .lattice
        .send_frame(
            &socket_path,
            built.frame,
            built.signer_public_hex.as_deref(),
        )
        .await
    {
        Ok(d) => d,
        Err(e) => {
            if let Some(deny) = e.deny {
                return deny_to_value(*deny);
            }
            return deny_to_value(DenyReport::from_error(&e.error));
        }
    };
    if persist_journal_if_admit(admit_allow(&docked), || ()).is_none() {
        return deny_to_value(DenyReport::from_error("collect-all Admit refused"));
    }
    let popped = rt
        .journal
        .with_lock(|| rt.journal.rollback_tail(&diff_id))
        .await;
    let popped = match popped {
        Ok(d) => d,
        Err(e) => return deny_to_value(DenyReport::from_error(&e)),
    };
    let mut out = serde_json::Map::new();
    out.insert(String::from("ok"), Value::Bool(true));
    out.insert(
        String::from("status"),
        Value::String(String::from("rolled_back")),
    );
    out.insert(String::from("diff_id"), Value::String(popped.diff_id));
    if let Some(id) = docked.event_id {
        out.insert(String::from("event_id"), Value::from(id));
    }
    if let Some(d) = docked.digest.or(built.digest) {
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
    use std::path::Path;
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
    fn computed_fields_bind_on_the_translated_foreign_payload() {
        let body = ForeignIngestBody {
            protocol: Some(String::from("mcp")),
            session_id: Some(String::from("s-ucm")),
            payload: serde_json::json!({
                "total": "64.54",
                "ucm": { "computed_fields": ["/other"], "receipts": { "/total": {} } }
            }),
            ..Default::default()
        };
        let mut event = translate_foreign_ingest(&body).expect("translate");
        bind_manifest_computed_fields(&mut event.payload, &["/total".to_string()]);
        let raw = &event.payload["raw"];
        assert_eq!(raw["ucm"]["computed_fields"], serde_json::json!(["/total"]));
        assert!(raw["ucm"]["receipts"].get("/total").is_some());
        assert_eq!(raw.pointer("/total"), Some(&serde_json::json!("64.54")));
        assert!(event.payload.get("ucm").is_none());
        let mut none = translate_foreign_ingest(&body).expect("translate");
        bind_manifest_computed_fields(&mut none.payload, &[]);
        assert!(none.payload["raw"]["ucm"].get("computed_fields").is_none());
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
        assert_eq!(out.get("diff_id"), Some(&Value::String(String::from("d1"))));
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
        let tight = WireLimits {
            ingest_default_bytes: 32,
            ingest_hard_bytes: 64,
            ..Default::default()
        };
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
        let body = ForeignIngestBody {
            provenance: Some(Provenance::bound("lg", "1.0", "s1")),
            payload: serde_json::json!({"note": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}),
            ..Default::default()
        };
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
        assert!(
            !bridge.contains(&extern_c),
            "bridge declares no C functions"
        );
        assert!(!bridge.contains(&["fn ", "fork("].concat()));
        assert!(process.contains("acquire_owned"));
        assert!(process.contains("kill_on_drop(true)"));
        assert!(process.contains("env_clear()"));
        let drain = process.find("read_to_end(&mut out)").expect("drain");
        let wait = process.find("child.wait().await").expect("wait");
        assert!(
            drain < wait,
            "the result is read to the end before the exit is awaited"
        );
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
        let body = ForeignIngestBody {
            provenance: Some(Provenance::bound("lg", "1.0", "s1")),
            payload: serde_json::json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"}),
            ..Default::default()
        };
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

    /// The manifest signer of agent-a in these tests.
    fn agent_a_key() -> &'static aep_lattice_crypto::SignKeypair {
        static KEY: std::sync::OnceLock<aep_lattice_crypto::SignKeypair> =
            std::sync::OnceLock::new();
        KEY.get_or_init(aep_lattice_crypto::generate_sign_keypair)
    }

    fn sample_ingest_body() -> ForeignIngestBody {
        let mut manifest = serde_json::json!({
            "manifest_version": "1",
            "id": "m1",
            "agent_id": "agent-a",
            "session_id": "s1",
            "intent": {},
            "synthesized_by": "provided"
        });
        crate::test_support::sign_provided(&mut manifest, agent_a_key());
        ForeignIngestBody {
            provenance: Some(Provenance::bound("lg", "1.0", "s1")),
            protocol: Some(String::from("lg")),
            session_id: Some(String::from("s1")),
            agent_id: Some(String::from("agent-a")),
            payload: serde_json::json!({"subject": "a", "predicate": "b", "object": "c"}),
            task_manifest: Some(manifest),
            ..Default::default()
        }
    }

    /// A runtime whose aep-lattice-log is the recording stand-in, whose docks live in
    /// `dir/sockets` and whose manifest signer of agent-a is registered.
    fn runtime_with_fake_lattice(dir: &Path) -> Arc<UcbRuntime> {
        let mut rt = UcbRuntime::new(sample_config(dir)).unwrap();
        rt.lattice.socket_base = dir.join("sockets");
        rt.lattice.lattice_log_bin = crate::test_support::recording_lattice_log(dir);
        rt.signers.insert("agent-a", agent_a_key().public.clone());
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
            writer
                .write_all(out.as_bytes())
                .await
                .expect("enqueue write");
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
        let rows = result
            .get("admit")
            .and_then(|v| v.as_array())
            .expect("admit rows");
        assert_eq!(rows.len(), 1);
        assert!(rt.journal.list(10).is_empty());
        server.await.expect("fixture task");
    }

    /// UCB 05: an admitted ingest passes Admit at the dock once. No second Admit
    /// through aep-lattice-log record writes the ledger again.
    #[tokio::test]
    async fn admitted_ingest_passes_admit_once() {
        let dir = tempfile::tempdir().unwrap();
        let dock = crate::test_support::allowing_dock(&dir.path().join("sockets/validation"));
        let rt = runtime_with_fake_lattice(dir.path());
        let result = ingest_foreign_payload(&rt, sample_ingest_body()).await;
        dock.abort();
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)), "{result}");
        assert_eq!(result.get("event_id"), Some(&Value::from(7)), "{result}");
        assert_eq!(
            crate::test_support::lattice_calls(dir.path()),
            vec![String::from("build-frame")],
            "one frame, one Admit, no record"
        );
        assert_eq!(rt.journal.list(10).len(), 1);
    }

    /// UCB 04: the rollback frame names the action path ucb:rollback.
    #[tokio::test]
    async fn rollback_frame_names_its_action_path() {
        let dir = tempfile::tempdir().unwrap();
        let dock = crate::test_support::allowing_dock(&dir.path().join("sockets/validation"));
        let rt = runtime_with_fake_lattice(dir.path());
        let diff = rt
            .journal
            .append(serde_json::json!({
                "operation": "extend_write",
                "snapshot": {"agent_id": "agent-a"}
            }))
            .unwrap();
        let result = rollback_foreign_integrations(&rt, vec![diff.diff_id.clone()], None).await;
        dock.abort();
        let inputs = crate::test_support::lattice_inputs(dir.path());
        assert_eq!(inputs.len(), 1, "{inputs:?}");
        assert_eq!(inputs[0]["action_path"], "ucb:rollback");
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)), "{result}");
        assert!(rt.journal.list(10).is_empty());
    }

    /// UCB 01: an agent key rolls back only a diff of its own agent.
    #[tokio::test]
    async fn agent_rolls_back_only_its_own_diff() {
        let dir = tempfile::tempdir().unwrap();
        let dock = crate::test_support::allowing_dock(&dir.path().join("sockets/validation"));
        let rt = runtime_with_fake_lattice(dir.path());
        let diff = rt
            .journal
            .append(serde_json::json!({
                "operation": "extend_write",
                "snapshot": {"agent_id": "agent-a"}
            }))
            .unwrap();
        let refused =
            rollback_foreign_integrations(&rt, vec![diff.diff_id.clone()], Some("agent-b")).await;
        assert_ne!(refused.get("ok"), Some(&Value::Bool(true)), "{refused}");
        assert_eq!(
            rt.journal.list(10).len(),
            1,
            "the refused rollback keeps the diff"
        );
        assert!(crate::test_support::lattice_calls(dir.path()).is_empty());
        let own =
            rollback_foreign_integrations(&rt, vec![diff.diff_id.clone()], Some("agent-a")).await;
        dock.abort();
        assert_eq!(own.get("ok"), Some(&Value::Bool(true)), "{own}");
        assert!(rt.journal.list(10).is_empty());
    }

    /// UCB 02: an ingest whose manifest no registered key signed is refused before
    /// any frame is built.
    #[tokio::test]
    async fn ingest_with_an_unverified_manifest_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let rt = runtime_with_fake_lattice(dir.path());
        let mut body = sample_ingest_body();
        if let Some(m) = body.task_manifest.as_mut() {
            m["signature"] = Value::String(String::from("operator-sig"));
        }
        let result = ingest_foreign_payload(&rt, body).await;
        assert_eq!(
            result.get("error").and_then(Value::as_str),
            Some("ManifestSignatureInvalid"),
            "{result}"
        );
        assert!(crate::test_support::lattice_calls(dir.path()).is_empty());
        assert!(rt.manifests.load("agent-a").is_none());
    }

    #[tokio::test]
    async fn ingest_missing_dock_ok_false_no_journal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("sockets")).unwrap();
        let rt = runtime_with_fake_lattice(dir.path());
        let result = ingest_foreign_payload(&rt, sample_ingest_body()).await;
        assert_eq!(result.get("ok"), Some(&Value::Bool(false)));
        let rows = result
            .get("admit")
            .and_then(|v| v.as_array())
            .expect("admit rows");
        assert_eq!(rows.len(), 1);
        assert!(rt.journal.list(10).is_empty());
    }
}
