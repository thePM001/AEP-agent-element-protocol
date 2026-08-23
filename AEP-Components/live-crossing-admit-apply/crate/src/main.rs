// @PAD: aep-live-crossing-admit-apply-cli-v1
// @GCDE: gaplune-decode hmac-sha256:43d1489197a61229f16e004a73f5f1a019aa638d96255be5d6174fba77a93f4e
// stdin walls compiled to Admit collect-all then Apply only.

use aep_live_crossing_admit_apply::{
    default_filter_ts, live_cross, parse_fixture_text, run_gate,
};
use std::env;
use std::io::{self, Read};
use std::path::PathBuf;
use std::process;

fn main() {
    let mut args = env::args().skip(1);
    let mut filter: Option<PathBuf> = None;
    while let Some(a) = args.next() {
        if a == "--filter" {
            if let Some(v) = args.next() {
                filter = Some(PathBuf::from(v));
            }
        } else if a == "--gate" {
            let path = filter.unwrap_or_else(default_filter_ts);
            match run_gate(&path) {
                Ok(code) => process::exit(code),
                Err(err) => {
                    eprintln!("{err}");
                    process::exit(1);
                }
            }
        }
    }
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let input = parse_fixture_text(&buf);
    let mut hits = 0;
    let result = live_cross(input, &mut hits);
    println!("allow={}", result.allow);
    println!("applied={}", result.applied);
}
