//! Public UCB HTTP: ingest, delegate, health, rollback and egress.

use crate::auth::{bind_agent, extract_bearer_or_header, AuthGuard};
use crate::bridge::{ingest_foreign_payload, rollback_foreign_integrations, UcbRuntime};
use crate::delegate::{delegate_to_foreign_model, DelegateBody};
use crate::egress::{
    audit_host, auth_token_env_denied, credential_inject_allowed, match_route,
    proxy_request_isolated, strip_caller_headers, EgressAudit, EgressConfig,
};
use crate::gap_manifest::{compile_provided, compile_provided_json, LOCAL_PROFILE};
use crate::ingress::ForeignIngestBody;
use crate::lattice::{DockResponse, LatticeRuntime};
use crate::manifest::{manifest_error_report, signed_from_task};
use crate::mcp::{handle_mcp_request, mcp_capabilities, parse_rollback_diff_ids};
use crate::store::TaskManifestV1;
use crate::{BRIDGE_ID, UCB_VERSION};
use aep_ucb_perimeter_v1::{egress_power_allowed, AuthIdentity, Scope, StrictMode, WireLimits};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub runtime: Arc<UcbRuntime>,
    pub auth: AuthGuard,
    pub base_path: String,
}

pub fn build_router(state: AppState) -> Router {
    let hard = WireLimits::default().ingest_hard_bytes;
    let api = Router::new()
        .route("/health", get(health_handler))
        .route("/ucb/v1/health", get(health_handler))
        .route("/ucb/v1/capabilities", get(capabilities_handler))
        .route("/ucb/v1/ingest", post(ingest_handler))
        .route("/ucb/v1/delegate", post(delegate_handler))
        .route("/ucb/v1/rollback", post(rollback_handler))
        .route("/ucb/v1/egress", post(egress_handler))
        .route("/ucb/v1/compile-manifest", post(compile_handler))
        .route("/ucb/v1/mcp", post(mcp_handler))
        .with_state(state.clone())
        .layer(DefaultBodyLimit::max(hard));
    if state.base_path.is_empty() {
        api.layer(TraceLayer::new_for_http())
    } else {
        Router::new()
            .nest(&state.base_path, api)
            .layer(TraceLayer::new_for_http())
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in pairs {
        m.insert(String::from(k), v);
    }
    Value::Object(m)
}

/// The public health answer. It reads the snapshot in memory, so a request starts no
/// process and sends no dock frame. The refresh task of the runtime keeps it current.
async fn health_handler(State(state): State<AppState>) -> Json<Value> {
    let full = state.runtime.health_snapshot();
    Json(obj(vec![
        (
            "service",
            full.get("service")
                .cloned()
                .unwrap_or(Value::String(String::from("ucb-universal-connect-bridge"))),
        ),
        (
            "version",
            full.get("version")
                .cloned()
                .unwrap_or(Value::String(String::from(UCB_VERSION))),
        ),
        (
            "status",
            full.get("status")
                .cloned()
                .unwrap_or(Value::String(String::from("unknown"))),
        ),
    ]))
}

/// The lattice part of a health snapshot before the first ping has run.
pub fn lattice_not_probed() -> Value {
    obj(vec![
        ("ok", Value::Bool(false)),
        ("error", Value::String(String::from("not probed yet"))),
    ])
}

/// The lattice part of a health snapshot from one ping.
pub fn lattice_probe(ping: Result<DockResponse, String>) -> Value {
    match ping {
        Ok(ping) => obj(vec![
            ("ok", Value::Bool(true)),
            (
                "digest",
                ping.digest.map(Value::String).unwrap_or(Value::Null),
            ),
            (
                "event_id",
                ping.event_id.map(Value::from).unwrap_or(Value::Null),
            ),
        ]),
        Err(e) => obj(vec![
            ("ok", Value::Bool(false)),
            ("error", Value::String(e)),
        ]),
    }
}

/// A full health snapshot from the dock sockets and the lattice part.
pub fn health_document(lattice_rt: &LatticeRuntime, lattice: &Value) -> Value {
    let docks = lattice_rt.dock_status();
    let listening = docks
        .iter()
        .filter(|d| d.get("listening").and_then(|v| v.as_bool()) == Some(true))
        .count();
    let lattice = lattice.clone();
    let status = if listening >= 4 && lattice.get("ok") == Some(&Value::Bool(true)) {
        "ok"
    } else {
        "degraded"
    };
    obj(vec![
        (
            "service",
            Value::String(String::from("ucb-universal-connect-bridge")),
        ),
        ("version", Value::String(String::from(UCB_VERSION))),
        ("status", Value::String(String::from(status))),
        ("implementation", Value::String(String::from("rust"))),
        ("lattice", lattice),
        ("docking_ports", Value::Array(docks)),
        ("docking_ports_listening", Value::Bool(listening >= 4)),
        (
            "capabilities",
            Value::Array(vec![
                Value::String(String::from("ingest")),
                Value::String(String::from("delegate")),
                Value::String(String::from("health")),
                Value::String(String::from("rollback")),
                Value::String(String::from("egress")),
                Value::String(String::from("compile-manifest")),
                Value::String(String::from("mcp")),
            ]),
        ),
        ("synthesis", Value::Bool(false)),
        ("gap_engine", Value::String(String::from(LOCAL_PROFILE))),
        (
            "predicate_profile",
            Value::String(String::from("perimeter-v1")),
        ),
    ])
}

pub fn capabilities_document() -> Value {
    obj(vec![
        ("bridge", Value::String(String::from(BRIDGE_ID))),
        ("perimeter", Value::String(String::from("attach-gateway"))),
        ("implementation", Value::String(String::from("rust"))),
        ("evaluator", Value::String(String::from("base-node-only"))),
        (
            "operations",
            Value::Array(vec![
                Value::String(String::from("ingest")),
                Value::String(String::from("delegate")),
                Value::String(String::from("health")),
                Value::String(String::from("rollback")),
                Value::String(String::from("egress")),
                Value::String(String::from("compile-manifest")),
                Value::String(String::from("mcp")),
            ]),
        ),
        ("mcp", mcp_capabilities()),
        (
            "foreign_frameworks",
            Value::String(String::from("fixtures not protocol members")),
        ),
        (
            "task_manifest",
            obj(vec![
                ("required_for_ingest", Value::Bool(true)),
                ("synthesis", Value::Bool(false)),
                ("compiler", Value::String(String::from(LOCAL_PROFILE))),
            ]),
        ),
        ("deny_report", Value::String(String::from("kernel-shape"))),
        (
            "auth",
            obj(vec![
                (
                    "schemes",
                    Value::Array(vec![
                        Value::String(String::from("Bearer")),
                        Value::String(String::from("X-UCB-API-Key")),
                    ]),
                ),
                (
                    "required_for",
                    Value::Array(vec![
                        Value::String(String::from("ingest")),
                        Value::String(String::from("delegate")),
                        Value::String(String::from("rollback")),
                        Value::String(String::from("egress")),
                        Value::String(String::from("compile-manifest")),
                        Value::String(String::from("mcp")),
                    ]),
                ),
                ("model", Value::String(String::from("per-agent-keys"))),
            ]),
        ),
    ])
}

async fn capabilities_handler() -> Json<Value> {
    Json(capabilities_document())
}

fn is_ok_true(v: &Value) -> bool {
    v.get("ok") == Some(&Value::Bool(true))
}

fn forbidden_other_agent() -> axum::response::Response {
    (
        StatusCode::FORBIDDEN,
        Json(obj(vec![
            ("ok", Value::Bool(false)),
            (
                "error",
                Value::String(String::from("the UCB API key acts for another agent")),
            ),
        ])),
    )
        .into_response()
}

/// A refusal answered to the caller. Boxed so that the Ok path stays small.
type Refusal = Box<axum::response::Response>;

/// The agent the request acts for, or 403 when an agent key names another agent.
fn bound_agent(
    identity: &AuthIdentity,
    requested: Option<&str>,
) -> Result<Option<String>, Refusal> {
    bind_agent(identity, requested).map_err(|_| Box::new(forbidden_other_agent()))
}

/// The agent of an agent key. The operator key acts for every agent.
fn acting_agent(identity: &AuthIdentity) -> Option<&str> {
    match identity {
        AuthIdentity::Agent { agent_id, .. } => Some(agent_id.as_str()),
        AuthIdentity::Operator => None,
    }
}

async fn delegate_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<DelegateBody>,
) -> impl IntoResponse {
    let identity = match require_auth(&state, &headers, Scope::Delegate) {
        Ok(i) => i,
        Err(resp) => return *resp,
    };
    match bound_agent(&identity, body.agent_id.as_deref()) {
        Ok(agent) => body.agent_id = agent,
        Err(resp) => return *resp,
    }
    let result = delegate_to_foreign_model(&state.runtime, body).await;
    let status = if is_ok_true(&result) {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(result)).into_response()
}

