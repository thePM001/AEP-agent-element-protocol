// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Public UCB HTTP: ingest, delegate, health, rollback and egress.

use crate::auth::{extract_bearer_or_header, AuthGuard};
use crate::bridge::{ingest_foreign_payload, rollback_foreign_integrations, UcbRuntime};
use crate::mcp::{handle_mcp_request, mcp_capabilities, parse_rollback_diff_ids};
use crate::delegate::{delegate_to_foreign_model, DelegateBody};
use crate::egress::{
    audit_host, auth_token_env_denied, credential_inject_allowed, match_route, proxy_request_isolated,
    strip_caller_headers, EgressAudit, EgressConfig,
};
use crate::gap_manifest::{compile_provided, compile_provided_json, LOCAL_PROFILE};
use crate::ingress::ForeignIngestBody;
use crate::manifest::{egress_refused_unsigned, signed_from_task};
use crate::store::TaskManifestV1;
use crate::{BRIDGE_ID, UCB_VERSION};
use aep_ucb_perimeter_v1::{egress_power_allowed, Scope, StrictMode, WireLimits};
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

async fn health_handler(State(state): State<AppState>) -> Json<Value> {
    let full = health_snapshot(&state.runtime).await;
    Json(obj(vec![
        ("service", full.get("service").cloned().unwrap_or(Value::String(String::from("ucb-universal-connect-bridge")))),
        ("version", full.get("version").cloned().unwrap_or(Value::String(String::from(UCB_VERSION)))),
        ("status", full.get("status").cloned().unwrap_or(Value::String(String::from("unknown")))),
    ]))
}

pub async fn health_snapshot(rt: &Arc<UcbRuntime>) -> Value {
    let docks = rt.lattice.dock_status();
    let listening = docks.iter().filter(|d| d.get("listening").and_then(|v| v.as_bool()) == Some(true)).count();
    let lattice = match rt.lattice.health_ping().await {
        Ok(ping) => obj(vec![
            ("ok", Value::Bool(true)),
            ("digest", ping.digest.map(Value::String).unwrap_or(Value::Null)),
            ("event_id", ping.event_id.map(Value::from).unwrap_or(Value::Null)),
        ]),
        Err(e) => obj(vec![("ok", Value::Bool(false)), ("error", Value::String(e))]),
    };
    let status = if listening >= 4 && lattice.get("ok") == Some(&Value::Bool(true)) {
        "ok"
    } else {
        "degraded"
    };
    obj(vec![
        ("service", Value::String(String::from("ucb-universal-connect-bridge"))),
        ("version", Value::String(String::from(UCB_VERSION))),
        ("status", Value::String(String::from(status))),
        ("implementation", Value::String(String::from("rust"))),
        ("lattice", lattice),
        ("docking_ports", Value::Array(docks)),
        ("docking_ports_listening", Value::Bool(listening >= 4)),
        ("capabilities", Value::Array(vec![
            Value::String(String::from("ingest")),
            Value::String(String::from("delegate")),
            Value::String(String::from("health")),
            Value::String(String::from("rollback")),
            Value::String(String::from("egress")),
            Value::String(String::from("compile-manifest")),
            Value::String(String::from("mcp")),
        ])),
        ("synthesis", Value::Bool(false)),
        ("trust_fields", Value::Bool(false)),
        ("gap_engine", Value::String(String::from(LOCAL_PROFILE))),
        ("predicate_profile", Value::String(String::from("perimeter-v1"))),
    ])
}

