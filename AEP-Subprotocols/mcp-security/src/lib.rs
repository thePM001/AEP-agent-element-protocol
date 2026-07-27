//! MCP Security subprotocol: tool name validation, typosquat detection, schema drift.

use aep_subprotocol_core::ValidationResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
    /// When non-empty, only these agent_ids may invoke the tool.
    #[serde(default)]
    pub allowed_agents: Vec<String>,
    /// Optional external catalog digest (hex). When set, validate_tool_call must
    /// supply a matching catalog_digest or fail closed on drift.
    #[serde(default)]
    pub catalog_digest: Option<String>,
}

#[derive(Debug, Default)]
pub struct McpSecurityRegistry {
    allowed_tools: HashMap<String, ToolDefinition>,
    schema_hashes: HashMap<String, String>,
    blocked_patterns: Vec<String>,
}

/// L-25: structural MCP request envelope validation (not mere non-null)
pub fn validate_mcp_request(request: &Value) -> ValidationResult {
    let mut errors = Vec::new();
    if !request.is_object() {
        errors.push("MCP request must be a JSON object".into());
        return if errors.is_empty() {
            ValidationResult::ok(None)
        } else {
            ValidationResult::fail(errors)
        };
    }
    let obj = request.as_object().unwrap();
    if !obj.contains_key("method") && !obj.contains_key("tool") && !obj.contains_key("name") {
        errors.push("MCP request requires method, tool, or name field".into());
    }
    if let Some(params) = obj.get("params") {
        if !params.is_object() && !params.is_null() {
            errors.push("MCP params must be object or null".into());
        }
    }
    if errors.is_empty() {
        ValidationResult::ok(None)
    } else {
        ValidationResult::fail(errors)
    }
}

impl McpSecurityRegistry {
    pub fn new() -> Self {
        Self {
            blocked_patterns: vec![
                "eval".into(),
                "exec".into(),
                "system".into(),
                "__proto__".into(),
                "child_process".into(),
            ],
            ..Default::default()
        }
    }

    pub fn register_tool(&mut self, tool: ToolDefinition) {
        let hash = schema_hash(&tool.input_schema);
        self.schema_hashes.insert(tool.name.clone(), hash);
        self.allowed_tools.insert(tool.name.clone(), tool);
    }

    pub fn validate_tool_call(
        &self,
        tool_name: &str,
        input: &Value,
        agent_id: Option<&str>,
    ) -> ValidationResult {
        self.validate_tool_call_with_catalog(tool_name, input, agent_id, None)
    }

    /// Validate with optional external catalog digest (schema drift check).
    pub fn validate_tool_call_with_catalog(
        &self,
        tool_name: &str,
        input: &Value,
        agent_id: Option<&str>,
        catalog_digest: Option<&str>,
    ) -> ValidationResult {
        let mut errors = Vec::new();
        if tool_name.trim().is_empty() {
            errors.push("Tool name must be non-empty".into());
        }
        if !input.is_object() && !input.is_null() {
            errors.push("Tool input must be object or null".into());
        }

        // HIGH: empty allowlist fails closed (no unrestricted tool surface)
        if self.allowed_tools.is_empty() {
            errors.push(
                "MCP allowlist is empty; tool calls denied until tools are registered (fail-closed)"
                    .into(),
            );
            return ValidationResult::fail(errors);
        }

        for pat in &self.blocked_patterns {
            if tool_name.to_lowercase().contains(pat) {
                errors.push(format!(
                    "Tool name \"{tool_name}\" matches blocked pattern \"{pat}\""
                ));
            }
        }

        if let Some(known) = self.allowed_tools.get(tool_name) {
            // Agent ACL: when allowed_agents is set, require matching agent_id.
            if !known.allowed_agents.is_empty() {
                match agent_id {
                    Some(aid) if known.allowed_agents.iter().any(|a| a == aid) => {}
                    Some(aid) => {
                        errors.push(format!(
                            "Agent \"{aid}\" is not allowed to call tool \"{tool_name}\""
                        ));
                    }
                    None => {
                        errors.push(format!(
                            "agent_id is required for tool \"{tool_name}\" (allowed_agents is set)"
                        ));
                    }
                }
            }
            // Schema drift: compare external catalog digest when tool publishes one.
            if let Some(expected) = known.catalog_digest.as_ref() {
                match catalog_digest {
                    Some(got) if got.eq_ignore_ascii_case(expected) => {}
                    Some(_) => {
                        errors.push(format!(
                            "Schema drift detected for tool \"{tool_name}\" (catalog_digest mismatch)"
                        ));
                    }
                    None => {
                        errors.push(format!(
                            "catalog_digest required for tool \"{tool_name}\" (registered with digest)"
                        ));
                    }
                }
            }
            let current_hash = schema_hash(&known.input_schema);
            if let Some(stored) = self.schema_hashes.get(tool_name) {
                if stored != &current_hash {
                    errors.push(format!(
                        "Schema drift detected for tool \"{tool_name}\""
                    ));
                }
            }
            if let Some(props) = known.input_schema.get("properties").and_then(|v| v.as_object()) {
                let required: Vec<&str> = known
                    .input_schema
                    .get("required")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();
                // HIGH: null input cannot satisfy required fields
                if input.is_null() {
                    if !required.is_empty() {
                        for req in required {
                            errors.push(format!(
                                "Missing required tool input field: \"{req}\" (input was null)"
                            ));
                        }
                    }
                } else if let Some(obj) = input.as_object() {
                    for req in required {
                        if !obj.contains_key(req) {
                            errors.push(format!(
                                "Missing required tool input field: \"{req}\""
                            ));
                        }
                    }
                    for key in obj.keys() {
                        if !props.contains_key(key) {
                            errors.push(format!("Unexpected tool input field: \"{key}\""));
                        }
                    }
                }
            }
        } else {
            let squats = typosquat_candidates(tool_name, self.allowed_tools.keys());
            if !squats.is_empty() {
                errors.push(format!(
                    "Unknown tool \"{tool_name}\". Possible typosquat of: {squats:?}"
                ));
            } else {
                errors.push(format!(
                    "Unknown tool \"{tool_name}\". Not in MCP allowlist."
                ));
            }
        }

        if !errors.is_empty() {
            return ValidationResult::fail(errors);
        }
        ValidationResult::ok(None)
    }
}

