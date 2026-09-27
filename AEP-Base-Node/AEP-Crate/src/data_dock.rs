//! Data Dock HTTP on 8413. Frontends read already-admitted lattice records as JSON.
//! Governed writes are sealed on the server and sent through the four existing docks.
//! This is not a fifth Base Node dock. Display API does not return. Port 28429 stays unbound.

use crate::lattice_log::{export_dynaep_events, DynAepEventExport, DynAepEventInput, DockingPortWire};
use crate::task_manifest::{TaskManifestTrust, TaskManifestV1};
use crate::{
    bootstrap_contracts, build_transport_frame, default_lattice_db_path, docking_port_specs,
    process_request, pulse_beat, DockFrameResponse, DockingRuntime,
};
use aep_base_node_pulse::PULSE_MS;
use aep_lattice_channel::DockingPort;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub const DATA_DOCK_PORT: u16 = 8413;
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

#[derive(Debug, Clone)]
pub struct DataDockConfig {
    pub enabled: bool,
    pub listen_host: String,
    pub listen_port: u16,
}

impl DataDockConfig {
    pub fn from_env() -> Self {
        let enabled = match std::env::var("DATA_DOCK") {
            Ok(v) => v != "0",
            Err(_) => true,
        };
        let in_docker = std::env::var("AEP_IN_DOCKER").ok().as_deref() == Some("1");
        let default_host = if in_docker {
            String::from("0.0.0.0")
        } else {
            String::from("127.0.0.1")
        };
        Self {
            enabled,
            listen_host: std::env::var("DATA_DOCK_HOST").unwrap_or(default_host),
            listen_port: std::env::var("DATA_DOCK_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(DATA_DOCK_PORT),
        }
    }
}

#[derive(Clone)]
pub struct DataDockState {
    pub runtime: Arc<DockingRuntime>,
    pub listen_port: u16,
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
    Router::new()
        .route("/health", get(health_handler))
        .route("/v1/health", get(health_handler))
        .route("/v1/ledger", get(ledger_handler))
        .route("/v1/events", get(events_handler))
        .route("/v1/actions", post(actions_handler))
        .with_state(state)
}

pub async fn serve(
    state: DataDockState,
    host: String,
    port: u16,
) -> Result<JoinHandle<()>, std::io::Error> {
    let addr = format!("{host}:{port}");
    let listener = TcpListener::bind(&addr).await?;
    tracing::info!(addr = %addr, "Data Dock HTTP listening");
    let app = build_router(state);
    Ok(tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::warn!(error = %e, "Data Dock HTTP exited");
        }
    }))
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
        store.provision(DATA_DOCK_AGENT)?;
        store.flush().map_err(|e| crate::BaseNodeError::Io(e.to_string()))?;
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

fn health_body(port: u16) -> DataDockHealth {
    DataDockHealth {
        ok: true,
        service: String::from(DATA_DOCK_SERVICE),
        version: String::from(env!("CARGO_PKG_VERSION")),
        status: String::from("ok"),
        port,
        ucb_port: 8412,
        docks: docking_port_specs("/data/aep/sockets").len() as u8,
        display_api: false,
        bind_28429: false,
    }
}

async fn health_handler(State(state): State<DataDockState>) -> Json<DataDockHealth> {
    Json(health_body(state.listen_port))
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
        Ok(rows) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "rows": rows
            })),
        )
            .into_response(),
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
        Ok(rows) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "events": rows
            })),
        )
            .into_response(),
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

fn submit_action(runtime: &DockingRuntime, body: Value) -> Result<DataDockLedgerRow, (StatusCode, Value)> {
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
    let signer = match signer_public_hex(runtime, DATA_DOCK_AGENT) {
        Ok(h) => h,
        Err(error) => {
            return Err((
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "ok": false, "error": error }),
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
    let resp = wait_for_admit(runtime, first);
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

fn wait_for_admit(runtime: &DockingRuntime, first: DockFrameResponse) -> DockFrameResponse {
    if first.pending != Some(true) {
        return first;
    }
    let Some(digest) = first.digest.clone() else {
        return first;
    };
    let deadline = std::time::Instant::now() + Duration::from_millis((3 * PULSE_MS as u64) + 250);
    loop {
        if std::time::Instant::now() >= deadline {
            let line = json!({ "collect": digest }).to_string();
            return process_request(runtime, &DockingPort::ValidationEngine, &line);
        }
        std::thread::sleep(Duration::from_millis(25));
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
    match submit_action(&state.runtime, body) {
        Ok(row) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "row": row
            })),
        )
            .into_response(),
        Err((status, payload)) => (status, Json(payload)).into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{open_lattice_db, record_lattice_event, DockingRuntime};
    use axum::body::Body;
    use axum::http::Request;
    use std::sync::Arc;
    use tower::ServiceExt;

    fn plant_lattice(dir: &Path) {
        std::fs::write(
            dir.join("lattice.yaml"),
            "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n",
        )
        .expect("lattice");
    }

    fn fixture_runtime() -> (tempfile::TempDir, Arc<DockingRuntime>) {
        let dir = tempfile::tempdir().expect("tempdir");
        plant_lattice(dir.path());
        let gap = dir.path().join("gap").join("policies").join("reference");
        std::fs::create_dir_all(&gap).expect("gap");
        std::fs::write(
            gap.join("data-dock.gap"),
            "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: data-dock\n      action: root:ping\n    - agent_id: AG-BOOT\n      action: root:ping\n",
        )
        .expect("hub");
        let sockets = dir.path().join("sockets");
        std::fs::create_dir_all(&sockets).expect("sockets");
        let db = dir.path().join("aep-action-lattice.db");
        let conn = open_lattice_db(&db).expect("open");
        let runtime = DockingRuntime::with_data_dir(
            sockets.to_string_lossy().into_owned(),
            conn,
            &[],
            dir.path(),
        )
        .expect("runtime");
        (dir, Arc::new(runtime))
    }

    fn app(runtime: Arc<DockingRuntime>) -> Router {
        build_router(DataDockState {
            runtime,
            listen_port: DATA_DOCK_PORT,
        })
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
    fn four_docks_remain_and_display_api_folder_is_gone() {
        let specs = docking_port_specs("/data/aep/sockets");
        assert_eq!(specs.len(), 4);
        assert_eq!(
            specs.iter().any(|s| s.listen_path.contains("display")),
            false
        );
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let display = crate_dir.join("../../AEP-Components/display-api");
        assert_eq!(display.exists(), false);
        let public_compose = include_str!("../../../docker-compose.public.yml");
        assert!(public_compose.contains("8413"));
        assert_eq!(public_compose.contains("28429"), false);
        let compose = include_str!("../../../docker-compose.yml");
        assert!(compose.contains("8413"));
        assert_eq!(compose.contains("28429"), false);
        let docking_src = include_str!("docking.rs");
        assert!(docking_src.contains("pub struct DockFrameResponse"));
        assert_eq!(docking_src.contains("display"), false);
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
