//! Map repo paths to registry component ids via catalog.json.

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize)]
struct CatalogEntry {
    id: String,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CatalogFile {
    components: Vec<CatalogEntry>,
}

#[derive(Debug, Clone)]
pub struct ComponentIndex {
    pub prefixes: Vec<(String, String)>,
}

impl ComponentIndex {
    pub fn load(repo_root: &Path) -> Result<Self, String> {
        let catalog_path = repo_root.join("AEP-Base-Node/registry/catalog.json");
        let raw = fs::read_to_string(&catalog_path)
            .map_err(|e| format!("cannot read {}: {e}", catalog_path.display()))?;
        let catalog: CatalogFile =
            serde_json::from_str(&raw).map_err(|e| format!("invalid catalog.json: {e}"))?;

        let mut prefixes: Vec<(String, String)> = catalog
            .components
            .into_iter()
            .filter_map(|c| {
                let p = c.path?.trim_end_matches('/').to_string();
                if p.is_empty() {
                    None
                } else {
                    Some((p, c.id))
                }
            })
            .collect();

        prefixes.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        Ok(Self { prefixes })
    }

    pub fn component_for_path(&self, path: &str) -> Option<String> {
        let normalized = normalize_path(path);
        for (prefix, id) in &self.prefixes {
            let np = normalize_path(prefix);
            if normalized == np || normalized.starts_with(&format!("{np}/")) {
                return Some(id.clone());
            }
        }
        None
    }

    pub fn components_for_paths(&self, paths: &[String]) -> Vec<String> {
        let mut seen = HashMap::new();
        for p in paths {
            if let Some(id) = self.component_for_path(p) {
                seen.insert(id, ());
            }
        }
        let mut out: Vec<String> = seen.keys().cloned().collect();
        out.sort();
        out
    }
}

pub fn normalize_path(path: &str) -> String {
    let mut p = path.replace('\\', "/");
    while p.starts_with("./") {
        p = p[2..].to_string();
    }
    p = p.trim_start_matches('/').to_string();
    p.trim_end_matches('/').to_string()
}

pub fn resolve_repo_root(payload: &serde_json::Value) -> PathBuf {
    payload
        .get("repo_root")
        .and_then(|v| v.as_str())
        .map(PathBuf::from)
        .or_else(|| std::env::var("AEP_REPO_ROOT").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}