fn schema_hash(schema: &Value) -> String {
    let bytes = serde_json::to_vec(schema).unwrap_or_default();
    hex::encode(Sha256::digest(bytes))
}

fn typosquat_candidates<'a>(
    name: &str,
    known: impl Iterator<Item = &'a String>,
) -> Vec<String> {
    known
        .filter(|k| levenshtein(name, k) <= 2 && *k != name)
        .cloned()
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut dp = vec![vec![0; b.len() + 1]; a.len() + 1];
    for (i, row) in dp.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, val) in dp[0].iter_mut().enumerate().skip(1) {
        *val = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }
    dp[a.len()][b.len()]
}
#[cfg(test)]
mod high_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn empty_allowlist_fails_closed() {
        let reg = McpSecurityRegistry::new();
        let r = reg.validate_tool_call("anything", &json!({}), None);
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("allowlist is empty")));
    }

    #[test]
    fn null_input_missing_required_fails() {
        let mut reg = McpSecurityRegistry::new();
        reg.register_tool(ToolDefinition {
            name: "t1".into(),
            description: "d".into(),
            input_schema: json!({
                "properties": { "x": { "type": "string" } },
                "required": ["x"]
            }),
            ..Default::default()
        });
        let r = reg.validate_tool_call("t1", &Value::Null, None);
        assert!(!r.valid);
        assert!(r.errors.iter().any(|e| e.contains("required")));
    }

    #[test]
    fn registered_tool_ok() {
        let mut reg = McpSecurityRegistry::new();
        reg.register_tool(ToolDefinition {
            name: "t1".into(),
            description: "d".into(),
            input_schema: json!({
                "properties": { "x": { "type": "string" } },
                "required": ["x"]
            }),
            ..Default::default()
        });
        let r = reg.validate_tool_call("t1", &json!({"x": "ok"}), None);
        assert!(r.valid, "{:?}", r.errors);
    }

    #[test]
    fn agent_acl_and_catalog_digest() {
        let mut reg = McpSecurityRegistry::new();
        reg.register_tool(ToolDefinition {
            name: "t1".into(),
            description: "d".into(),
            input_schema: json!({ "properties": {} }),
            allowed_agents: vec!["ag-1".into()],
            catalog_digest: Some("deadbeef".into()),
        });
        let deny = reg.validate_tool_call("t1", &json!({}), None);
        assert!(!deny.valid);
        let deny2 = reg.validate_tool_call_with_catalog("t1", &json!({}), Some("ag-1"), Some("wrong"));
        assert!(!deny2.valid);
        let ok = reg.validate_tool_call_with_catalog("t1", &json!({}), Some("ag-1"), Some("deadbeef"));
        assert!(ok.valid, "{:?}", ok.errors);
    }
}
