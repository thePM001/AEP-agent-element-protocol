// @PAD: aep-base-node-pulse-cli-v1
// @GCDE: gaplune-decode hmac-sha256:ddc268f216c624cd04055c3a8fed5c8ed0f08b2e2bbb97374bd4963f4fe8e060
// CLI: AEP28-ENV-065 Base Node 1000 ms tic tac pulse gate.
fn main() {
    match aep_base_node_pulse::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
