//! Events subprotocol: validate pub/sub emissions against registered event schemas.

use aep_subprotocol_core::{validate_payload_against_schema, ValidationResult};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventSchema {
    pub topic: String,
    #[serde(default)]
    pub payload_schema: Value,
    #[serde(default)]
    pub allowed_producers: Vec<String>,
    #[serde(default = "default_max_bytes")]
    pub max_payload_bytes: usize,
    #[serde(default = "default_true")]
    pub requires_correlation_id: bool,
}

fn default_max_bytes() -> usize {
    65_536
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Default)]
pub struct EventRegistry {
    events: HashMap<String, EventSchema>,
}

impl EventRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, event_id: impl Into<String>, schema: EventSchema) {
        self.events.insert(event_id.into(), schema);
    }

    pub fn validate_event(
        &self,
        event_id: &str,
        payload: &Value,
        producer_id: Option<&str>,
        correlation_id: Option<&str>,
    ) -> ValidationResult {
        let Some(schema) = self.events.get(event_id) else {
            let registered: Vec<_> = self.events.keys().cloned().collect();
            return ValidationResult::fail(vec![format!(
                "Unknown event: \"{event_id}\". Registered: {registered:?}"
            )]);
        };

        let mut errors = Vec::new();
        if !schema.allowed_producers.is_empty() {
            match producer_id {
                Some(producer)
                    if schema.allowed_producers.iter().any(|p| p == producer) => {}
                Some(producer) => {
                    errors.push(format!(
                        "Producer \"{producer}\" not allowed for \"{event_id}\". Allowed: {:?}",
                        schema.allowed_producers
                    ));
                }
                None => {
                    errors.push(format!(
                        "Producer is required for \"{event_id}\" when allowed_producers is set. Allowed: {:?}",
                        schema.allowed_producers
                    ));
                }
            }
        }
        if schema.requires_correlation_id && correlation_id.unwrap_or("").is_empty() {
            errors.push(format!("Event \"{event_id}\" requires a correlation_id"));
        }
        errors.extend(validate_payload_against_schema(payload, &schema.payload_schema));
        let size = serde_json::to_string(payload).unwrap_or_default().len();
        if size > schema.max_payload_bytes {
            errors.push(format!(
                "Payload size {size} exceeds max {} bytes",
                schema.max_payload_bytes
            ));
        }

        if !errors.is_empty() {
            return ValidationResult::fail(errors);
        }

        ValidationResult::ok(Some(json!({
            "event_id": event_id,
            "topic": schema.topic
        })))
    }

}

#[cfg(test)]
mod high_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn producer_allowlist_requires_producer_id() {
        let mut reg = EventRegistry::new();
        reg.register(
            "task.created",
            EventSchema {
                topic: "tasks".into(),
                allowed_producers: vec!["cca".into()],
                requires_correlation_id: false,
                max_payload_bytes: 4096,
                payload_schema: json!({ "type": "object" }),
            },
        );
        let deny = reg.validate_event("task.created", &json!({}), None, None);
        assert!(!deny.valid);
        assert!(deny.errors.iter().any(|e| e.contains("Producer is required")));
        let ok = reg.validate_event("task.created", &json!({}), Some("cca"), None);
        assert!(ok.valid, "{:?}", ok.errors);
    }
}

impl EventRegistry {
    pub fn load_reference(path: &str) -> Result<Self, String> {
        let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let defs: HashMap<String, EventSchema> =
            serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut reg = Self::new();
        for (id, schema) in defs {
            reg.register(id, schema);
        }
        Ok(reg)
    }
}