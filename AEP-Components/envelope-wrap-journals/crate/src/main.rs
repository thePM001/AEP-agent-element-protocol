// @PAD: aep-envelope-wrap-journals-cli-v1
// @GCDE: gaplune-decode hmac-sha256:b3c4cfa53d76cef31f0ac4f3a8c68fa6c6f12f98b5685ce061ee0e177cb0a8a1
// Journals after residual wrap tickets land. Deny until AEP28-ENV-012 through AEP28-ENV-015 land.

use aep_envelope_wrap_journals::residual_wrap_journal_gate::ResidualWrapJournalGate;
use aep_envelope_wrap_journals::{
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
    let mut gate = ResidualWrapJournalGate::new();
    gate.wave = root.display().to_string();
    let verdict = run_gate(&root);
    print ! ("{}", format_verdict(&verdict));
    if verdict.allow {
        println ! ("admit_crate={}", default_admit_crate().display());
        if let Err(err) = gate.process() {
            eprintln ! ("{err}");
            process::exit(1);
        }
        process::exit(0);
    }
    if let Err(err) = gate.process() {
        eprintln ! ("{err}");
    }
    process::exit(1);
}
