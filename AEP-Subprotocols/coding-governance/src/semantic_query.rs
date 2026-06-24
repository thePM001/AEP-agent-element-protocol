//! Registry neighbor lookup for semantic_query (no parallel graph construction).

use crate::catalog::resolve_repo_root;
use aep_subprotocol_core::ValidationResult;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct ComponentManifest {
    id: String,
    #[serde(default)]
    cca: Option<CcaBlock>,
}

#[derive(Debug, Deserialize)]
struct CcaBlock {
    #[serde(default)]
    pairs_with: Vec<String>,
}

pub fn handle_semantic_query(payload: &Value) -> ValidationResult {
    let component_id = payload
        .get("component_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if component_id.is_empty() {
        return ValidationResult::fail(vec!["semantic_query requires component_id".into()]);
    }

    let repo_root = resolve_repo_root(payload);
    let neighbors = match load_registry_neighbors(&repo_root, component_id) {
        Ok(n) => n,
        Err(e) => return ValidationResult::fail(vec![e]),
    };

    ValidationResult::ok(Some(json!({
        "component_id": component_id,
        "neighbors": neighbors,
        "topology": "registry",
        "note": "Query registry pairs_with only; hyperlattice canvas is owned by composer-lite"
    })))
}

fn load_registry_neighbors(repo_root: &Path, component_id: &str) -> Result<Vec<Value>, String> {
    let components_dir = repo_root.join("AEP-Base-Node/registry/components");
    if !components_dir.is_dir() {
        return Err(format!(
            "registry/components not found at {}",
            components_dir.display()
        ));
    }

    let mut forward = HashSet::new();
    let mut reverse = HashSet::new();

    let target_manifest = components_dir.join(format!("{component_id}.json"));
    if target_manifest.is_file() {
        if let Ok(raw) = fs::read_to_string(&target_manifest) {
            if let Ok(m) = serde_json::from_str::<ComponentManifest>(&raw) {
                for p in m.cca.map(|c| c.pairs_with).unwrap_or_default() {
                    forward.insert(p);
                }
            }
        }
    }

    let mut all_ids = HashMap::new();
    for entry in fs::read_dir(&components_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let m: ComponentManifest = serde_json::from_str(&raw)
            .map_err(|e| format!("invalid manifest {}: {e}", path.display()))?;
        all_ids.insert(m.id.clone(), ());
        if m.cca
            .map(|c| c.pairs_with.iter().any(|p| p == component_id))
            .unwrap_or(false)
        {
            reverse.insert(m.id);
        }
    }

    if !all_ids.contains_key(component_id) {
        return Err(format!("unknown component_id '{component_id}'"));
    }

    let mut neighbors: Vec<Value> = forward
        .into_iter()
        .map(|id| json!({ "id": id, "relation": "pairs_with" }))
        .collect();
    for id in reverse {
        neighbors.push(json!({ "id": id, "relation": "paired_by" }));
    }
    neighbors.sort_by(|a, b| {
        let ai = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let bi = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
        ai.cmp(bi)
    });
    Ok(neighbors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn semantic_query_finds_gap_neighbors() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let r = handle_semantic_query(&json!({
            "component_id": "gap",
            "repo_root": repo.to_str().unwrap()
        }));
        assert!(r.valid, "{:?}", r.errors);
        let detail = r.detail.unwrap();
        let neighbors = detail.get("neighbors").and_then(|v| v.as_array()).unwrap();
        assert!(!neighbors.is_empty());
    }
}