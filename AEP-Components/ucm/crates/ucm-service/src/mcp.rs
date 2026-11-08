//! MCP server (JSON-RPC 2.0). The same handler serves POST /ucm/v1/mcp and `aep-ucm mcp` on stdio.
//! Tools: ucm_lookup, ucm_eval, ucm_verify, ucm_explain.

use crate::engine::{ApiResult, Engine};
use serde_json::{json, Value as J};
use std::sync::Arc;

const VERSIONS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];

const GUIDE: &str = "UCM is an exact calculation engine. Do not calculate numbers yourself. \
1) ucm_lookup finds the function, unit, constant or formula you need. \
2) Write a UCM-IR program and call ucm_eval with its inputs; numbers are strings, money is \"12.50 EUR\", quantities are \"9.81 m/s^2\". \
3) Use the result and quote the receipt_id. Every rounding names a mode: round(x, 2, \"half_even\").";

fn tools() -> J {
    json!([
        {
            "name": "ucm_lookup",
            "description": "Find the UCM function, unit, constant or library formula for a calculation task. Returns catalog entries with signatures and examples. It never computes.",
            "inputSchema": { "type": "object", "required": ["query"], "properties": {
                "query": { "type": "string", "description": "What you need to calculate, in words" },
                "k": { "type": "string", "description": "How many entries, 1 to 20, default 5" }
            }}
        },
        {
            "name": "ucm_eval",
            "description": "Evaluate a UCM-IR program exactly and return the result with a signed receipt. Use it for every number you report.",
            "inputSchema": { "type": "object", "required": ["program"], "properties": {
                "program": { "type": "string", "description": "UCM-IR text, for example: input p: money[EUR];\\nround(p * 1.081, 2, \"half_even\")" },
                "inputs": { "type": "object", "description": "Input values as strings, for example {\"p\": \"19.90 EUR\"}" },
                "library_formula": { "type": "string", "description": "Id of the library formula when the program is that formula unchanged" }
            }}
        },
        {
            "name": "ucm_verify",
            "description": "Check a UCM receipt: signature mode checks the signature, replay mode also runs the program again.",
            "inputSchema": { "type": "object", "required": ["receipt"], "properties": {
                "receipt": { "description": "A receipt object or the receipt_id of a receipt this node stored" },
                "mode": { "type": "string", "enum": ["signature", "replay"] }
            }}
        },
        {
            "name": "ucm_explain",
            "description": "Typecheck a UCM-IR program without running it and show its inputs, result type and the functions it uses.",
            "inputSchema": { "type": "object", "required": ["program"], "properties": {
                "program": { "type": "string" }
            }}
        }
    ])
}

fn reply(id: &J, result: J) -> J {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: &J, code: i64, msg: &str) -> J {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": msg } })
}

fn tool_result(r: ApiResult) -> J {
    match r {
        Ok(v) => json!({ "content": [{ "type": "text", "text": v.to_string() }], "isError": false }),
        Err(e) => json!({ "content": [{ "type": "text", "text": e.to_json().to_string() }], "isError": true }),
    }
}

async fn blocking(engine: &Arc<Engine>, args: J, f: fn(&Engine, &J) -> ApiResult) -> ApiResult {
    let e = engine.clone();
    tokio::task::spawn_blocking(move || f(&e, &args))
        .await
        .unwrap_or_else(|_| Err(crate::engine::ApiError::new("internal", "evaluation thread failed", 500)))
}

/// Handle one JSON-RPC message. Returns None for notifications.
pub async fn handle(engine: &Arc<Engine>, msg: &J) -> Option<J> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let Some(id) = id else {
        // Notifications, such as notifications/initialized, get no answer.
        return None;
    };
    if msg.get("jsonrpc").and_then(|v| v.as_str()) != Some("2.0") {
        return Some(rpc_error(&id, -32600, "jsonrpc must be 2.0"));
    }
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    Some(match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(|v| v.as_str()).unwrap_or(VERSIONS[2]);
            let v = if VERSIONS.contains(&asked) { asked } else { VERSIONS[0] };
            reply(
                &id,
                json!({
                    "protocolVersion": v,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "aep-ucm", "version": aep_ucm_core::ENGINE_VERSION },
                    "instructions": GUIDE,
                }),
            )
        }
        "ping" => reply(&id, json!({})),
        "tools/list" => reply(&id, json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            if !args.is_object() {
                return Some(rpc_error(&id, -32602, "arguments must be an object"));
            }
            let r = match name {
                "ucm_lookup" => engine.lookup(&args).await,
                "ucm_eval" => blocking(engine, args, Engine::evaluate).await,
                "ucm_verify" => blocking(engine, args, Engine::verify).await,
                "ucm_explain" => blocking(engine, args, Engine::explain).await,
                other => return Some(rpc_error(&id, -32602, &format!("unknown tool {other}"))),
            };
            reply(&id, tool_result(r))
        }
        other => rpc_error(&id, -32601, &format!("method not found: {other}")),
    })
}

/// Serve MCP on stdin and stdout, one JSON message per line.
pub async fn serve_stdio(engine: Arc<Engine>) -> std::io::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let answer = match serde_json::from_str::<J>(&line) {
            Ok(msg) => handle(&engine, &msg).await,
            Err(_) => Some(rpc_error(&J::Null, -32700, "parse error")),
        };
        if let Some(a) = answer {
            out.write_all(format!("{a}\n").as_bytes()).await?;
            out.flush().await?;
        }
    }
    Ok(())
}
