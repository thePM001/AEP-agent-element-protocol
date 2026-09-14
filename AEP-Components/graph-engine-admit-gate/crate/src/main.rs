// CLI: the earlier law change GraphEngine admitGate before nodeExecutor.
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
