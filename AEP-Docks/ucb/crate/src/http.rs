//! Axum HTTP server for UCB ingress, egress, and MCP.

use crate::auth::{extract_bearer_or_header, AuthGuard};
use crate::bridge::{ingest_foreign_payload, rollback_foreign_integrations, UcbRuntime};
use crate::delegate::{delegate_to_foreign_model, DelegateBody};
use crate::egress::{match_route, proxy_request, EgressConfig};
use crate::ingress::ForeignIngestBody;
use crate::mcp::{handle_mcp_request, mcp_capabilities};

use crate::{BRIDGE_ID, UCB_VERSION};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::trace::TraceLayer;

#[derive(Clone)]
pub struct AppState {
    pub runtime: Arc<UcbRuntime>,
    pub auth: AuthGuard,
    pub base_path: String,
}

pub fn build_router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health_handler))
        .route("/ucb/v1/health", get(health_handler))
        .route("/ucb/v1/capabilities", get(capabilities_handler))
        .route("/ucb/v1/ingest", post(ingest_handler))
        .route("/ucb/v1/delegate", post(delegate_handler))
        .route("/ucb/v1/rollback", post(rollback_handler))
        .route("/ucb/v1/diff", get(diff_handler))
        .route("/ucb/v1/manifests/:agent_id", get(manifest_get_handler))
        .route("/ucb/v1/egress/*path", post(egress_proxy_handler).get(egress_proxy_handler))
        .route("/mcp", post(mcp_handler))
        .with_state(state.clone());

    if state.base_path.is_empty() {
        api.layer(TraceLayer::new_for_http())
    } else {
        Router::new()
            .nest(&state.base_path, api)
            .layer(TraceLayer::new_for_http())
    }
}

async fn health_handler(State(state): State<AppState>) -> Json<Value> {
    Json(health_snapshot(&state.runtime).await)
}

pub async fn health_snapshot(rt: &Arc<UcbRuntime>) -> Value {
    let docks = rt.lattice.dock_status();
    let listening = docks.iter().filter(|d| d.get("listening").and_then(|v| v.as_bool()) == Some(true)).count();
    let lattice = match rt.lattice.health_ping().await {
        Ok(ping) => json!({ "ok": true, "digest": ping.digest, "event_id": ping.event_id }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    let status = if listening >= 4 && lattice.get("ok") == Some(&json!(true)) {
        "ok"
    } else {
        "degraded"
    };
    json!({
        "service": "ucb-universal-connect-bridge",
        "version": UCB_VERSION,
        "status": status,
        "port_policy": "NLA-84xx",
        "implementation": "rust",
        "lattice": lattice,
        "docking_ports": docks,
        "docking_ports_listening": listening >= 4,
        "manifest_synthesis": {
            "optional": true,
            "configured": rt.config.has_synthesis_tier(),
            "gap_engine": rt.config.gap_engine_url.is_some(),
            "constrained_decoder": rt.config.constrained_decoder_url.is_some(),
            "llm_synthesis": rt.config.llm_synthesis_url.is_some(),
            "tiers": ["provided", "gap_constrained", "constrained_decoder", "llm_structured"],
        },
        "egress_strict": rt.config.strict_egress,
    })
}

async fn capabilities_handler() -> Json<Value> {
    Json(json!({
        "bridge": BRIDGE_ID,
        "paper": "NLA Research Paper 005",
        "perimeter": "secured-dock",
        "implementation": "rust",
        "transports": ["http", "mcp-json-rpc"],
        "docks": ["validation_engine", "inference_engine", "regulation_module", "future_features", "pera"],
        "operations": ["ingest", "delegate", "rollback", "egress"],
        "supported_protocols": [
            "langgraph", "langchain", "autogen", "crewai", "mcp",
            "cursor", "claude-code", "codex", "custom", "http"
        ],
        "mcp": mcp_capabilities(),
        "auth": {
            "schemes": ["Bearer", "X-UCB-API-Key"],
            "required_for": ["ingest", "delegate", "rollback", "diff", "mcp", "egress"],
        },
        "task_manifest": {
            "version": "1",
            "required_for_ingest": true,
            "sources": {
                "provided": "Caller supplies task_manifest on ingest body (recommended for foreign stacks)",
                "stored": "Previously saved non-provisional manifest for agent_id",
                "synthesis_tiers": "Optional HTTP tiers; all unset means no auto-synthesis",
            },
            "synthesis_tiers": {
                "1_gap_constrained": "GAP constrained decoding (UCB_GAP_ENGINE_URL) - NLA internal or licensed customers",
                "2_constrained_decoder": "Other constrained decoders e.g. dottxt (UCB_CONSTRAINED_DECODER_URL)",
                "3_llm_structured": "LLM structured output (UCB_LLM_SYNTHESIS_URL)",
            },
        },
    }))
}

async fn delegate_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DelegateBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let result = delegate_to_foreign_model(&state.runtime, body).await;
    let status = if result.get("ok") == Some(&json!(true)) {
        StatusCode::OK
    } else {
        StatusCode::BAD_GATEWAY
    };
    (status, Json(result)).into_response()
}

async fn ingest_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ForeignIngestBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let result = ingest_foreign_payload(&state.runtime, body).await;
    let status = if result.get("ok") == Some(&json!(true)) {
        StatusCode::OK
    } else {
        StatusCode::UNPROCESSABLE_ENTITY
    };
    (status, Json(result)).into_response()
}

