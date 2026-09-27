//! Data Dock HTTP on 8413. Frontends read already-admitted lattice records as JSON.
//! Governed writes are sealed on the server and sent through the four existing docks.
//! This is not a fifth Base Node dock. Display API is gone and port 28429 is never bound.
//! The listener defaults to loopback. Any other host needs DATA_DOCK_API_KEY and every
//! /v1 route checks that key in constant time.

use crate::lattice_log::{export_dynaep_events, DynAepEventExport, DynAepEventInput, DockingPortWire};
use crate::task_manifest::{TaskManifestTrust, TaskManifestV1};
use crate::dock_event;
use crate::dock_keys::signer_rate_key;
use crate::dock_log::DockEvent;
use crate::{
    bootstrap_contracts, build_transport_frame, default_lattice_db_path, docking_port_specs,
    process_request, pulse_beat, resolve_mesh_peers, runtime_status, DockFrameResponse,
    DockingRuntime,
};
use aep_base_node_pulse::PULSE_MS;
use aep_lattice_channel::DockingPort;
use axum::extract::{Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub const DATA_DOCK_PORT: u16 = 8413;
pub const DATA_DOCK_DEFAULT_HOST: &str = "127.0.0.1";
pub const UCB_DEFAULT_PORT: u16 = 8412;
pub const DATA_KEY_HEADER: &str = "x-aep-data-key";
pub const DATA_DOCK_SERVICE: &str = "aep-data-dock";
pub const DATA_DOCK_AGENT: &str = "data-dock";
pub const DATA_DOCK_SESSION: &str = "data-dock-session";
pub const DATA_DOCK_CHANNEL: &str = "ch-data-dock";
const FORBIDDEN_WIRE_KEYS: &[&str] = &[
    "agent_id",
    "grants",
    "agent_permission",
    "frame",
    "sealed",
    "signer_public_hex",
    "trust_score",
    "capsule",
    "lattice_frame",
    "agentmesh",
];

#[derive(Clone)]
pub struct DataDockConfig {
    pub enabled: bool,
    pub listen_host: String,
    pub listen_port: u16,
    /// DATA_DOCK_API_KEY. Required when the host is not loopback.
    pub api_key: Option<String>,
}

impl std::fmt::Debug for DataDockConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DataDockConfig")
            .field("enabled", &self.enabled)
            .field("listen_host", &self.listen_host)
            .field("listen_port", &self.listen_port)
            .field("api_key", &self.api_key.as_ref().map(|_| "set"))
            .finish()
    }
}

impl DataDockConfig {
    pub fn from_env() -> Self {
        let enabled = match std::env::var("DATA_DOCK") {
            Ok(v) => v != "0",
            Err(_) => true,
        };
        let listen_host = match std::env::var("DATA_DOCK_HOST") {
            Ok(h) if h.trim().is_empty() == false => h.trim().to_string(),
            _ => String::from(DATA_DOCK_DEFAULT_HOST),
        };
        let api_key = match std::env::var("DATA_DOCK_API_KEY") {
            Ok(k) if k.trim().is_empty() == false => Some(k.trim().to_string()),
            _ => None,
        };
        Self {
            enabled,
            listen_host,
            listen_port: std::env::var("DATA_DOCK_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(DATA_DOCK_PORT),
            api_key,
        }
    }

    /// Refuses a listen on any host other than loopback without an API key.
    pub fn check_bind(&self) -> Result<(), String> {
        if host_is_loopback(&self.listen_host) || self.api_key.is_some() {
            return Ok(());
        }
        Err(format!(
            "Data Dock refuses to listen on {} without DATA_DOCK_API_KEY",
            self.listen_host
        ))
    }
}

/// True for 127.0.0.0/8, ::1 and localhost.
pub fn host_is_loopback(host: &str) -> bool {
    let h = host.trim().trim_start_matches('[').trim_end_matches(']');
    if h.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match h.parse::<IpAddr>() {
        Ok(ip) => ip.is_loopback(),
        Err(_) => false,
    }
}

fn key_digest(key: &str) -> [u8; 32] {
    Sha256::digest(key.as_bytes()).into()
}

/// Constant-time equality over two fixed-length digests.
fn digests_equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

fn presented_key(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers.get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let v = v.trim();
        if v.len() > 7 && v[..7].eq_ignore_ascii_case("bearer ") {
            return Some(v[7..].trim().to_string());
        }
    }
    headers
        .get(DATA_KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_string())
}

#[derive(Clone)]
pub struct DataDockState {
    pub runtime: Arc<DockingRuntime>,
    pub listen_port: u16,
    pub ucb_port: u16,
    pub data_dir: PathBuf,
    pub internet_up: bool,
    api_key_digest: Option<[u8; 32]>,
}

