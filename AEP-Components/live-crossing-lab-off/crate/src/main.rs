// @PAD: aep-live-crossing-lab-off-cli-v1
// @GCDE: gaplune-decode hmac-sha256:e3dc2cd2da9b4fa7fe17eae1853f63ceb9b76b48ecec5b480430032b40318720
// CLI: fail if HyperlatticeFilter.filterCrossing still calls latticeFilter.filterAsync when AEP_LAB_LATTICE_FILTER is on.

use aep_live_crossing_lab_off::live_lab_filter_absent::LiveLabFilterAbsent;
use aep_live_crossing_lab_off::{default_filter_ts, run_gate};
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut filter = default_filter_ts();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--filter" {
            if let Some(v) = args.next() {
                filter = PathBuf::from(v);
            }
        }
    }
    let mut gate = LiveLabFilterAbsent::new();
    gate.filter_source = filter.display().to_string();
    if let Err(err) = gate.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    match run_gate(&filter) {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
