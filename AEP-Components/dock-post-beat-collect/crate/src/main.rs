// @PAD: aep-dock-post-beat-collect-cli-v1
// @GCDE: gaplune-decode hmac-sha256:8a3068fb058a6d3cc15fc083e1bcc70897169a87d050ce2a56baf8fc9b0fdd92
// CLI: AEP28-ENV-071 dock post-beat collect gate.
fn main() {
    match aep_dock_post_beat_collect::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
