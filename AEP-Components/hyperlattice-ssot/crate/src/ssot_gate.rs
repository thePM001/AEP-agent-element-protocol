//! Exit non-zero when HyperlatticeFilter or LatticePolicyEvaluator trees drift.
//! @GCDE: gaplune.policy.v1

use crate::ssot_compare::{compare_repo, find_repo_root, SsotCompare};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;

pub struct SsotGateArgs {
    pub root: Option<String>,
}

pub struct SsotGate {
    pub settings: HashMap<String, String>,
}

impl SsotGate {
    pub fn parse(args: &[String]) -> Result<SsotGateArgs, String> {
        let mut root = None;
        let mut i = 0usize;
        while i < args.len() {
            if args[i] == "--root" && i + 1 < args.len() {
                root = Some(args[i + 1].clone());
                i += 2;
                continue;
            }
            i += 1;
        }
        Ok(SsotGateArgs { root })
    }

    pub fn from_args(args: &SsotGateArgs) -> Self {
        let mut settings = HashMap::new();
        if let Some(path) = &args.root {
            settings.insert("root".into(), path.clone());
        }
        Self { settings }
    }

    pub fn run(&self) -> Result<i32, String> {
        let start = match self.settings.get("root") {
            Some(r) => PathBuf::from(r),
            None => env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        };
        let root = match find_repo_root(&start) {
            Some(p) => p,
            None => start,
        };
        let mut cmp = SsotCompare::with_root(root.to_string_lossy().to_string());
        match cmp.process() {
            Ok(()) => Ok(0),
            Err(e) => {
                eprintln!("{}", e);
                let report = compare_repo(&root);
                eprintln!("{}", report.as_text());
                Ok(1)
            }
        }
    }
}