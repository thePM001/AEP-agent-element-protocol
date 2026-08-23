//! Compare canonical Components hyperlattice sources with SDK copies.
//! @GCDE: gaplune.policy.v1

use std::path::{Path, PathBuf};

pub struct Pair {
    pub name: &'static str,
    pub canonical: &'static str,
    pub replica: &'static str,
}

pub const PAIRS: &[Pair] = &[
    Pair {
        name: "HyperlatticeFilter.ts",
        canonical: "AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts",
        replica: "AEP-SDKs/typescript/dynaep/src/hyperlattice/HyperlatticeFilter.ts",
    },
    Pair {
        name: "LatticePolicyEvaluator.ts",
        canonical: "AEP-Components/dynAEP/bridge/hyperlattice/LatticePolicyEvaluator.ts",
        replica: "AEP-SDKs/typescript/dynaep/src/hyperlattice/LatticePolicyEvaluator.ts",
    },
];

#[derive(Debug, Clone)]
pub struct SsotReport {
    pub ok: bool,
    pub checked: Vec<String>,
    pub drifted: Vec<String>,
    pub missing: Vec<String>,
}

impl SsotReport {
    pub fn as_text(&self) -> String {
        format!(
            "ok={} checked={} drifted={} missing={}",
            self.ok,
            self.checked.len(),
            self.drifted.len(),
            self.missing.len()
        )
    }
}

pub fn compare_bytes(left: &[u8], right: &[u8]) -> bool {
    left == right
}

pub fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut cur = start.to_path_buf();
    loop {
        let probe = cur.join(PAIRS[0].canonical);
        let replica = cur.join(PAIRS[0].replica);
        if probe.is_file() && replica.is_file() {
            return Some(cur);
        }
        if !cur.pop() {
            return None;
        }
    }
}

pub struct SsotCompare {
    pub repo_root: String,
    pub report: String,
}

impl SsotCompare {
    pub fn new() -> Self {
        Self { repo_root: String::new(), report: String::new() }
    }
    pub fn with_root(root: impl Into<String>) -> Self {
        Self { repo_root: root.into(), report: String::new() }
    }
    pub fn process(&mut self) -> Result<(), String> {
        let root = PathBuf::from(&self.repo_root);
        let report = compare_repo(&root);
        self.report = report.as_text();
        if !report.ok {
            return Err(format!("hyperlattice SSOT drift: {}", report.drifted.join(",")));
        }
        Ok(())
    }
}

pub fn compare_repo(root: &Path) -> SsotReport {
    let mut checked = Vec::new();
    let mut drifted = Vec::new();
    let mut missing = Vec::new();
    for pair in PAIRS {
        let left_path = root.join(pair.canonical);
        let right_path = root.join(pair.replica);
        checked.push(pair.name.to_string());
        let left = std::fs::read(&left_path);
        let right = std::fs::read(&right_path);
        match (left, right) {
            (Ok(a), Ok(b)) => {
                if !compare_bytes(&a, &b) {
                    drifted.push(pair.name.to_string());
                }
            }
            _ => missing.push(pair.name.to_string()),
        }
    }
    let ok = drifted.is_empty() && missing.is_empty() && checked.len() == PAIRS.len();
    SsotReport { ok, checked, drifted, missing }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn identical_buffers_pass() {
        assert!(compare_bytes(b"same", b"same"));
    }

    #[test]
    fn drifted_buffers_fail() {
        assert!(!compare_bytes(b"left", b"right"));
    }

    #[test]
    fn live_trees_are_byte_identical() {
        let start = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root = find_repo_root(&start).expect("repo root with both hyperlattice trees");
        let report = compare_repo(&root);
        assert!(
            report.ok,
            "SSOT drift checked={:?} drifted={:?} missing={:?}",
            report.checked, report.drifted, report.missing
        );
    }

    #[test]
    fn process_fails_on_empty_root() {
        let mut cmp = SsotCompare::with_root("/tmp/does-not-exist-ssot-root");
        assert!(cmp.process().is_err());
    }
}