//! Loopback HTTP API. POST endpoints need UCM_API_KEY when the operator sets one.

use crate::engine::{ApiError, ApiResult, Engine};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value as J};
use std::sync::Arc;
use tokio::sync::Semaphore;

pub const BODY_LIMIT: usize = 1 << 20;

#[derive(Clone)]
pub struct AppState {
    pub engine: Arc<Engine>,
    pub gate: Arc<Semaphore>,
}

fn respond(r: ApiResult) -> Response {
    match r {
        Ok(v) => (StatusCode::OK, Json(v)).into_response(),
        Err(e) => (
            StatusCode::from_u16(e.status).unwrap_or(StatusCode::BAD_REQUEST),
            Json(e.to_json()),
        )
            .into_response(),
    }
}

/// Constant time comparison so the key check does not leak the key length or prefix by timing.
fn same(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= (*a.get(i).unwrap_or(&0) ^ *b.get(i).unwrap_or(&0)) as usize;
    }
    diff == 0
}

fn authorized(st: &AppState, h: &HeaderMap) -> Result<(), ApiError> {
    let Some(want) = &st.engine.cfg.api_key else {
        return Ok(());
    };
    let given = h
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| h.get("x-ucm-api-key").and_then(|v| v.to_str().ok()))
        .unwrap_or("");
    if same(given.as_bytes(), want.as_bytes()) {
        Ok(())
    } else {
        Err(ApiError::new(
            "unauthorized",
            "missing or wrong UCM API key",
            401,
        ))
    }
}

fn parse(body: &Bytes) -> Result<J, ApiError> {
    let v: J = serde_json::from_slice(body)
        .map_err(|e| ApiError::bad("form_error", format!("body is not JSON: {e}")))?;
    if !v.is_object() {
        return Err(ApiError::bad("form_error", "body must be a JSON object"));
    }
    Ok(v)
}

async fn run_blocking(st: &AppState, req: J, f: fn(&Engine, &J) -> ApiResult) -> ApiResult {
    let _permit = st
        .gate
        .acquire()
        .await
        .map_err(|_| ApiError::new("busy", "service is shutting down", 503))?;
    let e = st.engine.clone();
    tokio::task::spawn_blocking(move || f(&e, &req))
        .await
        .unwrap_or_else(|_| Err(ApiError::new("internal", "evaluation thread failed", 500)))
}

async fn health(State(st): State<AppState>) -> Json<J> {
    Json(
        json!({ "ok": true, "service": "aep-ucm", "engine_build": aep_ucm_core::engine_build(), "node_id": st.engine.key.node_id }),
    )
}

async fn capabilities(State(st): State<AppState>) -> Json<J> {
    Json(st.engine.capabilities())
}

async fn catalog(State(st): State<AppState>) -> Json<J> {
    Json(st.engine.catalog())
}

async fn receipt(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    respond(st.engine.receipt(&id))
}

macro_rules! post_blocking {
    ($name:ident, $f:path) => {
        async fn $name(State(st): State<AppState>, h: HeaderMap, body: Bytes) -> Response {
            if let Err(e) = authorized(&st, &h) {
                return respond(Err(e));
            }
            match parse(&body) {
                Ok(req) => respond(run_blocking(&st, req, $f).await),
                Err(e) => respond(Err(e)),
            }
        }
    };
}

post_blocking!(evaluate, Engine::evaluate);
post_blocking!(verify, Engine::verify);
post_blocking!(explain, Engine::explain);

async fn lookup(State(st): State<AppState>, h: HeaderMap, body: Bytes) -> Response {
    if let Err(e) = authorized(&st, &h) {
        return respond(Err(e));
    }
    match parse(&body) {
        Ok(req) => respond(st.engine.lookup(&req).await),
        Err(e) => respond(Err(e)),
    }
}

async fn mcp(State(st): State<AppState>, h: HeaderMap, body: Bytes) -> Response {
    if let Err(e) = authorized(&st, &h) {
        return respond(Err(e));
    }
    let msg: J = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::OK,
                Json(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } })),
            )
                .into_response()
        }
    };
    let _permit = match st.gate.acquire().await {
        Ok(p) => p,
        Err(_) => return respond(Err(ApiError::new("busy", "service is shutting down", 503))),
    };
    match crate::mcp::handle(&st.engine, &msg).await {
        Some(a) => (StatusCode::OK, Json(a)).into_response(),
        None => StatusCode::ACCEPTED.into_response(),
    }
}

pub fn router(engine: Arc<Engine>) -> Router {
    let gate = Arc::new(Semaphore::new(engine.cfg.max_concurrent.max(1)));
    let st = AppState { engine, gate };
    Router::new()
        .route("/health", get(health))
        .route("/ucm/v1/health", get(health))
        .route("/ucm/v1/capabilities", get(capabilities))
        .route("/ucm/v1/catalog", get(catalog))
        .route("/ucm/v1/receipts/:id", get(receipt))
        .route("/ucm/v1/lookup", post(lookup))
        .route("/ucm/v1/eval", post(evaluate))
        .route("/ucm/v1/verify", post(verify))
        .route("/ucm/v1/explain", post(explain))
        .route("/ucm/v1/mcp", post(mcp))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(st)
}