async fn ingest_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<ForeignIngestBody>,
) -> impl IntoResponse {
    let identity = match require_auth(&state, &headers, Scope::Ingest) {
        Ok(i) => i,
        Err(resp) => return *resp,
    };
    match bound_agent(&identity, body.agent_id.as_deref()) {
        Ok(agent) => body.agent_id = agent,
        Err(resp) => return *resp,
    }
    let result = ingest_foreign_payload(&state.runtime, body).await;
    let status = if is_ok_true(&result) {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(result)).into_response()
}

async fn rollback_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let identity = match require_auth(&state, &headers, Scope::Rollback) {
        Ok(i) => i,
        Err(resp) => return *resp,
    };
    let diff_ids = match parse_rollback_diff_ids(&body) {
        Ok(ids) => ids,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(obj(vec![
                    ("ok", Value::Bool(false)),
                    ("error", Value::String(message)),
                ])),
            )
                .into_response();
        }
    };
    let result =
        rollback_foreign_integrations(&state.runtime, diff_ids, acting_agent(&identity)).await;
    let status = if is_ok_true(&result) {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(result)).into_response()
}

#[derive(Debug, Deserialize)]
struct EgressBody {
    agent_id: String,
    method: String,
    path: String,
    #[serde(default)]
    body: Option<String>,
}

