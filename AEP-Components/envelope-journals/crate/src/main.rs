// @PAD: aep-envelope-journals-cli-v1
// @GCDE: gaplune-decode hmac-sha256:c03753d1128c1fc7386ce1577c4fbabbe1ac294bfcf1188615bbf6f1de69dbce
// CLI: journals after product tickets land. Deny until AEP28-ENV-001 through AEP28-ENV-010 land.

use aep_envelope_journals::journal_gate::JournalGate;
use aep_envelope_journals::{
    default_admit_crate, default_components_root, format_verdict, run_gate,
};
use std::env;
use std::path::PathBuf;
use std::process;

fn main() {
    let mut root = default_components_root();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--root" {
            if let Some(v) = args.next() {
                root = PathBuf::from(v);
            }
        }
    }
    let mut gate = JournalGate::new();
    gate.wave = root.display().to_string();
    let verdict = run_gate(&root);
    print!("{}", format_verdict(&verdict));
    if verdict.allow {
        println!("admit_crate={}", default_admit_crate().display());
        if let Err(err) = gate.process() {
            eprintln!("{err:#}");
            process::exit(1);
        }
        process::exit(0);
    }
    if let Err(err) = gate.process() {
        eprintln!("{err:#}");
    }
    process::exit(1);
}
