//! Blast radius analysis against declared intent envelope.

use crate::catalog::{normalize_path, ComponentIndex};
use crate::IntentDeclaration;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SieeVerdict {
    Allow,
    Gate,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadiusImpact {
    pub files_touched_estimate: u32,
    pub lines_estimate: u32,
    pub components: Vec<String>,
    pub within_envelope: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlastRadiusReport {
    pub report_version: String,
    pub computed_at: String,
    pub within_envelope: bool,
    pub siee_verdict: SieeVerdict,
    pub impact: BlastRadiusImpact,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

pub fn compute_blast_radius(
    intent: &IntentDeclaration,
    paths: &[String],
    lines_estimate: Option<u32>,
    catalog: &ComponentIndex,
) -> BlastRadiusReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let file_count = paths.len() as u32;
    let lines = lines_estimate.unwrap_or_else(|| file_count.saturating_mul(80));

    for path in paths {
        let norm = normalize_path(path);
        if path_violates_forbidden(&norm, &intent.envelope.forbidden_paths) {
            errors.push(format!("path '{norm}' is under forbidden prefix"));
        }
        if !path_allowed(&norm, &intent.envelope.allowed_paths) {
            errors.push(format!("path '{norm}' outside allowed envelope"));
        }
    }

    if let Some(max) = intent.envelope.max_files {
        if file_count > max {
            errors.push(format!(
                "file count {file_count} exceeds envelope max_files {max}"
            ));
        }
    }

    if let Some(max) = intent.envelope.max_lines {
        if lines > max {
            errors.push(format!("line estimate {lines} exceeds envelope max_lines {max}"));
        }
    }

    let components = catalog.components_for_paths(paths);
    let within_envelope = errors.is_empty();
    let siee_verdict = if within_envelope {
        SieeVerdict::Allow
    } else {
        SieeVerdict::Deny
    };

    if components.is_empty() && !paths.is_empty() {
        warnings.push("no registry component matched touched paths".into());
    }

    BlastRadiusReport {
        report_version: "1".into(),
        computed_at: chrono_now(),
        within_envelope,
        siee_verdict,
        impact: BlastRadiusImpact {
            files_touched_estimate: file_count,
            lines_estimate: lines,
            components,
            within_envelope,
        },
        warnings,
        errors,
    }
}

pub fn paths_from_payload(payload: &Value) -> Vec<String> {
    if let Some(arr) = payload.get("paths").and_then(|v| v.as_array()) {
        return arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    if let Some(arr) = payload
        .get("envelope")
        .and_then(|e| e.get("planned_paths"))
        .and_then(|v| v.as_array())
    {
        return arr
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
    }
    vec![]
}

fn path_allowed(path: &str, allowed: &[String]) -> bool {
    if allowed.is_empty() {
        return true;
    }
    allowed.iter().any(|a| {
        let prefix = normalize_path(a);
        path == prefix || path.starts_with(&format!("{prefix}/"))
    })
}

fn path_violates_forbidden(path: &str, forbidden: &[String]) -> bool {
    forbidden.iter().any(|f| {
        let prefix = normalize_path(f);
        path == prefix || path.starts_with(&format!("{prefix}/"))
    })
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::IntentEnvelope;

    fn sample_intent() -> IntentDeclaration {
        IntentDeclaration {
            statement: "test".into(),
            envelope: IntentEnvelope {
                max_files: Some(5),
                max_lines: Some(500),
                allowed_paths: vec!["AEP-Components/cca/".into()],
                forbidden_paths: vec!["AEP-Base-Node/".into()],
                semantic_tags: vec![],
            },
        }
    }

    #[test]
    fn allows_nested_path_under_trailing_slash_prefix() {
        let catalog = ComponentIndex {
            prefixes: vec![(
                "AEP-Components/cca".into(),
                "cca".into(),
            )],
        };
        let report = compute_blast_radius(
            &sample_intent(),
            &["AEP-Components/cca/lib/gap-context.mjs".into()],
            None,
            &catalog,
        );
        assert!(report.within_envelope, "errors: {:?}", report.errors);
    }

    #[test]
    fn denies_forbidden_path() {
        let catalog = ComponentIndex {
            prefixes: vec![(
                "AEP-Components/cca".into(),
                "cca".into(),
            )],
        };
        let report = compute_blast_radius(
            &sample_intent(),
            &["AEP-Base-Node/crate/src/lib.rs".into()],
            None,
            &catalog,
        );
        assert!(!report.within_envelope);
    }
}