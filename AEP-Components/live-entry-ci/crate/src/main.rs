// @PAD: aep-live-entry-ci-cli-v1
// @GCDE: gaplune.policy.v1
fn main() {
    match aep_live_entry_ci::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
