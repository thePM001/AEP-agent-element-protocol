//! Shared validation primitives for all AEP subprotocol crates.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl ValidationResult {
    pub fn ok(detail: Option<Value>) -> Self {
        Self {
            valid: true,
            errors: vec![],
            detail,
        }
    }

    pub fn fail(errors: Vec<String>) -> Self {
        Self {
            valid: false,
            errors,
            detail: None,
        }
    }

    pub fn fail_one(msg: impl Into<String>) -> Self {
        Self::fail(vec![msg.into()])
    }
}

pub fn nested_get<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

pub fn type_matches(value: &Value, expected: &str) -> bool {
    match expected {
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some(),
        "number" => value.is_number(),
        "boolean" => value.is_boolean(),
        "array" => value.is_array(),
        "object" => value.is_object(),
        _ => true,
    }
}

pub fn validate_payload_against_schema(data: &Value, schema: &Value) -> Vec<String> {
    let mut errors = Vec::new();
    let Some(obj) = data.as_object() else {
        return vec!["Payload must be a JSON object".into()];
    };

    let properties = schema
        .get("properties")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let required: HashSet<&str> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let additional = schema
        .get("additionalProperties")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    for field in &required {
        if !obj.contains_key(*field) {
            errors.push(format!("Missing required field: \"{field}\""));
        }
    }

    for (key, value) in obj {
        if let Some(prop) = properties.get(key) {
            if let Some(expected_type) = prop.get("type").and_then(|v| v.as_str()) {
                if !type_matches(value, expected_type) {
                    errors.push(format!(
                        "Field \"{key}\" expected type \"{expected_type}\""
                    ));
                }
            }
            if let Some(values) = prop.get("enum").and_then(|v| v.as_array()) {
                let allowed: HashSet<&str> = values.iter().filter_map(|v| v.as_str()).collect();
                if let Some(s) = value.as_str() {
                    if !allowed.contains(s) {
                        errors.push(format!(
                            "Field \"{key}\" must be one of {:?}, got \"{s}\"",
                            allowed
                        ));
                    }
                }
            }
            if let Some(pattern) = prop.get("pattern").and_then(|v| v.as_str()) {
                if let Ok(re) = Regex::new(pattern) {
                    if let Some(s) = value.as_str() {
                        if !re.is_match(s) {
                            errors.push(format!(
                                "Field \"{key}\" does not match pattern \"{pattern}\""
                            ));
                        }
                    }
                }
            }
            if let Some(min) = prop.get("minimum").and_then(|v| v.as_f64()) {
                if let Some(n) = value.as_f64() {
                    if n < min {
                        errors.push(format!("Field \"{key}\" must be >= {min}"));
                    }
                }
            }
            if let Some(max) = prop.get("maximum").and_then(|v| v.as_f64()) {
                if let Some(n) = value.as_f64() {
                    if n > max {
                        errors.push(format!("Field \"{key}\" must be <= {max}"));
                    }
                }
            }
        } else if !additional {
            errors.push(format!(
                "Unexpected field: \"{key}\" (additionalProperties=false)"
            ));
        }
    }

    errors
}

pub fn path_matches(pattern: &str, actual: &str) -> bool {
    let re_src = Regex::new(r"\{[^}]+\}")
        .unwrap()
        .replace_all(pattern, "[^/]+");
    Regex::new(&format!("^{re_src}$"))
        .map(|re| re.is_match(actual))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schema_requires_fields() {
        let schema = json!({
            "required": ["id"],
            "properties": { "id": { "type": "string" } }
        });
        let errs = validate_payload_against_schema(&json!({}), &schema);
        assert!(errs.iter().any(|e| e.contains("id")));
    }

    #[test]
    fn path_param_matching() {
        assert!(path_matches("/api/tasks/{id}", "/api/tasks/abc"));
        assert!(!path_matches("/api/tasks/{id}", "/api/tasks/abc/extra"));
    }
}