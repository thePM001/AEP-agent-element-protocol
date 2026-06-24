//! IaC subprotocol: validate agent-generated infrastructure resources.

use aep_subprotocol_core::{nested_get, type_matches, ValidationResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceSchema {
    pub kind: String,
    pub api_version: String,
    #[serde(default)]
    pub required_fields: Vec<String>,
    #[serde(default)]
    pub properties: HashMap<String, Value>,
    #[serde(default)]
    pub forbidden_fields: Vec<String>,
}

#[derive(Debug, Default)]
pub struct IacRegistry {
    resources: HashMap<String, ResourceSchema>,
}

impl IacRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, id: impl Into<String>, schema: ResourceSchema) {
        self.resources.insert(id.into(), schema);
    }

    pub fn validate_resource(&self, kind: &str, spec: &Value) -> ValidationResult {
        let mut matched: Option<(&String, &ResourceSchema)> = None;
        for (id, schema) in &self.resources {
            if schema.kind == kind {
                matched = Some((id, schema));
                break;
            }
        }

        let Some((resource_id, schema)) = matched else {
            let kinds: Vec<_> = self.resources.values().map(|s| s.kind.clone()).collect();
            return ValidationResult::fail(vec![format!(
                "Unknown resource kind: \"{kind}\". Registered: {kinds:?}"
            )]);
        };

        let mut errors = Vec::new();
        for req in &schema.required_fields {
            if nested_get(spec, req).is_none() {
                errors.push(format!("Missing required field: \"{req}\""));
            }
        }
        for forbidden in &schema.forbidden_fields {
            if nested_get(spec, forbidden).is_some() {
                errors.push(format!("Forbidden field present: \"{forbidden}\""));
            }
        }
        for (prop_path, prop_schema) in &schema.properties {
            if let Some(value) = nested_get(spec, prop_path) {
                if let Some(expected) = prop_schema.get("type").and_then(|v| v.as_str()) {
                    if !type_matches(value, expected) {
                        errors.push(format!(
                            "\"{prop_path}\" expected \"{expected}\""
                        ));
                    }
                }
                if let Some(values) = prop_schema.get("enum").and_then(|v| v.as_array()) {
                    if let Some(s) = value.as_str() {
                        if !values.iter().any(|v| v.as_str() == Some(s)) {
                            errors.push(format!("\"{prop_path}\" has invalid enum value"));
                        }
                    }
                }
            }
        }

        if !errors.is_empty() {
            return ValidationResult {
                valid: false,
                errors,
                detail: Some(json!({ "resource_id": resource_id })),
            };
        }

        ValidationResult::ok(Some(json!({
            "resource_id": resource_id,
            "kind": kind,
            "api_version": schema.api_version
        })))
    }

    pub fn load_reference(path: &str) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let defs: HashMap<String, ResourceSchema> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut reg = Self::new();
        for (id, schema) in defs {
            reg.register(id, schema);
        }
        Ok(reg)
    }
}