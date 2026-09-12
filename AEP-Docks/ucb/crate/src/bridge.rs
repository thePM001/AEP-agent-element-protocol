// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Ingest and rollback. UCB is not a second evaluator.

use crate::config::UcbConfig;
use crate::ingress::{validate_foreign_ingest_with_profile, ForeignIngestBody};
use crate::journal::{persist_journal_if_admit, DiffJournal};
use crate::lattice::{admit_allow, DockResponse, LatticeDeny, LatticeRuntime};
use crate::manifest;
use crate::store::ManifestStore;
use crate::translator::translate_foreign_ingest;
use aep_ucb_perimeter_v1::reject_over_cap;
use aep_wall_set_backpressure::DenyReport;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const VALIDATE_SLOT_LIMIT: usize = 2;

#[derive(Debug, PartialEq, Eq)]
enum ValidateWaitError {
    Busy,
    Timeout,
    Join,
}

#[cfg(unix)]
mod validate_abort {
    pub const SIGKILL: i32 = 9;

    unsafe extern "C" {
        pub fn fork() -> i32;
        pub fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
        pub fn kill(pid: i32, sig: i32) -> i32;
        pub fn _exit(code: i32);
        pub fn pipe(pipefd: *mut i32) -> i32;
        pub fn close(fd: i32) -> i32;
        pub fn read(fd: i32, buf: *mut u8, n: usize) -> isize;
        pub fn write(fd: i32, buf: *const u8, n: usize) -> isize;
    }
}

fn encode_validation(v: &crate::ingress::ValidationResult) -> Vec<u8> {
    serde_json::to_vec(v).unwrap_or_else(|_| Vec::from(b"{\"ok\":false}"))
}

fn decode_validation(bytes: &[u8]) -> Option<crate::ingress::ValidationResult> {
    let parsed = serde_json::from_slice(bytes);
    let v: Value = match parsed {
        Ok(val) => val,
        Err(_) => return None,
    };
    let ok = match v.get("ok") {
        Some(x) => x.as_bool().unwrap_or(false),
        None => false,
    };
    let error = match v.get("error") {
        Some(x) => x.as_str().map(str::to_string),
        None => None,
    };
    let predicate = match v.get("predicate") {
        Some(x) => match x.as_str() {
            Some(s) => {
                let leaked: &'static str = Box::leak(s.to_string().into_boxed_str());
                Some(leaked)
            }
            None => None,
        },
        None => None,
    };
    Some(crate::ingress::ValidationResult {
        ok,
        predicate,
        scanner_id: None,
        error,
    })
}

#[cfg(unix)]
fn write_all_fd(fd: i32, bytes: &[u8]) -> bool {
    let mut off = 0usize;
    while off < bytes.len() {
        let n = unsafe { validate_abort::write(fd, bytes.as_ptr().add(off), bytes.len() - off) };
        if n <= 0 {
            return false;
        }
        off += n as usize;
    }
    true
}

#[cfg(unix)]
fn read_all_fd(fd: i32, max: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = unsafe { validate_abort::read(fd, buf.as_mut_ptr(), buf.len()) };
        if n <= 0 {
            break;
        }
        out.extend_from_slice(&buf[..n as usize]);
        if out.len() >= max {
            break;
        }
    }
    out
}

