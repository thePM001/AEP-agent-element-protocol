// @PAD: aep-lattice-gated-fetch-cli-v1
// @GCDE: gaplune-decode hmac-sha256:2b8aa8398d3c8b8fb7abb831941324fd462760caf0ef3648a695cb0e70b4d89c
// CLI: AEP28-ENV-061. After dock allow do not ordinary fetch.
fn main() {
    match aep_lattice_gated_fetch::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