impl DataDockState {
    pub fn new(
        runtime: Arc<DockingRuntime>,
        cfg: &DataDockConfig,
        data_dir: PathBuf,
        internet_up: bool,
    ) -> Self {
        let ucb_port = std::env::var("UCB_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .unwrap_or(UCB_DEFAULT_PORT);
        Self {
            runtime,
            listen_port: cfg.listen_port,
            ucb_port,
            data_dir,
            internet_up,
            api_key_digest: cfg.api_key.as_deref().map(key_digest),
        }
    }

    fn key_required(&self) -> bool {
        self.api_key_digest.is_some()
    }
}

#[derive(Debug, Serialize)]
pub struct DataDockHealth {
    pub ok: bool,
    pub service: String,
    pub version: String,
    pub status: String,
    pub port: u16,
    pub ucb_port: u16,
    pub docks: u8,
    pub display_api: bool,
    pub bind_28429: bool,
    pub sqlite_closed: bool,
    pub last_tls_handshake_err: Option<String>,
    pub drain_aborted_tasks: u64,
    pub docking_ports_listening: bool,
    pub hub_loaded: bool,
    pub key_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDockLedgerRow {
    pub id: i64,
    pub event_type: String,
    pub frame_digest: String,
    pub recorded_at_unix: u64,
    pub channel_id: String,
    pub contract_id: String,
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
struct LedgerQuery {
    #[serde(default)]
    limit: Option<u32>,
}

pub fn build_router(state: DataDockState) -> Router {
    let v1 = Router::new()
        .route("/v1/health", get(health_handler))
        .route("/v1/ledger", get(ledger_handler))
        .route("/v1/events", get(events_handler))
        .route("/v1/actions", post(actions_handler))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_key));
    Router::new()
        .route("/health", get(health_handler))
        .merge(v1)
        .with_state(state)
}

async fn require_key(State(state): State<DataDockState>, req: Request, next: Next) -> Response {
    let Some(expected) = state.api_key_digest else {
        return next.run(req).await;
    };
    let ok = match presented_key(req.headers()) {
        Some(k) => digests_equal(&key_digest(&k), &expected),
        None => false,
    };
    if ok {
        return next.run(req).await;
    }
    dock_event!(warn, DockEvent::DataDockAuthFail, path = %req.uri().path(), "Data Dock key refused");
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "ok": false, "error": "unauthorized" })),
    )
        .into_response()
}

/// Binds the Data Dock listener. Refuses before bind when the host is not
/// loopback and no key is set, so nothing listens.
pub async fn serve(
    state: DataDockState,
    cfg: &DataDockConfig,
) -> Result<(JoinHandle<()>, SocketAddr), std::io::Error> {
    if let Err(detail) = cfg.check_bind() {
        return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, detail));
    }
    let addr = format!("{}:{}", cfg.listen_host, cfg.listen_port);
    let listener = TcpListener::bind(&addr).await?;
    let local = listener.local_addr()?;
    dock_event!(info, DockEvent::DataDockBind, addr = %local, key_required = state.key_required(), "Data Dock HTTP listening");
    let app = build_router(state);
    Ok((
        tokio::spawn(async move {
            if let Err(e) = axum::serve(listener, app).await {
                tracing::warn!(error = %e, "Data Dock HTTP exited");
            }
        }),
        local,
    ))
}

