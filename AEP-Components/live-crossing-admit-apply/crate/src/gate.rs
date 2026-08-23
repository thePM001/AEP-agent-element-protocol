// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:43d1489197a61229f16e004a73f5f1a019aa638d96255be5d6174fba77a93f4e
// Prove filterCrossing is Admit collect-all then Apply only.

use std::fs;
use std::path::{Path, PathBuf};

fn extract_filter_crossing(src: &str) -> String {
    let start = match src.find("async filterCrossing") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

pub fn live_opa_absent(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    if body.contains("latticePolicy.evaluate") || body.contains("evaluateLatticePolicyWithOpa") {
        return Err(String::from("filterCrossing still calls live OPA evaluate on action_path"));
    }
    if body.contains("evaluationChain") || body.contains("runEvaluationChain") || body.contains("step_00") {
        return Err(String::from("filterCrossing still runs 15-step evaluator on action_path"));
    }
    if body.contains("new LatticePolicyEvaluator") {
        return Err(String::from("live path still constructs PolicyEvaluator"));
    }
    Ok(String::from("ok live OPA absent on filterCrossing"))
}

pub fn filter_is_admit_then_apply(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    live_opa_absent(filter_source)?;
    if body.contains("admitCollectAll") == false {
        return Err(String::from("filterCrossing does not admitCollectAll"));
    }
    if body.contains("compileLatticePolicy") == false {
        return Err(String::from("filterCrossing does not compile lattice-policy walls"));
    }
    if body.contains("const applied = admit.allow") == false && body.contains("applied = admit.allow") == false {
        return Err(String::from("filterCrossing Apply is not iff admit.allow"));
    }
    if body.contains("lattice_policy.deny.length") {
        return Err(String::from("filterCrossing still dual-collects lattice_policy.deny after Admit"));
    }
    Ok(String::from("ok filterCrossing Admit collect-all then Apply only"))
}

pub fn default_filter_ts() -> PathBuf {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| String::from(".")));
    let candidates = [
        here.join("HyperlatticeFilter.ts.src"),
        here.join("../../dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
        here.join("../../../NLA-AEP-v2.8-open-source/AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
    ];
    for p in candidates {
        if p.is_file() {
            return p;
        }
    }
    here.join("HyperlatticeFilter.ts.src")
}

pub fn run_gate(filter: &Path) -> Result<i32, String> {
    let src = fs::read_to_string(filter).map_err(|e| e.to_string())?;
    let proof = filter_is_admit_then_apply(&src)?;
    println!("aep-live-crossing-admit-apply ok proof={}", proof);
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_source_is_admit_then_apply() {
        let path = default_filter_ts();
        if path.is_file() == false {
            return;
        }
        let src = fs::read_to_string(&path).unwrap_or_default();
        if src.is_empty() {
            return;
        }
        assert_eq!(filter_is_admit_then_apply(&src).is_ok(), true);
    }
}