#[derive(Debug, Deserialize)]
struct RollbackBody {
    steps: Option<serde_json::Value>,
}

async fn rollback_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RollbackBody>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let steps = match &body.steps {
        Some(Value::Number(n)) if n.is_i64() => n.as_i64().unwrap_or(1),
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "ok": false,
                    "error": "steps must be an integer between 1 and 100",
                })),
            )
                .into_response();
        }
    };
    if steps < 1 || steps > 100 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": "steps must be an integer between 1 and 100",
            })),
        )
            .into_response();
    }
    let result = rollback_foreign_integrations(&state.runtime, steps as usize).await;
    let status = if result.get("ok") == Some(&json!(true)) {
        StatusCode::OK
    } else {
        StatusCode::NOT_FOUND
    };
    (status, Json(result)).into_response()
}

#[derive(Debug, Deserialize)]
struct DiffQuery {
    limit: Option<usize>,
}

async fn diff_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DiffQuery>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let limit = q.limit.unwrap_or(20);
    let diffs = state.runtime.journal.list(limit);
    (StatusCode::OK, Json(json!({ "ok": true, "diffs": diffs }))).into_response()
}

async fn manifest_get_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    match state.runtime.manifests.load(&agent_id) {
        Some(m) => (StatusCode::OK, Json(json!({ "ok": true, "manifest": m }))).into_response(),
        None => (
            StatusCode::NOT_FOUND,
            Json(json!({ "ok": false, "error": "manifest not found" })),
        )
            .into_response(),
    }
}

async fn egress_proxy_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    method: axum::http::Method,
    body: Option<Bytes>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let agent_id = headers
        .get("x-aep-agent-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("ucb-egress");
    let manifest = state.runtime.manifests.load(agent_id);
    let egress_val = manifest
        .as_ref()
        .and_then(|m| m.egress.clone())
        .unwrap_or(json!({ "routes": [] }));
    let cfg = EgressConfig::from_manifest_egress(&egress_val, state.runtime.config.strict_egress);
    if cfg.routes.is_empty() && state.runtime.config.strict_egress {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "no egress routes in task manifest" })),
        )
            .into_response();
    }
    let full_path = format!("/{}", path.trim_start_matches('/'));
    let route = match match_route(&cfg, &full_path) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "ok": false, "error": "no matching egress route" })),
            )
                .into_response();
        }
    };
    match proxy_request(
        route,
        method.as_str(),
        &full_path,
        body.map(|b| b.to_vec()),
    )
    .await
    {
        Ok(proxy) => proxy_into_response(proxy),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "ok": false, "error": e })),
        )
            .into_response(),
    }
}

fn proxy_into_response(proxy: crate::egress::ProxyResponse) -> Response {
    let status = StatusCode::from_u16(proxy.status).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = proxy
        .content_type
        .as_deref()
        .unwrap_or("application/octet-stream");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(axum::body::Body::from(proxy.body))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "ok": false, "error": "egress response build failed" })),
            )
                .into_response()
        })
}

async fn mcp_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    if let Some(resp) = require_auth(&state, &headers) {
        return resp;
    }
    let response = handle_mcp_request(&state.runtime, body).await;
    (StatusCode::OK, Json(response)).into_response()
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Option<axum::response::Response> {
    let auth_hdr = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());
    let api_hdr = headers.get("x-ucb-api-key").and_then(|v| v.to_str().ok());
    let token = extract_bearer_or_header(auth_hdr, api_hdr);
    let Some(token) = token else {
        return Some(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "ok": false,
                    "error": "UCB API key required (Authorization: Bearer or X-UCB-API-Key)",
                })),
            )
                .into_response(),
        );
    };
    if !state.auth.verify(&token) {
        return Some(
            (
                StatusCode::FORBIDDEN,
                Json(json!({ "ok": false, "error": "invalid UCB API key" })),
            )
                .into_response(),
        );
    }
    None
}