pub fn capabilities_document() -> Value {
    obj(vec![
        ("bridge", Value::String(String::from(BRIDGE_ID))),
        ("perimeter", Value::String(String::from("attach-gateway"))),
        ("implementation", Value::String(String::from("rust"))),
        ("evaluator", Value::String(String::from("base-node-only"))),
        ("operations", Value::Array(vec![
            Value::String(String::from("ingest")),
            Value::String(String::from("delegate")),
            Value::String(String::from("health")),
            Value::String(String::from("rollback")),
            Value::String(String::from("egress")),
            Value::String(String::from("compile-manifest")),
            Value::String(String::from("mcp")),
        ])),
        ("mcp", mcp_capabilities()),
        ("foreign_frameworks", Value::String(String::from("fixtures not protocol members"))),
        ("task_manifest", obj(vec![
            ("required_for_ingest", Value::Bool(true)),
            ("synthesis", Value::Bool(false)),
            ("trust_fields", Value::Bool(false)),
            ("compiler", Value::String(String::from(LOCAL_PROFILE))),
        ])),
        ("deny_report", Value::String(String::from("kernel-shape"))),
        ("auth", obj(vec![
            ("schemes", Value::Array(vec![Value::String(String::from("Bearer")), Value::String(String::from("X-UCB-API-Key"))])),
            ("required_for", Value::Array(vec![
                Value::String(String::from("ingest")),
                Value::String(String::from("delegate")),
                Value::String(String::from("rollback")),
                Value::String(String::from("egress")),
                Value::String(String::from("compile-manifest")),
                Value::String(String::from("mcp")),
            ])),
            ("model", Value::String(String::from("per-agent-keys"))),
        ])),
    ])
}

async fn capabilities_handler() -> Json<Value> {
    Json(capabilities_document())
}

fn is_ok_true(v: &Value) -> bool {
    v.get("ok") == Some(&Value::Bool(true))
}

async fn delegate_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DelegateBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers, Scope::Delegate) {
        return resp;
    }
    let result = delegate_to_foreign_model(&state.runtime, body).await;
    let status = if is_ok_true(&result) { StatusCode::OK } else { StatusCode::UNPROCESSABLE_ENTITY };
    (status, Json(result)).into_response()
}

async fn ingest_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ForeignIngestBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers, Scope::Ingest) {
        return resp;
    }
    let result = ingest_foreign_payload(&state.runtime, body).await;
    let status = if is_ok_true(&result) { StatusCode::OK } else { StatusCode::UNPROCESSABLE_ENTITY };
    (status, Json(result)).into_response()
}

