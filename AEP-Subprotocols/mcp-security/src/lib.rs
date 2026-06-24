//! MCP Security subprotocol: tool name validation, typosquat detection, schema drift.

use aep_subprotocol_core::ValidationResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub input_schema: Value,
}

#[derive(Debug, Default)]
pub struct McpSecurityRegistry {
    allowed_tools: HashMap<String, ToolDefinition>,
    schema_hashes: HashMap<String, String>,
    blocked_patterns: Vec<String>,
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
        let mut errors = Vec::new();

        for pat in &self.blocked_patterns {
            if tool_name.to_lowercase().contains(pat) {
                errors.push(format!(
                    "Tool name \"{tool_name}\" matches blocked pattern \"{pat}\""
                ));
            }
        }

        if let Some(known) = self.allowed_tools.get(tool_name) {
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
                if let Some(obj) = input.as_object() {
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
            let _ = agent_id;
        } else if !self.allowed_tools.is_empty() {
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