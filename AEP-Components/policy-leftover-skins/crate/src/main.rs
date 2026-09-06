// @PAD: gap-285-p10-policy-leftover-skins-cli-v1
// @GCDE: gaplune.policy.v1
// GAP-285-P10 CLI. Print leftover files and collect-all GAP paths.

use aep_policy_leftover_skins::{
    collect_all_gap_paths, discover_policy_system_dir, leftover_paths, run_gate, COLLECT_ALL_ONLY_GAP,
    LEFTOVER_NAMING, P6_POINTER, TICKET,
};
use std::io::{self, Write};

fn main() {
    let mut out = io::stdout();
    let _ = out.write_all(b"ticket=");
    let _ = out.write_all(TICKET.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.write_all(LEFTOVER_NAMING.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.write_all(COLLECT_ALL_ONLY_GAP.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.write_all(P6_POINTER.as_bytes());
    let _ = out.write_all(b"\n");
    if let Some(dir) = discover_policy_system_dir() {
        for p in leftover_paths(&dir) {
            let _ = out.write_all(b"leftover=");
            if let Some(s) = p.to_str() {
                let _ = out.write_all(s.as_bytes());
            }
            let _ = out.write_all(b"\n");
        }
        for p in collect_all_gap_paths(&dir) {
            let _ = out.write_all(b"collect_all=");
            if let Some(s) = p.to_str() {
                let _ = out.write_all(s.as_bytes());
            }
            let _ = out.write_all(b"\n");
        }
    }
    match run_gate() {
        Ok(()) => {
            let _ = out.write_all(b"allow=true\n");
        }
        Err(e) => {
            let _ = out.write_all(b"allow=false\nclosed=");
            let _ = out.write_all(e.as_bytes());
            let _ = out.write_all(b"\n");
            std::process::exit(1);
        }
    }
}
