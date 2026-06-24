//! REST API subprotocol: validate agent-proposed HTTP calls against registered endpoints.

use aep_subprotocol_core::{path_matches, validate_payload_against_schema, ValidationResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointSchema {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub request_body: Option<Value>,
    #[serde(default)]
    pub required_headers: Vec<String>,
    #[serde(default)]
    pub query_params: Value,
}

#[derive(Debug, Default)]
pub struct ApiRegistry {
    endpoints: HashMap<String, EndpointSchema>,
}

impl ApiRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, id: impl Into<String>, schema: EndpointSchema) {
        self.endpoints.insert(id.into(), schema);
    }

    pub fn validate_call(
        &self,
        method: &str,
        path: &str,
        body: Option<&Value>,
        headers: Option<&Value>,
    ) -> ValidationResult {
        let method = method.to_uppercase();
        let mut matched: Option<(&String, &EndpointSchema)> = None;
        for (id, schema) in &self.endpoints {
            if schema.method.to_uppercase() == method && path_matches(&schema.path, path) {
                matched = Some((id, schema));
                break;
            }
        }

        let Some((endpoint_id, schema)) = matched else {
            let registered: Vec<String> = self
                .endpoints
                .values()
                .map(|s| format!("{} {}", s.method, s.path))
                .collect();
            return ValidationResult::fail(vec![format!(
                "No endpoint for {method} {path}. Registered: {registered:?}"
            )]);
        };

        let mut errors = Vec::new();
        if let Some(body_schema) = &schema.request_body {
            match body {
                None => errors.push(format!("{method} {path} requires a request body")),
                Some(b) => errors.extend(validate_payload_against_schema(b, body_schema)),
            }
        } else if body.is_some() && matches!(method.as_str(), "GET" | "DELETE") {
            errors.push(format!("{method} requests should not have a body"));
        }

        if let Some(hdrs) = headers.and_then(|v| v.as_object()) {
            let keys: Vec<String> = hdrs.keys().map(|k| k.to_lowercase()).collect();
            for req in &schema.required_headers {
                if !keys.iter().any(|k| k == &req.to_lowercase()) {
                    errors.push(format!("Missing required header: \"{req}\""));
                }
            }
        } else if !schema.required_headers.is_empty() {
            for req in &schema.required_headers {
                errors.push(format!("Missing required header: \"{req}\""));
            }
        }

        if !errors.is_empty() {
            return ValidationResult {
                valid: false,
                errors,
                detail: Some(json!({ "endpoint_id": endpoint_id })),
            };
        }

        ValidationResult::ok(Some(json!({
            "endpoint_id": endpoint_id,
            "method": method,
            "path": path,
            "status": 200
        })))
    }

    pub fn load_reference(path: &str) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let defs: HashMap<String, EndpointSchema> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut reg = Self::new();
        for (id, schema) in defs {
            reg.register(id, schema);
        }
        Ok(reg)
    }
}