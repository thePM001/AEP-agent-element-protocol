// @PAD: aep-one-live-evaluation-cli-v1
// @GCDE: gaplune-decode hmac-sha256:115db0ea8965777b6809965c71d2c898a7da12b87f5315d93c95021dedacf5cc
// CLI: AEP28-ENV-037 one live evaluation dual-combinator gate.
fn main() {
    match aep_one_live_evaluation::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