pub fn provision_server_identity(
    runtime: &DockingRuntime,
    data_dir: &Path,
) -> Result<(), crate::BaseNodeError> {
    {
        let mut store = match runtime.keys.agent_sign_keys.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        crate::dock_keys::first_mint_data_dock(&mut store, DATA_DOCK_AGENT)?;
    }
    let manifest_dir = std::env::var("AEP_TASK_MANIFEST_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| data_dir.join("ucb").join("manifests"));
    std::fs::create_dir_all(&manifest_dir).map_err(|e| {
        crate::BaseNodeError::Io(format!("data-dock manifest dir: {e}"))
    })?;
    let manifest = TaskManifestV1 {
        manifest_version: String::from("1"),
        id: String::from("m-data-dock"),
        agent_id: String::from(DATA_DOCK_AGENT),
        session_id: Some(String::from(DATA_DOCK_SESSION)),
        intent: json!({ "op": "data-dock" }),
        trust: TaskManifestTrust {
            tier: String::from("system"),
        },
        agentmesh: None,
        provisional: false,
        synthesized_by: String::from("provided"),
        promotion_required: Vec::new(),
    };
    let path = manifest_dir.join("data-dock.json");
    let text = serde_json::to_string_pretty(&manifest).map_err(|e| {
        crate::BaseNodeError::Io(format!("data-dock manifest encode: {e}"))
    })?;
    std::fs::write(&path, text).map_err(|e| {
        crate::BaseNodeError::Io(format!("data-dock manifest write: {e}"))
    })?;
    let mut manifests = match runtime.admit.manifests.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    manifests.reload();
    Ok(())
}

fn health_body(state: &DataDockState) -> DataDockHealth {
    let (_, _, mesh_err) = resolve_mesh_peers(Some(&state.data_dir), state.internet_up, 0);
    let status = runtime_status(&state.runtime, mesh_err.as_deref());
    DataDockHealth {
        ok: status != "error",
        service: String::from(DATA_DOCK_SERVICE),
        version: String::from(env!("CARGO_PKG_VERSION")),
        status: String::from(status),
        port: state.listen_port,
        ucb_port: state.ucb_port,
        docks: docking_port_specs(&state.runtime.io.socket_base).len() as u8,
        display_api: false,
        bind_28429: false,
        sqlite_closed: state.runtime.sqlite_is_closed(),
        last_tls_handshake_err: state.runtime.last_tls_handshake_err(),
        drain_aborted_tasks: state.runtime.drain_aborted_tasks(),
        docking_ports_listening: state.runtime.docking_ports_listening(),
        hub_loaded: state.runtime.admit.hub.is_loaded(),
        key_required: state.key_required(),
    }
}

async fn health_handler(State(state): State<DataDockState>) -> Json<DataDockHealth> {
    let body = health_body(&state);
    dock_event!(debug, DockEvent::HealthProbe, status = %body.status, "Data Dock health probe");
    Json(body)
}

fn clamp_limit(limit: Option<u32>) -> u32 {
    let n = limit.unwrap_or(100);
    if n == 0 {
        100
    } else if n > 500 {
        500
    } else {
        n
    }
}

fn first_forbidden(value: &Value) -> Option<&'static str> {
    match value {
        Value::Object(map) => {
            for key in FORBIDDEN_WIRE_KEYS {
                if map.contains_key(*key) {
                    return Some(*key);
                }
            }
            for nested in map.values() {
                if let Some(hit) = first_forbidden(nested) {
                    return Some(hit);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(first_forbidden),
        _ => None,
    }
}

fn strip_public_payload(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                if FORBIDDEN_WIRE_KEYS.contains(&k.as_str()) {
                    continue;
                }
                out.insert(k.clone(), strip_public_payload(v));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(strip_public_payload).collect()),
        other => other.clone(),
    }
}

pub fn public_row_from_export(row: DynAepEventExport) -> DataDockLedgerRow {
    DataDockLedgerRow {
        id: row.id,
        event_type: row.event_type,
        frame_digest: row.frame_digest,
        recorded_at_unix: row.recorded_at_unix,
        channel_id: row.channel_id,
        contract_id: row.contract_id,
        payload: strip_public_payload(&row.payload),
    }
}

fn read_public_rows(runtime: &DockingRuntime, limit: u32) -> Result<Vec<DataDockLedgerRow>, String> {
    let db = match runtime.record.db.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let exported = export_dynaep_events(&db, Some(limit)).map_err(|e| e.to_string())?;
    Ok(exported.into_iter().map(public_row_from_export).collect())
}

async fn ledger_handler(
    State(state): State<DataDockState>,
    Query(q): Query<LedgerQuery>,
) -> impl IntoResponse {
    match read_public_rows(&state.runtime, clamp_limit(q.limit)) {
        Ok(rows) => {
            dock_event!(debug, DockEvent::DataDockLedgerRead, rows = rows.len(), "Data Dock ledger read");
            (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "rows": rows
            })),
        )
            .into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "error": error
            })),
        )
            .into_response(),
    }
}

async fn events_handler(
    State(state): State<DataDockState>,
    Query(q): Query<LedgerQuery>,
) -> impl IntoResponse {
    match read_public_rows(&state.runtime, clamp_limit(q.limit)) {
        Ok(rows) => {
            dock_event!(debug, DockEvent::DataDockLedgerRead, rows = rows.len(), "Data Dock ledger read");
            (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "events": rows
            })),
        )
            .into_response()
        }
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "ok": false,
                "error": error
            })),
        )
            .into_response(),
    }
}

fn parse_docking_port(raw: Option<&str>) -> Result<DockingPortWire, String> {
    match raw.unwrap_or("validation_engine") {
        "inference_engine" | "inference" => Ok(DockingPortWire::InferenceEngine),
        "validation_engine" | "validation" => Ok(DockingPortWire::ValidationEngine),
        "future_features" | "future" => Ok(DockingPortWire::FutureFeatures),
        "regulation_module" | "regulation" => Ok(DockingPortWire::RegulationModule),
        other => Err(format!("unknown docking_port: {other}")),
    }
}

