
use aep_envelope_walls::{default_filter_ts, run_gate};
use aep_admit::default_rego_path;
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut rego = default_rego_path();
    let mut filter = default_filter_ts();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--rego" {
            if let Some(v) = args.next() {
                rego = PathBuf::from(v);
            }
        } else if a == "--filter" {
            if let Some(v) = args.next() {
                filter = PathBuf::from(v);
            }
        }
    }
    match run_gate(&rego, &filter) {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