async fn run_bounded_validate<F>(
    slots: Arc<Semaphore>,
    timeout_ms: u64,
    work: F,
) -> Result<crate::ingress::ValidationResult, ValidateWaitError>
where
    F: FnOnce() -> crate::ingress::ValidationResult + Send + 'static,
{
    let wait = Duration::from_millis(timeout_ms);
    let acquired = tokio::time::timeout(wait, slots.acquire_owned()).await;
    let permit = match acquired {
        Ok(Ok(p)) => p,
        Ok(Err(_)) => return Err(ValidateWaitError::Busy),
        Err(_) => return Err(ValidateWaitError::Busy),
    };

    #[cfg(not(unix))]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let spawned = std::thread::Builder::new()
            .name(String::from("ucb-validate"))
            .spawn(move || {
                let out = work();
                let _ = tx.send(out);
            });
        if spawned.is_err() {
            drop(permit);
            return Err(ValidateWaitError::Join);
        }
        let joined = tokio::time::timeout(wait, rx).await;
        match joined {
            Ok(Ok(v)) => {
                drop(permit);
                Ok(v)
            }
            Ok(Err(_)) => {
                drop(permit);
                Err(ValidateWaitError::Join)
            }
            Err(_) => {
                drop(permit);
                Err(ValidateWaitError::Timeout)
            }
        }
    }

    #[cfg(unix)]
    {
        let mut fds = [0i32; 2];
        if unsafe { validate_abort::pipe(fds.as_mut_ptr()) } != 0 {
            drop(permit);
            return Err(ValidateWaitError::Join);
        }
        let read_fd = fds[0];
        let write_fd = fds[1];
        let pid_slot = std::sync::Arc::new(std::sync::Mutex::new(None::<i32>));
        let pid_worker = std::sync::Arc::clone(&pid_slot);
        let (tx, rx) = tokio::sync::oneshot::channel::<Vec<u8>>();
        let spawned = std::thread::Builder::new()
            .name(String::from("ucb-validate"))
            .spawn(move || {
                let pid = unsafe { validate_abort::fork() };
                if pid == 0 {
                    unsafe {
                        validate_abort::close(read_fd);
                    }
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(work));
                    match result {
                        Ok(v) => {
                            let payload = encode_validation(&v);
                            let mut framed = Vec::with_capacity(4 + payload.len());
                            framed.extend_from_slice(&(payload.len() as u32).to_le_bytes());
                            framed.extend_from_slice(&payload);
                            let _ = write_all_fd(write_fd, &framed);
                            unsafe {
                                validate_abort::close(write_fd);
                                validate_abort::_exit(0);
                            }
                            std::process::abort();
                        }
                        Err(_) => {
                            unsafe {
                                validate_abort::close(write_fd);
                                validate_abort::_exit(2);
                            }
                            std::process::abort();
                        },
                    }
                }
                unsafe {
                    validate_abort::close(write_fd);
                }
                if pid < 0 {
                    unsafe {
                        validate_abort::close(read_fd);
                    }
                    let _ = tx.send(Vec::new());
                    return;
                }
                if let Ok(mut g) = pid_worker.lock() {
                    *g = Some(pid);
                }
                let mut status = 0;
                let _ = unsafe { validate_abort::waitpid(pid, &mut status, 0) };
                let bytes = read_all_fd(read_fd, 1024 * 1024);
                unsafe {
                    validate_abort::close(read_fd);
                }
                let _ = tx.send(bytes);
            });
        if spawned.is_err() {
            unsafe {
                validate_abort::close(read_fd);
                validate_abort::close(write_fd);
            }
            drop(permit);
            return Err(ValidateWaitError::Join);
        }
        let joined = tokio::time::timeout(wait, rx).await;
        match joined {
            Ok(Ok(bytes)) => {
                drop(permit);
                if bytes.len() < 4 {
                    return Err(ValidateWaitError::Join);
                }
                let n = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
                if n > 1024 * 1024 {
                    return Err(ValidateWaitError::Join);
                }
                if bytes.len() < 4 + n {
                    return Err(ValidateWaitError::Join);
                }
                match decode_validation(&bytes[4..4 + n]) {
                    Some(v) => Ok(v),
                    None => Err(ValidateWaitError::Join),
                }
            }
            Ok(Err(_)) => {
                drop(permit);
                Err(ValidateWaitError::Join)
            }
            Err(_) => {
                let mut n = 0;
                while n < 50 {
                    let id = match pid_slot.lock() {
                        Ok(g) => *g,
                        Err(_) => None,
                    };
                    if let Some(pid) = id {
                        unsafe {
                            validate_abort::kill(pid, validate_abort::SIGKILL);
                        }
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(1));
                    n += 1;
                }
                drop(permit);
                Err(ValidateWaitError::Timeout)
            }
        }
    }
}

