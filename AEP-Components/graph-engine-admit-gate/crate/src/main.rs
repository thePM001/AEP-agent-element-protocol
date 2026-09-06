// @PAD: aep-graph-engine-admit-gate-cli-v1
// @GCDE: gaplune-decode hmac-sha256:0b0ebb948f4e645f8496f19736350782f652b3ed8fdb2ea2f4a29b12b377241a
// CLI: AEP28-ENV-069 GraphEngine admitGate before nodeExecutor.
fn main() {
    match aep_graph_engine_admit_gate::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