async fn egress_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<EgressBody>,
) -> impl IntoResponse {
    let identity = match require_auth(&state, &headers, Scope::Egress) {
        Ok(i) => i,
        Err(resp) => return *resp,
    };
    if let Err(resp) = bound_agent(&identity, Some(&body.agent_id)) {
        return *resp;
    }
    let isolated = strip_caller_headers(&headers);
    let Some(manifest) = state.runtime.manifests.load(&body.agent_id) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                (
                    "error",
                    Value::String(String::from("task manifest missing")),
                ),
            ])),
        )
            .into_response();
    };
    // The manifest must be stored under the agent it names, its digest must match the
    // one serialization that is digested and signed, and its signature must verify
    // against the signer key registered for that agent.
    if manifest.agent_id != body.agent_id {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(crate::bridge::deny_to_value(
                crate::manifest::agent_id_mismatch(),
            )),
        )
            .into_response();
    }
    let signed = signed_from_task(&manifest);
    if let Err(e) = egress_power_allowed(
        &signed,
        StrictMode::On,
        state.runtime.signers.get(&body.agent_id),
    ) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(crate::bridge::deny_to_value(manifest_error_report(&e))),
        )
            .into_response();
    }
    let cfg = manifest
        .egress
        .as_ref()
        .map(|v| EgressConfig::from_manifest_egress(v, state.runtime.config.strict_egress))
        .unwrap_or_default();
    let Some(route) = match_route(&cfg, &body.path) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                ("error", Value::String(String::from("no egress route"))),
            ])),
        )
            .into_response();
    };
    // egress_power_allowed has verified the signature and refused a provisional manifest.
    let inject = credential_inject_allowed(true, signed.provisional);
    if auth_token_env_denied(inject, route.auth_token_env.as_deref()) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                (
                    "error",
                    Value::String(String::from(
                        "auth_token_env denied unless signed and non-provisional",
                    )),
                ),
            ])),
        )
            .into_response();
    }
    let bytes = body.body.as_ref().map(|s| s.as_bytes().to_vec());
    let result = proxy_request_isolated(
        route,
        &body.method,
        &body.path,
        bytes,
        inject,
        Some(&isolated),
    )
    .await;
    match result {
        Ok(resp) => {
            let audit = EgressAudit {
                agent_id: body.agent_id.clone(),
                route: route.path_prefix.clone(),
                method: body.method.clone(),
                host: audit_host(&route.upstream),
                bytes: resp.body.len(),
                status: resp.status,
                manifest_digest: signed.digest.clone(),
            };
            let mut rec = serde_json::Map::new();
            rec.insert(
                String::from("operation"),
                Value::String(String::from("egress_audit")),
            );
            rec.insert(
                String::from("snapshot"),
                serde_json::to_value(&audit).unwrap_or(Value::Null),
            );
            let _ = state
                .runtime
                .journal
                .with_lock(|| state.runtime.journal.append(Value::Object(rec)))
                .await;
            (
                StatusCode::from_u16(resp.status).unwrap_or(StatusCode::OK),
                Json(obj(vec![
                    ("ok", Value::Bool(resp.status < 400)),
                    ("status", Value::from(resp.status)),
                    ("audit", serde_json::to_value(&audit).unwrap_or(Value::Null)),
                    (
                        "content_type",
                        resp.content_type.map(Value::String).unwrap_or(Value::Null),
                    ),
                    ("body_b64", Value::String(hex::encode(&resp.body))),
                ])),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                ("error", Value::String(e)),
            ])),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize)]