fn wire_to_port(wire: &DockingPortWire) -> DockingPort {
    match wire {
        DockingPortWire::InferenceEngine => DockingPort::InferenceEngine,
        DockingPortWire::ValidationEngine => DockingPort::ValidationEngine,
        DockingPortWire::FutureFeatures => DockingPort::FutureFeatures,
        DockingPortWire::RegulationModule => DockingPort::RegulationModule,
    }
}

fn db_path_from_runtime(runtime: &DockingRuntime) -> PathBuf {
    let db = match runtime.record.db.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    db.path()
        .map(PathBuf::from)
        .unwrap_or_else(default_lattice_db_path)
}

fn signer_public_hex(runtime: &DockingRuntime, agent_id: &str) -> Result<String, String> {
    let store = match runtime.keys.agent_sign_keys.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let key = store.get(agent_id).map_err(|e| e.to_string())?;
    Ok(hex::encode(&key.public))
}

/// Runs the DockDefence limiters for the data-dock signer before any frame is
/// built. The check does not spend a slot, so the dock counts each action once.
fn http_rate_gate(runtime: &DockingRuntime, signer_hex: &str) -> Result<(), String> {
    let signer = hex::decode(signer_hex).map_err(|e| e.to_string())?;
    let rate_key = signer_rate_key(&signer);
    let global_ok = match runtime.defence.global_rate_limiter.lock() {
        Ok(g) => g.would_allow("global"),
        Err(_) => false,
    };
    if global_ok == false {
        return Err(String::from("rate limited: fleet limit reached"));
    }
    let signer_ok = match runtime.defence.rate_limiter.lock() {
        Ok(g) => g.would_allow(&rate_key),
        Err(_) => false,
    };
    if signer_ok == false {
        return Err(String::from("rate limited: data-dock signer limit reached"));
    }
    Ok(())
}

async fn submit_action(runtime: &DockingRuntime, body: Value) -> Result<DataDockLedgerRow, (StatusCode, Value)> {
    if let Some(hit) = first_forbidden(&body) {
        return Err((
            StatusCode::BAD_REQUEST,
            json!({
                "ok": false,
                "error": format!("frontend wire refused field {hit}")
            }),
        ));
    }
    let action_path = body
        .get("action_path")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if action_path.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            json!({
                "ok": false,
                "error": "action_path is required"
            }),
        ));
    }
    let mut payload = body.get("payload").cloned().unwrap_or_else(|| json!({}));
    if !payload.is_object() {
        return Err((
            StatusCode::BAD_REQUEST,
            json!({
                "ok": false,
                "error": "payload must be an object"
            }),
        ));
    }
    if let Some(hit) = first_forbidden(&payload) {
        return Err((
            StatusCode::BAD_REQUEST,
            json!({
                "ok": false,
                "error": format!("frontend wire refused field {hit}")
            }),
        ));
    }
    if let Some(obj) = payload.as_object_mut() {
        obj.entry(String::from("action_path"))
            .or_insert_with(|| Value::String(action_path.clone()));
        if !obj.contains_key("target_id") {
            if let Some(target) = body.get("target_id").cloned() {
                obj.insert(String::from("target_id"), target);
            }
        }
    }
    let channel_id = body
        .get("channel_id")
        .and_then(Value::as_str)
        .unwrap_or(DATA_DOCK_CHANNEL)
        .to_string();
    let docking_port = match parse_docking_port(body.get("docking_port").and_then(Value::as_str)) {
        Ok(p) => p,
        Err(error) => {
            return Err((
                StatusCode::BAD_REQUEST,
                json!({ "ok": false, "error": error }),
            ));
        }
    };
    let input = DynAepEventInput {
        agent_id: String::from(DATA_DOCK_AGENT),
        channel_id,
        contract_id: String::from("dynaep-action-lattice"),
        event_type: body
            .get("event_type")
            .and_then(Value::as_str)
            .unwrap_or("STATE_DELTA")
            .to_string(),
        action_path,
        session_id: Some(String::from(DATA_DOCK_SESSION)),
        docking_port: docking_port.clone(),
        payload,
    };
    let signer = match signer_public_hex(runtime, DATA_DOCK_AGENT) {
        Ok(h) => h,
        Err(error) => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "ok": false, "error": error }),
            ));
        }
    };
    if let Err(detail) = http_rate_gate(runtime, &signer) {
        dock_event!(warn, DockEvent::DataDockRateLimited, "Data Dock action over the defence limit");
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            json!({ "ok": false, "error": detail }),
        ));
    }
    let db_path = db_path_from_runtime(runtime);
    let contracts = bootstrap_contracts();
    let frame = match build_transport_frame(&input, &contracts, &db_path) {
        Ok(f) => f,
        Err(e) => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({
                    "ok": false,
                    "error": e.to_string()
                }),
            ));
        }
    };
    let line = json!({
        "frame": frame,
        "signer_public_hex": signer
    })
    .to_string();
    let port = wire_to_port(&docking_port);
    let first = process_request(runtime, &port, &line);
    let resp = wait_for_admit(runtime, first).await;
    if let Some(deny) = resp.deny {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({
                "ok": false,
                "error": resp.error.unwrap_or_else(|| String::from("Admit denied")),
                "deny": deny
            }),
        ));
    }
    if resp.ok == false || resp.event_id.is_none() {
        return Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({
                "ok": false,
                "error": resp.error.unwrap_or_else(|| String::from("dock did not admit"))
            }),
        ));
    }
    let digest = match resp.digest.clone() {
        Some(d) => d,
        None => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({
                    "ok": false,
                    "error": "admitted row missing digest"
                }),
            ));
        }
    };
    let rows = match read_public_rows(runtime, 500) {
        Ok(r) => r,
        Err(error) => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "ok": false, "error": error }),
            ));
        }
    };
    if let Some(row) = rows.into_iter().find(|r| r.frame_digest == digest) {
        return Ok(row);
    }
    Ok(DataDockLedgerRow {
        id: resp.event_id.unwrap_or(0),
        event_type: input.event_type,
        frame_digest: digest,
        recorded_at_unix: crate::now_unix(),
        channel_id: input.channel_id,
        contract_id: input.contract_id,
        payload: strip_public_payload(&input.payload),
    })
}

