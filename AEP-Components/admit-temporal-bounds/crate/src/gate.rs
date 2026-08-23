// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:b478d503a6842ab07413e7268f7c2ef74fb5f5e348059a3dcfd911e126da8cd9
// Prove filterCrossing folds temporal walls. Soft warn stays warn.

use crate::compile::{
    compile_temporal_warns, fold_temporal_into_admit, TemporalCompileInput,
    WALL_TEMPORAL_CAUSAL_PARENT, WALL_TEMPORAL_DRIFT,
};
use aep_admit::AdmitWall;
use std::fs;
use std::path::{Path, PathBuf};

fn extract_filter_crossing(src: &str) -> String {
    let start = match src.find("async filterCrossing") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

pub fn filter_folds_temporal(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    if body.contains("compileTemporalWalls") == false {
        return Err(String::from("filterCrossing does not compile temporal walls"));
    }
    Ok(String::from("ok filterCrossing folds temporal bounds"))
}

pub fn default_filter_ts() -> PathBuf {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| String::from(".")));
    let candidates = [
        here.join("../../dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
        here.join("../../../NLA-AEP-v2.8-open-source/AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
    ];
    for p in candidates {
        if p.is_file() {
            return p;
        }
    }
    here.join("../../dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts")
}

pub fn run_gate(filter: &Path) -> Result<i32, String> {
    let src = fs::read_to_string(filter).map_err(|e| e.to_string())?;
    let proof = filter_folds_temporal(&src)?;
    let mut skew = TemporalCompileInput::with_defaults();
    skew.has_agent_time = true;
    skew.agent_time_ms = 10_000;
    skew.bridge_time_ms = 9_000;
    skew.drift_ms = 1_000;
    skew.max_drift_ms = 50;
    skew.causal_parents.push(String::from("evt-parent"));
    skew.event_id = String::from("evt-child");
    let extra = vec![AdmitWall::close("constraint:required_field:alpha", "alpha required")];
    let admit = fold_temporal_into_admit(&skew, &extra);
    if admit.allow {
        return Err(String::from("expected closed walls"));
    }
    let ids: Vec<&str> = admit.closed.iter().map(|w| w.id.as_str()).collect();
    if ids.contains(&WALL_TEMPORAL_DRIFT) == false {
        return Err(String::from("clock skew wall missing"));
    }
    if ids.contains(&WALL_TEMPORAL_CAUSAL_PARENT) == false {
        return Err(String::from("causal parent wall missing"));
    }
    let mut soft = TemporalCompileInput::with_defaults();
    soft.has_agent_time = true;
    soft.drift_ms = 30;
    soft.max_drift_ms = 50;
    let warns = compile_temporal_warns(&soft);
    if warns.is_empty() {
        return Err(String::from("soft warn missing"));
    }
    if fold_temporal_into_admit(&soft, &[]).allow == false {
        return Err(String::from("soft warn closed a wall"));
    }
    println!("aep-admit-temporal-bounds ok proof={} closed={} warns={}", proof, admit.closed.len(), warns.len());
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_source_folds_temporal() {
        let path = default_filter_ts();
        if path.is_file() == false {
            return;
        }
        let src = fs::read_to_string(&path).unwrap_or_default();
        if src.is_empty() {
            return;
        }
        assert_eq!(filter_folds_temporal(&src).is_ok(), true);
        let _ = run_gate(&path).expect("run_gate");
    }
}