struct CompileBody {
    source: Option<String>,
    task_manifest: Option<Value>,
}

async fn compile_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CompileBody>,
) -> impl IntoResponse {
    if let Err(resp) = require_auth(&state, &headers, Scope::Ingest) {
        return *resp;
    }
    let compiled: Result<TaskManifestV1, _> = if let Some(src) = body
        .source
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        compile_provided(src)
    } else if let Some(value) = body.task_manifest {
        compile_provided_json(value)
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                (
                    "error",
                    Value::String(String::from("supply source GAP text or task_manifest JSON")),
                ),
            ])),
        )
            .into_response();
    };
    match compiled {
        Ok(m) => (
            StatusCode::OK,
            Json(obj(vec![
                ("ok", Value::Bool(true)),
                ("compiler", Value::String(String::from(LOCAL_PROFILE))),
                (
                    "task_manifest",
                    serde_json::to_value(&m).unwrap_or(Value::Null),
                ),
            ])),
        )
            .into_response(),
        Err(report) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(crate::bridge::deny_to_value(report)),
        )
            .into_response(),
    }
}

fn mcp_tool_scope(body: &Value) -> Scope {
    let method = body.get("method").and_then(Value::as_str).unwrap_or("");
    if method != "tools/call" {
        return Scope::Ingest;
    }
    match body
        .get("params")
        .and_then(|p| p.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("")
    {
        "ucb_delegate" => Scope::Delegate,
        "ucb_rollback" => Scope::Rollback,
        _ => Scope::Ingest,
    }
}

/// Bind the agent_id argument of an MCP ingest or delegate call to the key. Other
/// methods and tools name no agent; rollback is bound in the rollback itself.
fn bind_mcp_agent(body: &mut Value, identity: &AuthIdentity) -> Result<(), Refusal> {
    if body.get("method").and_then(Value::as_str) != Some("tools/call") {
        return Ok(());
    }
    let tool = body
        .get("params")
        .and_then(|p| p.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if !matches!(tool, "ucb_ingest" | "ucb_delegate") {
        return Ok(());
    }
    let Some(args) = body
        .get_mut("params")
        .and_then(|p| p.get_mut("arguments"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    let requested = args.get("agent_id").and_then(Value::as_str);
    match bound_agent(identity, requested)? {
        Some(agent) => {
            args.insert(String::from("agent_id"), Value::String(agent));
        }
        None => {
            args.remove("agent_id");
        }
    }
    Ok(())
}

async fn mcp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> impl IntoResponse {
    let identity = match require_auth(&state, &headers, mcp_tool_scope(&body)) {
        Ok(i) => i,
        Err(resp) => return *resp,
    };
    if let Err(resp) = bind_mcp_agent(&mut body, &identity) {
        return *resp;
    }
    let result = handle_mcp_request(&state.runtime, body, acting_agent(&identity)).await;
    (StatusCode::OK, Json(result)).into_response()
}

/// Check the key of the request for `scope` and return its identity.
fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
    scope: Scope,
) -> Result<AuthIdentity, Refusal> {
    let auth_hdr = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let api_hdr = headers.get("x-ucb-api-key").and_then(|v| v.to_str().ok());
    let token = extract_bearer_or_header(auth_hdr, api_hdr);
    let Some(token) = token else {
        return Err(Box::new(
            (
                StatusCode::UNAUTHORIZED,
                Json(obj(vec![
                    ("ok", Value::Bool(false)),
                    (
                        "error",
                        Value::String(String::from(
                            "UCB API key required (Authorization: Bearer or X-UCB-API-Key)",
                        )),
                    ),
                ])),
            )
                .into_response(),
        ));
    };
    state.auth.authorize(&token, scope).map_err(|_| {
        Box::new(
            (
                StatusCode::FORBIDDEN,
                Json(obj(vec![
                    ("ok", Value::Bool(false)),
                    (
                        "error",
                        Value::String(String::from("invalid UCB API key or scope")),
                    ),
                ])),
            )
                .into_response(),
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_capabilities_name_local_compiler() {
        let v = capabilities_document();
        assert_eq!(
            v.get("task_manifest")
                .and_then(|m| m.get("compiler"))
                .and_then(|c| c.as_str()),
            Some(LOCAL_PROFILE)
        );
        assert_eq!(
            v.get("task_manifest")
                .and_then(|m| m.get("synthesis"))
                .and_then(|c| c.as_bool()),
            Some(false)
        );
        let ops = v
            .get("operations")
            .and_then(|o| o.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(ops.iter().any(|x| x.as_str() == Some("compile-manifest")));
    }

    #[test]
    fn rollback_handler_uses_parse_rollback_diff_ids() {
        assert!(parse_rollback_diff_ids(&serde_json::json!({"diff_ids": []})).is_err());
        assert!(parse_rollback_diff_ids(&serde_json::json!({"diff_ids": ["a", "b"]})).is_err());
        assert!(parse_rollback_diff_ids(&serde_json::json!({"diff_ids": "tail"})).is_err());
        assert!(parse_rollback_diff_ids(&serde_json::json!({"diff_ids": 1})).is_err());
        assert!(parse_rollback_diff_ids(&serde_json::json!({"diff_ids": ["tail"]})).is_ok());
        let src = include_str!("http.rs");
        assert!(src.contains("parse_rollback_diff_ids"));
        let parse_at = src
            .find("let diff_ids = match parse_rollback_diff_ids(&body)")
            .expect("parser call");
        let call_at = src
            .find(
                "rollback_foreign_integrations(&state.runtime, diff_ids, acting_agent(&identity))",
            )
            .expect("rollback call");
        assert!(parse_at < call_at);
    }

    #[test]
    fn mcp_route_is_behind_require_auth() {
        let src = include_str!("http.rs");
        assert!(src.contains("/ucb/v1/mcp"));
        assert!(src.contains("mcp_handler"));
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("http.rs");
        let handler = aep_source_check::RustSource::read(&path)
            .and_then(|s| s.function("mcp_handler"))
            .expect("mcp_handler");
        assert!(handler.contains("require_auth"));
        let ops = capabilities_document()
            .get("operations")
            .and_then(|o| o.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(ops.iter().any(|x| x.as_str() == Some("mcp")));
    }

    #[test]
    fn mcp_tool_scope_uses_mutating_scopes() {
        assert_eq!(
            mcp_tool_scope(&serde_json::json!({"method": "tools/list"})),
            Scope::Ingest
        );
        assert_eq!(
            mcp_tool_scope(
                &serde_json::json!({"method": "tools/call", "params": {"name": "ucb_rollback"}})
            ),
            Scope::Rollback
        );
        assert_eq!(
            mcp_tool_scope(
                &serde_json::json!({"method": "tools/call", "params": {"name": "ucb_delegate"}})
            ),
            Scope::Delegate
        );
        assert_eq!(
            mcp_tool_scope(
                &serde_json::json!({"method": "tools/call", "params": {"name": "ucb_ingest"}})
            ),
            Scope::Ingest
        );
    }

    fn fixture_config(dir: &std::path::Path) -> crate::config::UcbConfig {
        crate::config::UcbConfig {
            listen_host: String::from("127.0.0.1"),
            listen_port: 8412,
            data_dir: dir.to_path_buf(),
            manifest_dir: dir.join("manifests"),
            api_key: Some(String::from("k")),
            strict_egress: true,
            socket_base: dir.join("sockets"),
            predicate_profile: aep_ucb_perimeter_v1::PredicateProfile::PerimeterV1,
            wire_limits: WireLimits::default(),
            manifest_strict: true,
        }
    }

    fn write_agent_key(dir: &std::path::Path, agent_id: &str, secret: &str, scopes: &[&str]) {
        let rec = serde_json::json!({
            "agents": [{
                "agent_id": agent_id,
                "key_id": "k-agent",
                "key_hash": aep_ucb_perimeter_v1::AuthRegistry::hash_key(secret),
                "scopes": scopes,
            }]
        });
        std::fs::write(dir.join("ucb-agent-keys.json"), rec.to_string()).unwrap();
    }

    async fn post_json(app: &Router, uri: &str, key: &str, body: Value) -> (StatusCode, Value) {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(uri)
                    .header("content-type", "application/json")
                    .header("x-ucb-api-key", key)
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    /// UCB 01: a key of agent A is refused for agent B on every agent route.
    #[tokio::test]
    async fn agent_key_is_refused_for_another_agent() {
        let dir = tempfile::tempdir().unwrap();
        write_agent_key(
            dir.path(),
            "agent-a",
            "secret-a",
            &["ingest", "egress", "delegate"],
        );
        let runtime = Arc::new(crate::bridge::UcbRuntime::new(fixture_config(dir.path())).unwrap());
        let (auth, _) = crate::auth::bootstrap_auth(dir.path(), Some("operator-k"));
        let app = build_router(AppState {
            runtime,
            auth,
            base_path: String::new(),
        });
        let ingest = serde_json::json!({
            "agent_id": "agent-b",
            "payload": {"subject": "a", "predicate": "b", "object": "c"}
        });
        let (status, _) = post_json(&app, "/ucb/v1/ingest", "secret-a", ingest).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "ingest for another agent");
        let egress = serde_json::json!({"agent_id": "agent-b", "method": "GET", "path": "/x"});
        let (status, _) = post_json(&app, "/ucb/v1/egress", "secret-a", egress).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "egress for another agent");
        let delegate = serde_json::json!({"agent_id": "agent-b", "prompt": "hi"});
        let (status, _) = post_json(&app, "/ucb/v1/delegate", "secret-a", delegate).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "delegate for another agent");
        let mcp = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "ucb_ingest", "arguments": {
                "agent_id": "agent-b",
                "payload": {"subject": "a", "predicate": "b", "object": "c"}
            }}
        });
        let (status, _) = post_json(&app, "/ucb/v1/mcp", "secret-a", mcp).await;
        assert_eq!(
            status,
            StatusCode::FORBIDDEN,
            "MCP ingest for another agent"
        );
        // The key acts for its own agent, named or not, and the operator for any agent.
        let own = serde_json::json!({
            "agent_id": "agent-a",
            "payload": {"subject": "a", "predicate": "b", "object": "c"}
        });
        let (status, _) = post_json(&app, "/ucb/v1/ingest", "secret-a", own).await;
        assert_ne!(status, StatusCode::FORBIDDEN, "ingest for its own agent");
        let unnamed =
            serde_json::json!({"payload": {"subject": "a", "predicate": "b", "object": "c"}});
        let (status, _) = post_json(&app, "/ucb/v1/ingest", "secret-a", unnamed).await;
        assert_ne!(status, StatusCode::FORBIDDEN, "ingest that names no agent");
        let any = serde_json::json!({"agent_id": "agent-b", "method": "GET", "path": "/x"});
        let (status, _) = post_json(&app, "/ucb/v1/egress", "operator-k", any).await;
        assert_ne!(
            status,
            StatusCode::FORBIDDEN,
            "operator egress for any agent"
        );
    }

    /// UCB 06: health answers from memory and starts no process and no dock frame.
    #[tokio::test]
    async fn health_answers_from_memory() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let mut rt = crate::bridge::UcbRuntime::new(fixture_config(dir.path())).unwrap();
        rt.lattice.socket_base = dir.path().join("sockets");
        rt.lattice.lattice_log_bin = crate::test_support::recording_lattice_log(dir.path());
        let rt = Arc::new(rt);
        let (auth, _) = crate::auth::bootstrap_auth(dir.path(), Some("k"));
        let app = build_router(AppState {
            runtime: Arc::clone(&rt),
            auth,
            base_path: String::new(),
        });
        for uri in ["/health", "/ucb/v1/health"] {
            let res = app
                .clone()
                .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(res.status(), StatusCode::OK);
        }
        assert!(
            crate::test_support::lattice_calls(dir.path()).is_empty(),
            "a health request must not start aep-lattice-log"
        );
        assert_eq!(rt.health_snapshot()["lattice"]["error"], "not probed yet");
        // One refresh pings once and the next request reads its result from memory.
        let dock = crate::test_support::allowing_dock(&dir.path().join("sockets/validation"));
        rt.refresh_health().await;
        dock.abort();
        assert_eq!(crate::test_support::lattice_calls(dir.path()).len(), 1);
        assert_eq!(rt.health_snapshot()["lattice"]["ok"], true);
        assert_eq!(rt.health_snapshot()["lattice"]["event_id"], 7);
        let res = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        assert_eq!(crate::test_support::lattice_calls(dir.path()).len(), 1);
    }

    #[tokio::test]
    async fn mcp_http_requires_auth_and_refuses_malformed_args() {
        use axum::body::Body;
        use axum::http::Request;
        use tower::ServiceExt;
        let dir = tempfile::tempdir().unwrap();
        let config = crate::config::UcbConfig {
            listen_host: String::from("127.0.0.1"),
            listen_port: 8412,
            data_dir: dir.path().to_path_buf(),
            manifest_dir: dir.path().join("manifests"),
            api_key: Some(String::from("k")),
            strict_egress: true,
            socket_base: dir.path().join("sockets"),
            predicate_profile: aep_ucb_perimeter_v1::PredicateProfile::PerimeterV1,
            wire_limits: WireLimits::default(),
            manifest_strict: true,
        };

        let runtime = std::sync::Arc::new(crate::bridge::UcbRuntime::new(config).unwrap());
        let (auth, _) = crate::auth::bootstrap_auth(dir.path(), Some("k"));
        let app = build_router(AppState {
            runtime,
            auth,
            base_path: String::new(),
        });
        let unauth = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/ucb/v1/mcp")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

        let listed = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/ucb/v1/mcp")
                    .header("content-type", "application/json")
                    .header("x-ucb-api-key", "k")
                    .body(Body::from(
                        "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}",
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        let bad = app.oneshot(
            Request::builder().method("POST").uri("/ucb/v1/mcp").header("content-type", "application/json").header("x-ucb-api-key", "k").body(Body::from("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"ucb_ingest\",\"arguments\":\"bad\"}}")).unwrap(),
        ).await.unwrap();
        assert_eq!(bad.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(bad.into_body(), 65536).await.unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            v.get("error").and_then(|e| e.get("code")),
            Some(&Value::from(-32602))
        );
    }
}