pub struct UcbRuntime {
    pub config: UcbConfig,
    pub lattice: LatticeRuntime,
    pub journal: DiffJournal,
    pub manifests: ManifestStore,
    pub validate_slots: Arc<Semaphore>,
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
        })
    }
}

pub fn deny_to_value(report: DenyReport) -> Value {
    serde_json::to_value(&report).unwrap_or_else(|_| Value::Object(serde_json::Map::new()))
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
    let body_for_validate = body.clone();
    let validation = match run_bounded_validate(
        Arc::clone(&rt.validate_slots),
        rt.config.wire_limits.validate_timeout_ms,
        move || validate_foreign_ingest_with_profile(&body_for_validate, &prior, profile),
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
        let mut report = DenyReport::from_error(
            &validation
                .error
                .clone()
                .unwrap_or_else(|| String::from("ingest validation refused")),
        );
        if let Some(pred) = validation.predicate {
            report.error = format!("{}:{}", pred, report.error);
        }
        return deny_to_value(report);
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
    use aep_ucb_perimeter_v1::{PredicateProfile, WireLimits};
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
    fn validate_timeout_uses_blocking_task() {
        let src = include_str!("bridge.rs");
        assert!(src.contains("validate_timeout_ms"));
        assert!(src.contains("SIGKILL"));
        assert!(src.contains("fork"));
        assert!(src.contains("validate timeout"));
        assert!(src.contains("validate busy"));
        assert!(src.contains("Semaphore"));
        assert!(src.contains("acquire_owned"));
        assert!(src.contains("VALIDATE_SLOT_LIMIT"));
        assert_eq!(VALIDATE_SLOT_LIMIT, 2);
        assert_eq!(WireLimits::default().validate_timeout_ms, 2000);
    }

    fn sample_validation_ok() -> crate::ingress::ValidationResult {
        crate::ingress::ValidationResult {
            ok: true,
            predicate: None,
            scanner_id: None,
            error: None,
        }
    }

    #[tokio::test]
    async fn validate_join_timeout_returns_timeout() {
        let slots = Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT));
        let out = run_bounded_validate(slots, 40, || {
            std::thread::sleep(Duration::from_millis(300));
            sample_validation_ok()
        })
        .await;
        assert_eq!(out.err(), Some(ValidateWaitError::Timeout));
    }

    #[tokio::test]
    async fn validate_timeout_aborts_and_frees_slot() {
        let slots = Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT));
        let out = run_bounded_validate(slots.clone(), 40, || {
            std::thread::sleep(Duration::from_millis(300));
            sample_validation_ok()
        })
        .await;
        assert_eq!(out.err(), Some(ValidateWaitError::Timeout));
        let ok = run_bounded_validate(slots, 200, || sample_validation_ok()).await;
        assert_eq!(ok.as_ref().map(|v| v.ok), Ok(true));
    }

    #[tokio::test]
    async fn validate_busy_when_two_slots_are_live() {
        let slots = Arc::new(Semaphore::new(VALIDATE_SLOT_LIMIT));
        let a = tokio::spawn(run_bounded_validate(slots.clone(), 2000, || {
            std::thread::sleep(Duration::from_millis(250));
            sample_validation_ok()
        }));
        let b = tokio::spawn(run_bounded_validate(slots.clone(), 2000, || {
            std::thread::sleep(Duration::from_millis(250));
            sample_validation_ok()
        }));
        tokio::time::sleep(Duration::from_millis(80)).await;
        let busy = run_bounded_validate(slots.clone(), 40, || sample_validation_ok()).await;
        assert_eq!(busy.err(), Some(ValidateWaitError::Busy));
        let ra = a.await.expect("slow a");
        let rb = b.await.expect("slow b");
        assert_eq!(ra.as_ref().map(|v| v.ok), Ok(true));
        assert_eq!(rb.as_ref().map(|v| v.ok), Ok(true));
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
