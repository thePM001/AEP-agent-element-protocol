//! HTTP and MCP tests against the real router, without a network listener.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "integration test crate: a failed unwrap here is a failed test"
)]

use aep_ucm::engine::{Config, Engine};
use aep_ucm::http::router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

fn engine(tag: &str, key: Option<&str>) -> Arc<Engine> {
    let dir = std::env::temp_dir().join(format!("ucm-http-test-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut cfg = Config::from_env();
    cfg.data_dir = dir;
    cfg.api_key = key.map(|k| k.to_string());
    cfg.ranker_url = None;
    cfg.lattice_record = false;
    Engine::open(cfg).expect("engine")
}

async fn call(
    e: &Arc<Engine>,
    method: &str,
    path: &str,
    key: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if let Some(k) = key {
        b = b.header("authorization", format!("Bearer {k}"));
    }
    let req = b
        .body(Body::from(body.map(|v| v.to_string()).unwrap_or_default()))
        .expect("request");
    let resp = router(e.clone()).oneshot(req).await.expect("response");
    let status = resp.status();
    let bytes = resp.into_body().collect().await.expect("body").to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn eval_verify_and_auth() {
    let e = engine("auth", Some("test-key"));
    let (s, _) = call(&e, "GET", "/health", None, None).await;
    assert_eq!(s, StatusCode::OK);

    let body = json!({ "program": "input p: money[CHF];\nround(p * 1.081, 2, \"half_even\")", "inputs": { "p": "10.00 CHF" } });
    let (s, v) = call(&e, "POST", "/ucm/v1/eval", None, Some(body.clone())).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "{v}");
    let (s, _) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        Some("wrong"),
        Some(body.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    let (s, v) = call(&e, "POST", "/ucm/v1/eval", Some("test-key"), Some(body)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["result"]["decimal"], "10.81");
    let id = v["receipt_id"].as_str().expect("id").to_string();

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/verify",
        Some("test-key"),
        Some(json!({ "receipt": id, "mode": "replay" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["trusted"], "true");

    let (s, r) = call(&e, "GET", &format!("/ucm/v1/receipts/{id}"), None, None).await;
    assert_eq!(s, StatusCode::OK);
    let mut forged = r.clone();
    forged["result"]["decimal"] = json!("11.00");
    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/verify",
        Some("test-key"),
        Some(json!({ "receipt": forged })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");

    let (s, _) = call(
        &e,
        "GET",
        "/ucm/v1/receipts/..%2F..%2Fetc%2Fpasswd",
        None,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn limits_and_errors() {
    let e = engine("limits", None);
    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        None,
        Some(json!({ "program": "1", "budget": { "steps": "999999999" } })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"]["code"], "input_error");

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        None,
        Some(json!({ "program": "len(range(0, 50))", "budget": { "len": "10" } })),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"]["code"], "budget_exceeded");

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        None,
        Some(json!({ "program": "1 + 1", "library_formula": "finance.npv" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"]["code"], "library_mismatch");

    let big = "1 + ".repeat(300_000) + "1";
    let (s, _) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        None,
        Some(json!({ "program": big })),
    )
    .await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/eval",
        None,
        Some(json!({ "program": "1 +" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"]["code"], "parse_error");
}

#[tokio::test]
async fn library_program_source() {
    let e = engine("library", None);
    let f = e
        .lib
        .formula("finance.compound_amount")
        .expect("formula")
        .program_text
        .clone();
    let (s, v) = call(&e, "POST", "/ucm/v1/eval", None, Some(json!({ "program": f, "library_formula": "finance.compound_amount", "inputs": { "principal": "1000 EUR", "rate": "5/100", "periods": "2" } }))).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["receipt"]["program_source"], "library");
    assert_eq!(v["result"]["decimal"], "1102.5");
}

#[tokio::test]
async fn lookup_and_mcp() {
    let e = engine("mcp", None);
    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/lookup",
        None,
        Some(json!({ "query": "monthly loan payment", "k": "3" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["tier"], "tier1");
    assert!(v["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .any(|x| x["entry"]["id"] == "formula.finance.annuity_payment"));

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/lookup",
        None,
        Some(json!({ "query": "x", "tier": "2" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(v["error"]["code"], "ranker_off");

    let (s, v) = call(
        &e,
        "POST",
        "/ucm/v1/mcp",
        None,
        Some(json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["result"]["tools"].as_array().expect("tools").len(), 4);

    let call_eval = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "ucm_eval", "arguments": { "program": "1/0" } } });
    let (_, v) = call(&e, "POST", "/ucm/v1/mcp", None, Some(call_eval)).await;
    assert_eq!(v["result"]["isError"], true);

    let (s, _) = call(
        &e,
        "POST",
        "/ucm/v1/mcp",
        None,
        Some(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })),
    )
    .await;
    assert_eq!(s, StatusCode::ACCEPTED);
}
