// @PAD: aep-admit-opa-sole-cli-v1
// @GCDE: gaplune-decode hmac-sha256:d7273d19c2faf4c8c41fe30ae4b743f7562d6cd0df43755de4585bb449643449

use aep_admit_opa_sole::restricted_fragment_scan::RestrictedFragmentScan;
use aep_admit_opa_sole::opa_sole_proof::OpaSoleProof;
use aep_admit_opa_sole::{
    default_admit_js, default_admit_rs, default_filter_ts, default_opa_policy, run_gate,
};
use clap::Parser;
use std::path::PathBuf;

#[derive(Debug, Parser)]
struct Args {
    /// Path to admit.mjs
    #[arg(long)]
    js: Option<String>,
    /// Path to aep-admit crate lib.rs
    #[arg(long)]
    rs: Option<String>,
    /// Path to lattice-policy.rego
    #[arg(long)]
    opa: Option<String>,
    /// Path to HyperlatticeFilter.ts
    #[arg(long)]
    filter: Option<String>,
}

fn main() {
    let args = Args::parse();
    let js = args
        .js
        .map(PathBuf::from)
        .unwrap_or_else(default_admit_js);
    let rs = args
        .rs
        .map(PathBuf::from)
        .unwrap_or_else(default_admit_rs);
    let opa = args
        .opa
        .map(PathBuf::from)
        .unwrap_or_else(default_opa_policy);
    let filter = args
        .filter
        .map(PathBuf::from)
        .unwrap_or_else(default_filter_ts);

    let mut scan = RestrictedFragmentScan::new();
    match std::fs::read_to_string(&js) {
        Ok(src) => scan.source = src,
        Err(err) => {
            eprintln!("admit.mjs read failed: {err}");
            std::process::exit(2);
        }
    }
    if let Err(err) = scan.process() {
        eprintln!("{err:#}");
        std::process::exit(1);
    }

    let mut proof = OpaSoleProof::new();
    proof.policy_path = opa.display().to_string();
    if let Err(err) = proof.process() {
        eprintln!("{err:#}");
        std::process::exit(1);
    }

    match run_gate(&js, &rs, &opa, &filter) {
        Ok(code) => std::process::exit(code),
        Err(err) => {
            eprintln!("{err:#}");
            std::process::exit(2);
        }
    }
}
