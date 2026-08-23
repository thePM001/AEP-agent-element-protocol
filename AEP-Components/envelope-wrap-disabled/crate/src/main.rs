// @PAD: aep-envelope-wrap-disabled-cli-v1
// @GCDE: gaplune-decode hmac-sha256:e783bcf380141ed235701f2a324370511e07ab5fe37e2551a0d352f6e9fe9413
// CLI: fail if bridge.ts skips the wrap when lattice governance is disabled.

use aep_envelope_wrap_disabled::wrap_on_disabled_governance::WrapOnDisabledGovernance;
use aep_envelope_wrap_disabled::{default_bridge_ts, run_gate};
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut bridge = default_bridge_ts();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--bridge" {
            if let Some(v) = args.next() {
                bridge = PathBuf::from(v);
            }
        }
    }
    let mut wrap = WrapOnDisabledGovernance::new();
    wrap.bridge_source = bridge.display().to_string();
    if let Err(err) = wrap.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    match run_gate(&bridge) {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
