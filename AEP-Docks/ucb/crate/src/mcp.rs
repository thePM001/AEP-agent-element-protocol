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
        "tools": ["ucb_ingest", "ucb_delegate", "ucb_rollback", "ucb_health", "ucb_compile_manifest"],
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
            let args_required = matches!(name, "ucb_ingest" | "ucb_delegate" | "ucb_rollback");
            let args = match parse_tool_args(&params, args_required) {
                Ok(v) => v,
                Err(message) => {
                    return json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32602, "message": message },
                    });
                }
            };
            let result = match name {
                "ucb_ingest" => {
                    let body: ForeignIngestBody = match serde_json::from_value(args) {
                        Ok(b) => b,
                        Err(e) => {
                            return json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32602,
                                    "message": format!("malformed arguments for ucb_ingest: {e}"),
                                },
                            });
                        }
                    };
                    ingest_foreign_payload(rt, body).await
                }
                "ucb_rollback" => {
                    let diff_ids = match parse_rollback_diff_ids(&args) {
                        Ok(ids) => ids,
                        Err(message) => {
                            return json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32602,
                                    "message": message,
                                },
                            });
                        }
                    };
                    rollback_foreign_integrations(rt, diff_ids).await
                }
                "ucb_health" => health_snapshot(rt).await,
                "ucb_compile_manifest" => {
                    let src = args.get("source").and_then(|v| v.as_str());
                    let compiled = if let Some(s) = src {
                        crate::gap_manifest::compile_provided(s)
                    } else if let Some(v) = args.get("task_manifest").cloned() {
                        crate::gap_manifest::compile_provided_json(v)
                    } else {
                        Err(crate::manifest::manifest_missing())
                    };
                    match compiled {
                        Ok(m) => serde_json::to_value(&m).unwrap_or(json!({"ok": false})),
                        Err(report) => crate::bridge::deny_to_value(report),
                    }
                }
                "ucb_delegate" => {
                    let body: DelegateBody = match serde_json::from_value(args) {
                        Ok(b) => b,
                        Err(e) => {
                            return json!({
                                "jsonrpc": "2.0",
                                "id": id,
                                "error": {
                                    "code": -32602,
                                    "message": format!("malformed arguments for ucb_delegate: {e}"),
                                },
                            });
                        }
                    };
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

fn parse_tool_args(params: &Value, required: bool) -> Result<Value, String> {
    match params.get("arguments") {
        None => {
            if required {
                Err(String::from("tool arguments required"))
            } else {
                Ok(json!({}))
            }
        }
        Some(Value::Object(_)) => Ok(params.get("arguments").cloned().unwrap()),
        Some(_) => Err(String::from("tool arguments must be an object")),
    }
}

/// BM-04: shared validation with HTTP rollback (1..=100).
pub fn clamp_rollback_steps(raw: u64) -> Result<usize, ()> {
    if raw < 1 || raw > 100 {
        return Err(());
    }
    Ok(raw as usize)
}

pub fn parse_rollback_diff_ids(args: &Value) -> Result<Vec<String>, String> {
    let Some(raw) = args.get("diff_ids") else {
        return Err(String::from("diff_ids must name the tail record"));
    };
    let Some(arr) = raw.as_array() else {
        return Err(String::from("diff_ids must name the tail record"));
    };
    let mut ids = Vec::new();
    for item in arr {
        let Some(s) = item.as_str() else {
            return Err(String::from("diff_ids must be an array of strings"));
        };
        let t = s.trim();
        if t.is_empty() {
            return Err(String::from("diff_ids must be an array of strings"));
        }
        ids.push(t.to_string());
    }
    if ids.len() != 1 {
        return Err(String::from("diff_ids must name the tail record"));
    }
    Ok(ids)
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
            "name": "ucb_delegate",
            "description": "Lattice-gated model delegation through UCB.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "message": { "type": "string" },
                    "protocol": { "type": "string" },
                    "session_id": { "type": "string" },
                },
            }
        }),
        json!({
            "name": "ucb_rollback",
            "description": "Rollback the tail UCB journal record by diff id after Base Node ACK.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "diff_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1,
                        "maxItems": 1
                    }
                },
                "required": ["diff_ids"]
            }
        }),
        json!({
            "name": "ucb_health",
            "description": "UCB and lattice dock health snapshot.",
            "inputSchema": { "type": "object", "properties": {} },
        }),
        json!({
            "name": "ucb_compile_manifest",
            "description": "Compile provided GAP text or JSON with the local gap-manifest-v1 compiler.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "source": { "type": "string" },
                    "task_manifest": { "type": "object" },
                },
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::{clamp_rollback_steps, parse_rollback_diff_ids, parse_tool_args, handle_mcp_request};
    use serde_json::json;

    #[test]
    fn bm04_clamp_rejects_zero_and_over_100() {
        assert!(clamp_rollback_steps(0).is_err());
        assert!(clamp_rollback_steps(101).is_err());
        assert!(clamp_rollback_steps(10_000).is_err());
        assert_eq!(clamp_rollback_steps(1).unwrap(), 1);
        assert_eq!(clamp_rollback_steps(100).unwrap(), 100);
    }

    #[test]
    fn rollback_requires_exactly_one_named_tail_id() {
        let ids = parse_rollback_diff_ids(&json!({"diff_ids": ["ucb-diff-1"]})).unwrap();
        assert_eq!(ids, vec![String::from("ucb-diff-1")]);
        assert!(parse_rollback_diff_ids(&json!({"steps": 1})).is_err());
        assert!(parse_rollback_diff_ids(&json!({"diff_ids": []})).is_err());
        assert!(parse_rollback_diff_ids(&json!({"diff_ids": ["a", "b"]})).is_err());
        assert!(parse_rollback_diff_ids(&json!({"diff_ids": [""]})).is_err());
        assert!(parse_rollback_diff_ids(&json!({"diff_ids": "tail"})).is_err());
        assert!(parse_rollback_diff_ids(&json!({})).is_err());
    }

    #[test]
    fn parse_tool_args_refuses_non_object_and_missing_required() {
        assert!(parse_tool_args(&json!({}), true).is_err());
        assert!(parse_tool_args(&json!({"arguments": "bad"}), true).is_err());
        assert!(parse_tool_args(&json!({"arguments": 3}), true).is_err());
        assert!(parse_tool_args(&json!({"arguments": []}), true).is_err());
        let ok = parse_tool_args(&json!({"arguments": {"protocol": "lg"}}), true).unwrap();
        assert_eq!(ok.get("protocol").and_then(|v| v.as_str()), Some("lg"));
        let empty = parse_tool_args(&json!({}), false).unwrap();
        assert!(empty.as_object().unwrap().is_empty());
    }


    #[tokio::test]
    async fn mcp_ingest_malformed_arguments_are_jsonrpc_invalid_params() {
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
            wire_limits: aep_ucb_perimeter_v1::WireLimits::default(),
            manifest_strict: true,
        };

        let rt = std::sync::Arc::new(crate::bridge::UcbRuntime::new(config).unwrap());
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": { "name": "ucb_ingest", "arguments": "bad" }
        });
        let out = handle_mcp_request(&rt, body).await;
        assert_eq!(out.get("error").and_then(|e| e.get("code")), Some(&json!(-32602)));
        assert!(out.get("result").is_none());
        let missing = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": "ucb_ingest" }
        });
        let out = handle_mcp_request(&rt, missing).await;
        assert_eq!(out.get("error").and_then(|e| e.get("code")), Some(&json!(-32602)));
    }

}
