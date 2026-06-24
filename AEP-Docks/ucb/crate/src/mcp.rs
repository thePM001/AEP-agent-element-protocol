//! MCP JSON-RPC adapter for UCB tools.

use crate::bridge::{ingest_foreign_payload, rollback_foreign_integrations, UcbRuntime};
use crate::delegate::{delegate_to_foreign_model, DelegateBody};
use crate::ingress::ForeignIngestBody;
use crate::http::health_snapshot;
use serde_json::{json, Value};
use std::sync::Arc;

pub fn mcp_capabilities() -> Value {
    json!({
        "protocol": "mcp/1.0",
        "bridge": crate::BRIDGE_ID,
        "transport": "http+json-rpc",
        "tools": ["ucb_ingest", "ucb_delegate", "ucb_rollback", "ucb_health"],
    })
}

pub async fn handle_mcp_request(rt: &Arc<UcbRuntime>, body: Value) -> Value {
    let id = body.get("id").cloned();
    let method = body.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = body.get("params").cloned().unwrap_or(json!({}));

    match method {
        "initialize" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": { "name": "ucb-universal-connect-bridge", "version": crate::UCB_VERSION },
                    "capabilities": { "tools": {} },
                }
            })
        }
        "tools/list" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": tool_defs() },
            })
        }
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            let result = match name {
                "ucb_ingest" => {
                    let body: ForeignIngestBody = serde_json::from_value(args).unwrap_or_default();
                    ingest_foreign_payload(rt, body).await
                }
                "ucb_rollback" => {
                    let steps = args.get("steps").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
                    rollback_foreign_integrations(rt, steps).await
                }
                "ucb_health" => health_snapshot(rt).await,
                "ucb_delegate" => {
                    let body: DelegateBody = serde_json::from_value(args).unwrap_or_default();
                    delegate_to_foreign_model(rt, body).await
                }
                _ => {
                    return json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": format!("unknown tool: {name}") },
                    });
                }
            };
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": serde_json::to_string_pretty(&result).unwrap_or_default() }],
                    "structuredContent": result,
                }
            })
        }
        _ => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32601, "message": format!("unsupported method: {method}") },
        }),
    }
}

fn tool_defs() -> Vec<Value> {
    vec![
        json!({
            "name": "ucb_ingest",
            "description": "Ingest structured output from a non-AEP agent stack through UCB validation into the AEP action lattice.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "protocol": { "type": "string" },
                    "session_id": { "type": "string" },
                    "payload": { "type": "object" },
                    "provenance": { "type": "object" },
                },
                "required": ["protocol", "payload"],
            }
        }),
        json!({
            "name": "ucb_rollback",
            "description": "Rollback the last N UCB Extend-Write integrations.",
            "inputSchema": {
                "type": "object",
                "properties": { "steps": { "type": "integer", "minimum": 1 } },
            }
        }),
        json!({
            "name": "ucb_health",
            "description": "UCB and lattice dock health snapshot.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
    ]
}