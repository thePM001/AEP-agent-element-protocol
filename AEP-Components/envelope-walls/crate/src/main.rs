use aep_admit::default_rego_path;
use aep_envelope_walls::run_gate;
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut rego = default_rego_path();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--rego" {
            if let Some(v) = args.next() {
                rego = PathBuf::from(v);
            }
        }
    }
    match run_gate(&rego) {
        Ok(code) => process::exit(code),
        Err(err) => {
            eprintln!("{err}");
            process::exit(1);
        }
    }
}