async fn wait_for_admit(runtime: &DockingRuntime, first: DockFrameResponse) -> DockFrameResponse {
    if first.pending != Some(true) {
        return first;
    }
    let Some(digest) = first.digest.clone() else {
        return first;
    };
    let deadline = tokio::time::Instant::now() + Duration::from_millis((3 * PULSE_MS as u64) + 250);
    loop {
        if tokio::time::Instant::now() >= deadline {
            let line = json!({ "collect": digest }).to_string();
            return process_request(runtime, &DockingPort::ValidationEngine, &line);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
        let _ = pulse_beat(runtime);
        let line = json!({ "collect": digest.clone() }).to_string();
        let resp = process_request(runtime, &DockingPort::ValidationEngine, &line);
        if resp.pending != Some(true) {
            return resp;
        }
    }
}

async fn actions_handler(
    State(state): State<DataDockState>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    match submit_action(&state.runtime, body).await {
        Ok(row) => {
            dock_event!(info, DockEvent::DataDockActionAccept, digest = %row.frame_digest, "Data Dock action admitted");
            (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "row": row
            })),
        )
            .into_response()
        }
        Err((status, payload)) => {
            if status == StatusCode::UNPROCESSABLE_ENTITY {
                dock_event!(info, DockEvent::DataDockActionDeny, status = status.as_u16(), "Data Dock action denied");
            }
            (status, Json(payload)).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docking_fixtures::data_dock_runtime as fixture_runtime;
    use crate::{open_lattice_db, record_lattice_event, DockingRuntime};
    use axum::body::Body;
    use axum::http::Request;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn cfg(host: &str, port: u16, key: Option<&str>) -> DataDockConfig {
        DataDockConfig {
            enabled: true,
            listen_host: String::from(host),
            listen_port: port,
            api_key: key.map(String::from),
        }
    }

    fn state_for(runtime: Arc<DockingRuntime>, dir: &Path, key: Option<&str>) -> DataDockState {
        DataDockState::new(runtime, &cfg("127.0.0.1", DATA_DOCK_PORT, key), dir.to_path_buf(), false)
    }

    fn app(runtime: Arc<DockingRuntime>) -> Router {
        let dir = std::env::temp_dir();
        build_router(state_for(runtime, &dir, None))
    }

    fn app_with_key(runtime: Arc<DockingRuntime>, dir: &Path, key: &str) -> Router {
        build_router(state_for(runtime, dir, Some(key)))
    }

    async fn body_text(res: axum::response::Response) -> String {
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    fn get(uri: &str) -> Request<Body> {
        Request::builder().uri(uri).body(Body::empty()).unwrap()
    }

    fn free_port() -> u16 {
        let l = std::net::TcpListener::bind("127.0.0.1:0").expect("probe bind");
        l.local_addr().expect("probe addr").port()
    }

    fn plant_row_with_seal_fields(runtime: &DockingRuntime) {
        let db = runtime.record.db.lock().expect("db");
        db.execute(
            "INSERT INTO action_lattice_events
             (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
             VALUES ('secret-agent', 'ch-a', 'dynaep-action-lattice', 'digest-strip', 1, 'STATE_DELTA', ?1, '{}')",
            [json!({
                "ok": true,
                "agent_id": "secret-agent",
                "grants": ["g"],
                "frame": { "capsule": "c" },
                "sealed": "s",
                "signer_public_hex": "aa"
            })
            .to_string()],
        )
        .expect("plant row");
    }

    #[test]
    fn public_row_strips_agent_id_grants_and_frame() {
        let export = DynAepEventExport {
            id: 7,
            agent_id: String::from("secret-agent"),
            channel_id: String::from("ch-a"),
            contract_id: String::from("dynaep-action-lattice"),
            event_type: String::from("STATE_DELTA"),
            frame_digest: String::from("abc"),
            recorded_at_unix: 1,
            payload: json!({
                "ok": true,
                "agent_id": "nope",
                "grants": ["x"],
                "nested": { "agent_permission": ["agent-a"] }
            }),
            agentmesh: json!({ "did": { "verification_key_hex": "aa" } }),
        };
        let row = public_row_from_export(export);
        let text = serde_json::to_string(&row).expect("json");
        assert_eq!(text.contains("agent_id"), false);
        assert_eq!(text.contains("grants"), false);
        assert_eq!(text.contains("agent_permission"), false);
        assert_eq!(text.contains("agentmesh"), false);
        assert_eq!(text.contains("secret-agent"), false);
        assert_eq!(row.payload.get("ok"), Some(&Value::Bool(true)));
        assert_eq!(row.frame_digest, "abc");
    }

    #[test]
    fn four_docks_only() {
        let specs = docking_port_specs("/data/aep/sockets");
        assert_eq!(specs.len(), 4);
        let names: Vec<&str> = specs.iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            vec![
                "inference-engine-dock",
                "kernel-admit-dock",
                "future-features-dock",
                "regulation-module-dock"
            ]
        );
        assert_eq!(specs.iter().any(|s| s.listen_path.contains("display")), false);
        assert_eq!(specs.iter().any(|s| s.listen_path.contains("data-dock")), false);
        let public_compose = include_str!("../../../docker-compose.public.yml");
        assert!(public_compose.contains("8413"));
        assert_eq!(public_compose.contains("28429"), false);
        let compose = include_str!("../../../docker-compose.yml");
        assert!(compose.contains("8413"));
        assert_eq!(compose.contains("28429"), false);
    }

    #[test]
    fn no_display_api_folder() {
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let display_folder = ["display", "api"].join("-");
        assert_eq!(crate_dir.join("../../AEP-Components").join(display_folder).exists(), false);
        assert_eq!(crate_dir.join("../crate").exists(), false);
        let docking_src = include_str!("docking/mod.rs");
        assert!(docking_src.contains("pub struct DockFrameResponse"));
        assert_eq!(docking_src.contains("display"), false);
    }

    #[tokio::test]
    async fn data_dock_health_status_matches_rollup() {
        let (dir, runtime) = fixture_runtime();
        let router = build_router(state_for(runtime.clone(), dir.path(), None));
        let v: Value = serde_json::from_str(&body_text(router.clone().oneshot(get("/health")).await.unwrap()).await).unwrap();
        let expected = crate::rollup_status(
            runtime.docking_ports_listening(),
            runtime.admit.hub.is_loaded(),
            None,
            runtime.sqlite_is_closed(),
        );
        assert_eq!(v.get("status").and_then(Value::as_str), Some(expected));
        assert_eq!(v.get("ok").and_then(Value::as_bool), Some(expected != "error"));
        assert_eq!(v.get("sqlite_closed").and_then(Value::as_bool), Some(false));
        runtime.close_sqlite();
        let v: Value = serde_json::from_str(&body_text(router.oneshot(get("/health")).await.unwrap()).await).unwrap();
        assert_eq!(v.get("status").and_then(Value::as_str), Some("error"));
        assert_eq!(v.get("ok").and_then(Value::as_bool), Some(false));
        assert_eq!(v.get("sqlite_closed").and_then(Value::as_bool), Some(true));
    }

    #[tokio::test]
    async fn open_bind_without_key_refuses_listen() {
        let (dir, runtime) = fixture_runtime();
        let port = free_port();
        let open = cfg("0.0.0.0", port, None);
        assert!(open.check_bind().is_err());
        let state = DataDockState::new(runtime, &open, dir.path().to_path_buf(), false);
        let err = serve(state, &open).await.expect_err("open bind without key must refuse");
        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
        assert!(err.to_string().contains("DATA_DOCK_API_KEY"));
        assert!(tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_err());
        assert!(cfg("0.0.0.0", port, Some("k-open")).check_bind().is_ok());
        assert!(cfg("::1", port, None).check_bind().is_ok());
        assert!(cfg("localhost", port, None).check_bind().is_ok());
        assert!(cfg("10.0.0.5", port, None).check_bind().is_err());
    }

    #[tokio::test]
    async fn loopback_without_key_allowed() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (dir, runtime) = fixture_runtime();
        let loopback = cfg("127.0.0.1", 0, None);
        assert!(loopback.check_bind().is_ok());
        let state = DataDockState::new(runtime, &loopback, dir.path().to_path_buf(), false);
        let (handle, addr) = serve(state, &loopback).await.expect("loopback bind");
        assert!(addr.ip().is_loopback());
        let mut stream = tokio::net::TcpStream::connect(addr).await.expect("connect");
        stream
            .write_all(b"GET /v1/ledger HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .expect("write");
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).await.expect("read");
        let text = String::from_utf8_lossy(&buf);
        assert!(text.starts_with("HTTP/1.1 200"), "{text}");
        handle.abort();
    }

    #[tokio::test]
    async fn v1_without_key_is_401() {
        let (dir, runtime) = fixture_runtime();
        let router = app_with_key(runtime, dir.path(), "k-test-good");
        for uri in ["/v1/ledger", "/v1/events", "/v1/health"] {
            let res = router.clone().oneshot(get(uri)).await.unwrap();
            assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
        }
        let wrong = Request::builder()
            .uri("/v1/ledger")
            .header("authorization", "Bearer k-test-bad")
            .body(Body::empty())
            .unwrap();
        assert_eq!(router.clone().oneshot(wrong).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let wrong_header = Request::builder()
            .uri("/v1/ledger")
            .header(DATA_KEY_HEADER, "k-test-bad")
            .body(Body::empty())
            .unwrap();
        assert_eq!(router.clone().oneshot(wrong_header).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let post = Request::builder()
            .method("POST")
            .uri("/v1/actions")
            .header("content-type", "application/json")
            .body(Body::from(json!({ "action_path": "root:ping" }).to_string()))
            .unwrap();
        assert_eq!(router.clone().oneshot(post).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        let health = router.oneshot(get("/health")).await.unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        let text = body_text(health).await;
        assert_eq!(text.contains("\"rows\""), false);
        assert_eq!(text.contains("k-test-good"), false);
    }

    #[tokio::test]
    async fn v1_with_key_still_strips_forbidden_fields() {
        let (dir, runtime) = fixture_runtime();
        plant_row_with_seal_fields(&runtime);
        let router = app_with_key(runtime, dir.path(), "k-test-good");
        let bearer = Request::builder()
            .uri("/v1/ledger")
            .header("authorization", "Bearer k-test-good")
            .body(Body::empty())
            .unwrap();
        let res = router.clone().oneshot(bearer).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let text = body_text(res).await;
        for key in ["agent_id", "grants", "\"frame\"", "sealed", "signer_public_hex", "capsule", "secret-agent"] {
            assert_eq!(text.contains(key), false, "{key} leaked: {text}");
        }
        assert!(text.contains("digest-strip"));
        let header_key = Request::builder()
            .uri("/v1/events")
            .header(DATA_KEY_HEADER, "k-test-good")
            .body(Body::empty())
            .unwrap();
        let res = router.clone().oneshot(header_key).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(body_text(res).await.contains("grants"), false);
        let refused = Request::builder()
            .method("POST")
            .uri("/v1/actions")
            .header("authorization", "Bearer k-test-good")
            .header("content-type", "application/json")
            .body(Body::from(json!({ "action_path": "root:ping", "payload": { "sealed": "x" } }).to_string()))
            .unwrap();
        assert_eq!(router.oneshot(refused).await.unwrap().status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn actions_over_limit_returns_429_without_ledger_row() {
        let (dir, runtime) = fixture_runtime();
        provision_server_identity(&runtime, dir.path()).expect("provision");
        let signer = signer_public_hex(&runtime, DATA_DOCK_AGENT).expect("signer");
        let rate_key = signer_rate_key(&hex::decode(&signer).expect("hex"));
        {
            let mut limiter = runtime.defence.rate_limiter.lock().expect("limiter");
            let mut spent = 0;
            while limiter.check(&rate_key).is_ok() {
                spent += 1;
                assert!(spent < 100_000, "limiter never closed");
            }
        }
        let before = crate::event_count(&runtime.record.db.lock().expect("db")).expect("count");
        let held_before: i64 = runtime
            .record
            .db
            .lock()
            .expect("db")
            .query_row("SELECT COUNT(*) FROM held_frame_digests", [], |r| r.get(0))
            .expect("held");
        let router = app(runtime.clone());
        let res = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/actions")
                    .header("content-type", "application/json")
                    .body(Body::from(json!({ "action_path": "root:ping", "payload": {} }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::TOO_MANY_REQUESTS);
        let v: Value = serde_json::from_str(&body_text(res).await).unwrap();
        assert_eq!(v.get("ok").and_then(Value::as_bool), Some(false));
        let after = crate::event_count(&runtime.record.db.lock().expect("db")).expect("count");
        let held_after: i64 = runtime
            .record
            .db
            .lock()
            .expect("db")
            .query_row("SELECT COUNT(*) FROM held_frame_digests", [], |r| r.get(0))
            .expect("held");
        assert_eq!(after, before);
        assert_eq!(held_after, held_before);
        assert!(runtime.record.pulse.lock().expect("pulse").held.is_empty());
    }

    #[test]
    fn second_boot_does_not_rotate_data_dock_key() {
        let (dir, first) = fixture_runtime();
        provision_server_identity(&first, dir.path()).expect("first boot");
        let first_key = signer_public_hex(&first, DATA_DOCK_AGENT).expect("first key");
        drop(first);
        let db = dir.path().join("aep-action-lattice.db");
        let conn = open_lattice_db(&db).expect("reopen");
        let second = DockingRuntime::with_data_dir(
            dir.path().join("sockets").to_string_lossy().into_owned(),
            conn,
            &[],
            dir.path(),
        )
        .expect("second runtime");
        provision_server_identity(&second, dir.path()).expect("second boot");
        let second_key = signer_public_hex(&second, DATA_DOCK_AGENT).expect("second key");
        assert_eq!(first_key, second_key);
    }

    #[tokio::test]
    async fn health_and_ledger_are_json_without_frontend_seal() {
        let (_dir, runtime) = fixture_runtime();
        {
            let db = runtime.record.db.lock().expect("db");
            record_lattice_event(
                &db,
                "AG-BOOT",
                "ch-selftest",
                "dynaep-action-lattice",
                "digest-data-dock",
                1,
            )
            .expect("record");
        }
        let router = app(runtime);
        let health = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(health.into_body(), 65536)
            .await
            .unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v.get("service").and_then(Value::as_str), Some(DATA_DOCK_SERVICE));
        assert_eq!(v.get("port").and_then(Value::as_u64), Some(8413));
        assert_eq!(v.get("ucb_port").and_then(Value::as_u64), Some(8412));
        assert_eq!(v.get("docks").and_then(Value::as_u64), Some(4));
        assert_eq!(v.get("display_api").and_then(Value::as_bool), Some(false));
        assert_eq!(v.get("bind_28429").and_then(Value::as_bool), Some(false));

        let ledger = router
            .oneshot(
                Request::builder()
                    .uri("/v1/ledger")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(ledger.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(ledger.into_body(), 65536)
            .await
            .unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(text.contains("agent_id"), false);
        assert_eq!(text.contains("grants"), false);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(v.get("ok").and_then(Value::as_bool), Some(true));
        let rows = v.get("rows").and_then(Value::as_array).cloned().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            rows[0].get("frame_digest").and_then(Value::as_str),
            Some("digest-data-dock")
        );
    }

    #[tokio::test]
    async fn post_actions_refuses_frontend_seal_fields() {
        let (_dir, runtime) = fixture_runtime();
        let router = app(runtime);
        let res = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/actions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "action_path": "root:ping",
                            "agent_id": "frontend",
                            "payload": { "ok": true }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(res.into_body(), 65536)
            .await
            .unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v.get("ok").and_then(Value::as_bool), Some(false));
        let err = v.get("error").and_then(Value::as_str).unwrap_or("");
        assert!(err.contains("agent_id"), "{err}");
    }

    #[tokio::test]
    async fn post_actions_refuses_grants_on_payload() {
        let (_dir, runtime) = fixture_runtime();
        let router = app(runtime);
        let res = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/actions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "action_path": "root:ping",
                            "payload": { "grants": ["agent-a"] }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let bytes = axum::body::to_bytes(res.into_body(), 65536)
            .await
            .unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        let err = v.get("error").and_then(Value::as_str).unwrap_or("");
        assert!(err.contains("grants"), "{err}");
    }

    #[tokio::test]
    async fn post_actions_seals_on_server_and_returns_row_or_deny() {
        let (dir, runtime) = fixture_runtime();
        provision_server_identity(&runtime, dir.path()).expect("provision");
        let router = app(runtime);
        let res = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/actions")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({
                            "action_path": "root:ping",
                            "payload": { "ok": true, "target_id": "scene-a" }
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 65536)
            .await
            .unwrap();
        let text = String::from_utf8(bytes.to_vec()).unwrap();
        assert_eq!(text.contains("\"agent_id\""), false);
        assert_eq!(text.contains("\"grants\""), false);
        assert_eq!(text.contains("\"frame\""), false);
        let v: Value = serde_json::from_str(&text).unwrap();
        assert!(
            status == StatusCode::OK || status == StatusCode::UNPROCESSABLE_ENTITY,
            "status={status} body={text}"
        );
        if status == StatusCode::OK {
            assert_eq!(v.get("ok").and_then(Value::as_bool), Some(true));
            assert!(v.get("row").is_some());
        } else {
            assert_eq!(v.get("ok").and_then(Value::as_bool), Some(false));
            assert!(v.get("error").is_some() || v.get("deny").is_some());
        }
    }
}
