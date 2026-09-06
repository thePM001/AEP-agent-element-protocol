// @PAD: aep-wall-set-backpressure-cli-v1
// @GCDE: gaplune-decode hmac-sha256:ad13793624b6ff030a8a9ef87ec82ddd25671b6afe2864f91d65b0e13f9a9603
// CLI: AEP28-ENV-070 wall-set backpressure gate.
fn main() {
    match aep_wall_set_backpressure::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
