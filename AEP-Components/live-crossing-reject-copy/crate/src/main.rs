// @PAD: aep-live-crossing-reject-copy-cli-v1
// @GCDE: gaplune-decode hmac-sha256:fb547fc736705233e96ac6644016af64b89f49f2ca2b4b91fa7ddbc040fcd98b
// CLI: fail if live processEvent rejection still says Admit then OPA.

use aep_live_crossing_reject_copy::live_reject_copy::LiveRejectCopy;
use aep_live_crossing_reject_copy::{default_bridge_ts, run_gate};
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
    let mut wrap = LiveRejectCopy::new();
    wrap.bridge_source = bridge.display().to_string();
    if let Err(err) = wrap.process() {
        eprintln!("{err:#}");
        process::exit(1);
    }
    if let Err(err) = run_gate(&bridge) {
        eprintln!("{err}");
        process::exit(1);
    }
    process::exit(0);
}
