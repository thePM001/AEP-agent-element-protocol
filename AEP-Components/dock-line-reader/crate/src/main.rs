// @PAD: aep-dock-line-reader-cli-v1
// @GCDE: gaplune-decode hmac-sha256:c7a5bde171368ad75ecb4f65d65e64a03bb6687e937a073199a57e7ac0700016
// CLI: AEP28-ENV-053 dock line reader gate. Do not await one byte up to 4MiB.
fn main() {
    match aep_dock_line_reader::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
