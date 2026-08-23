// @PAD: aep-envelope-algebra-ci-cli-v1
// @GCDE: gaplune-decode hmac-sha256:919070fba02421bc02fbbc73fff8c01e5860c12d746bc8a04e47d69614cdddf8
// CLI: fail if live OPA evaluate or runEvaluationChain remains on filterCrossing.
// Fail if admit.mjs or aep-admit re-grows a restricted Rego subset.

use aep_envelope_algebra_ci::live_15step_absent::Live15stepAbsent;
use aep_envelope_algebra_ci::live_opa_absent::LiveOpaAbsent;
use aep_envelope_algebra_ci::restricted_rego_absent::RestrictedRegoAbsent;
use aep_envelope_algebra_ci::{
    default_admit_js, default_admit_rs, default_filter_ts, run_gate,
};
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut filter = default_filter_ts();
    let mut js = default_admit_js();
    let mut rs = default_admit_rs();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--filter" {
            if let Some(v) = args.next() {
                filter = PathBuf::from(v);
            }
        } else if a == "--js" {
            if let Some(v) = args.next() {
                js = PathBuf::from(v);
            }
        } else if a == "--rs" {
            if let Some(v) = args.next() {
                rs = PathBuf::from(v);
            }
        }
    }
    let mut opa = LiveOpaAbsent::new();
    opa.filter_source = filter.display().to_string();
    if let Err(err) = opa.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    let mut chain = Live15stepAbsent::new();
    chain.filter_source = filter.display().to_string();
    if let Err(err) = chain.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    let mut admit_js = RestrictedRegoAbsent::new();
    admit_js.source = js.display().to_string();
    if let Err(err) = admit_js.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    let mut admit_rs = RestrictedRegoAbsent::new();
    admit_rs.source = rs.display().to_string();
    if let Err(err) = admit_rs.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    match run_gate(&filter, &js, &rs) {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
