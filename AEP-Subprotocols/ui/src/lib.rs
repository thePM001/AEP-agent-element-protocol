//! UI subprotocol: validate three-layer UI bundle (scene, registry, theme).

use aep_subprotocol_core::ValidationResult;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct UiBundle {
    pub scene: Value,
    pub registry: Value,
    pub theme: Value,
}

impl UiBundle {
    pub fn load(scene_path: &Path, registry_path: &Path, theme_path: &Path) -> Result<Self, String> {
        let scene: Value = serde_json::from_str(
            &std::fs::read_to_string(scene_path).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let registry: Value = serde_yaml::from_str(
            &std::fs::read_to_string(registry_path).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let theme: Value = serde_yaml::from_str(
            &std::fs::read_to_string(theme_path).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            scene,
            registry,
            theme,
        })
    }

    pub fn validate(&self) -> ValidationResult {
        let mut errors = Vec::new();

        if self.scene.get("aep_version").is_none() {
            errors.push("aep-scene.json missing aep_version".into());
        }
        if self.registry.get("aep_version").is_none() {
            errors.push("aep-registry.yaml missing aep_version".into());
        }
        if self.theme.get("aep_version").is_none() {
            errors.push("aep-theme.yaml missing aep_version".into());
        }

        let elements = self
            .scene
            .get("elements")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        let ids: HashSet<String> = elements.keys().cloned().collect();
        for (id, el) in &elements {
            if let Some(parent) = el.get("parent").and_then(|v| v.as_str()) {
                if !ids.contains(parent) {
                    errors.push(format!(
                        "Scene element \"{id}\" references missing parent \"{parent}\""
                    ));
                }
            }
            if let Some(children) = el.get("children").and_then(|v| v.as_array()) {
                for child in children {
                    if let Some(cid) = child.as_str() {
                        if !ids.contains(cid) {
                            errors.push(format!(
                                "Scene element \"{id}\" references missing child \"{cid}\""
                            ));
                        }
                    }
                }
            }
        }

        let styles = self
            .theme
            .get("component_styles")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        let registry_map: HashMap<String, Value> = if let Some(obj) = self.registry.as_object() {
            obj.iter()
                .filter(|(k, _)| k.chars().next().map(|c| c.is_ascii_uppercase()) == Some(true))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        } else {
            HashMap::new()
        };

        for (element_id, entry) in &registry_map {
            if let Some(binding) = entry.get("skin_binding").and_then(|v| v.as_str()) {
                if !styles.contains_key(binding) {
                    errors.push(format!(
                        "Element \"{element_id}\" skin_binding \"{binding}\" missing in theme component_styles"
                    ));
                }
            }
        }

        if errors.is_empty() {
            ValidationResult::ok(None)
        } else {
            ValidationResult::fail(errors)
        }
    }
}