// @PAD: aep-process-event-admit-walls-cli-v1
// @GCDE: gaplune-decode hmac-sha256:b513f93ada33543c733e64905c83d2508162a5bb843b7676452e4454f17d33d5
// CLI: fail if processEvent still has lab latticeFilter.filter or filterAsync with no Admit walls.

use aep_process_event_admit_walls::{default_bridge_ts, run_gate};
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
    if let Err(err) = run_gate(&bridge) {
        eprintln!("{err}");
        process::exit(1);
    }
    process::exit(0);
}
