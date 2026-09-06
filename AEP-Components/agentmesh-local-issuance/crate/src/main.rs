// @PAD: aep-agentmesh-local-issuance-cli-v1
// @GCDE: gaplune-decode hmac-sha256:eb8592d9fea883071329debfde1c5f65ba5e13a05f264a92d6177c6c195e29a5
fn main() {
    match aep_agentmesh_local_issuance::run_local_issuance_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