async fn rollback_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers, Scope::Rollback) {
        return resp;
    }
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
    let result = rollback_foreign_integrations(&state.runtime, diff_ids).await;
    let status = if is_ok_true(&result) { StatusCode::OK } else { StatusCode::UNPROCESSABLE_ENTITY };
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
    if let Some(resp) = require_auth(&state, &headers, Scope::Egress) {
        return resp;
    }
    let isolated = strip_caller_headers(&headers);
    let Some(manifest) = state.runtime.manifests.load(&body.agent_id) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![("ok", Value::Bool(false)), ("error", Value::String(String::from("task manifest missing")))])),
        )
            .into_response();
    };
    let signed = signed_from_task(&manifest);
    if egress_power_allowed(&signed, StrictMode::On).is_err() {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(crate::bridge::deny_to_value(egress_refused_unsigned())),
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
            Json(obj(vec![("ok", Value::Bool(false)), ("error", Value::String(String::from("no egress route")))])),
        )
            .into_response();
    };
    let inject = credential_inject_allowed(signed.signature.is_some(), signed.provisional);
    if auth_token_env_denied(inject, route.auth_token_env.as_deref()) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                ("error", Value::String(String::from("auth_token_env denied unless signed and non-provisional"))),
            ])),
        )
            .into_response();
    }
    let bytes = body.body.as_ref().map(|s| s.as_bytes().to_vec());
    let result = proxy_request_isolated(route, &body.method, &body.path, bytes, inject, Some(&isolated)).await;
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
            rec.insert(String::from("operation"), Value::String(String::from("egress_audit")));
            rec.insert(String::from("snapshot"), serde_json::to_value(&audit).unwrap_or(Value::Null));
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
                    ("content_type", resp.content_type.map(Value::String).unwrap_or(Value::Null)),
                    ("body_b64", Value::String(hex::encode(&resp.body))),
                ])),
            )
                .into_response()
        }
        Err(e) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(obj(vec![("ok", Value::Bool(false)), ("error", Value::String(e))])),
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
    if let Some(resp) = require_auth(&state, &headers, Scope::Ingest) {
        return resp;
    }
    let compiled: Result<TaskManifestV1, _> = if let Some(src) = body.source.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        compile_provided(src)
    } else if let Some(value) = body.task_manifest {
        compile_provided_json(value)
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(obj(vec![
                ("ok", Value::Bool(false)),
                ("error", Value::String(String::from("supply source GAP text or task_manifest JSON"))),
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
                ("task_manifest", serde_json::to_value(&m).unwrap_or(Value::Null)),
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

async fn mcp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers, mcp_tool_scope(&body)) {
        return resp;
    }
    let result = handle_mcp_request(&state.runtime, body).await;
    (StatusCode::OK, Json(result)).into_response()
}

fn require_auth(state: &AppState, headers: &HeaderMap, scope: Scope) -> Option<axum::response::Response> {
    let auth_hdr = headers.get(axum::http::header::AUTHORIZATION).and_then(|v| v.to_str().ok());
    let api_hdr = headers.get("x-ucb-api-key").and_then(|v| v.to_str().ok());
    let token = extract_bearer_or_header(auth_hdr, api_hdr);
    let Some(token) = token else {
        return Some((
            StatusCode::UNAUTHORIZED,
            Json(obj(vec![("ok", Value::Bool(false)), ("error", Value::String(String::from("UCB API key required (Authorization: Bearer or X-UCB-API-Key)")))])),
        ).into_response());
    };
    if state.auth.authorize(&token, scope).is_err() {
        return Some((
            StatusCode::FORBIDDEN,
            Json(obj(vec![("ok", Value::Bool(false)), ("error", Value::String(String::from("invalid UCB API key or scope")))])),
        ).into_response());
    }
    None
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
        let parse_at = src.find("let diff_ids = match parse_rollback_diff_ids(&body)").expect("parser call");
        let call_at = src
            .find("rollback_foreign_integrations(&state.runtime, diff_ids)")
            .expect("rollback call");
        assert!(parse_at < call_at);
    }

    #[test]
    fn mcp_route_is_behind_require_auth() {
        let src = include_str!("http.rs");
        assert!(src.contains("/ucb/v1/mcp"));
        assert!(src.contains("mcp_handler"));
        let start = src.find("async fn mcp_handler").expect("mcp_handler");
        let chunk = &src[start..start + 500];
        assert!(chunk.contains("require_auth"));
        let ops = capabilities_document()
            .get("operations")
            .and_then(|o| o.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(ops.iter().any(|x| x.as_str() == Some("mcp")));
    }

    #[test]
    fn mcp_tool_scope_uses_mutating_scopes() {
        assert_eq!(mcp_tool_scope(&serde_json::json!({"method": "tools/list"})), Scope::Ingest);
        assert_eq!(mcp_tool_scope(&serde_json::json!({"method": "tools/call", "params": {"name": "ucb_rollback"}})), Scope::Rollback);
        assert_eq!(mcp_tool_scope(&serde_json::json!({"method": "tools/call", "params": {"name": "ucb_delegate"}})), Scope::Delegate);
        assert_eq!(mcp_tool_scope(&serde_json::json!({"method": "tools/call", "params": {"name": "ucb_ingest"}})), Scope::Ingest);
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
        let app = build_router(AppState { runtime, auth, base_path: String::new() });
        let unauth = app.clone().oneshot(
            Request::builder().method("POST").uri("/ucb/v1/mcp").header("content-type", "application/json").body(Body::from("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}")).unwrap(),
        ).await.unwrap();
        assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

        let listed = app.clone().oneshot(
            Request::builder().method("POST").uri("/ucb/v1/mcp").header("content-type", "application/json").header("x-ucb-api-key", "k").body(Body::from("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}")).unwrap(),
        ).await.unwrap();
        assert_eq!(listed.status(), StatusCode::OK);
        let bad = app.oneshot(
            Request::builder().method("POST").uri("/ucb/v1/mcp").header("content-type", "application/json").header("x-ucb-api-key", "k").body(Body::from("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"ucb_ingest\",\"arguments\":\"bad\"}}")).unwrap(),
        ).await.unwrap();
        assert_eq!(bad.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(bad.into_body(), 65536).await.unwrap();
        let v: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v.get("error").and_then(|e| e.get("code")), Some(&Value::from(-32602)));
    }

}
