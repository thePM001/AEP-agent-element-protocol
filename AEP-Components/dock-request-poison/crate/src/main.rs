// @PAD: aep-dock-request-poison-cli-v1
// @GCDE: gaplune-decode hmac-sha256:51b44641c50993fa411406a0562967e5c38f5420ba7f220c86e6066dc17990be
// CLI: AEP28-ENV-048 dock request poisoned lock gate.
fn main() {
    match aep_dock_request_poison::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
