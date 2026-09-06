// @PAD: aep-unbound-field-close-cli-v1
// @GCDE: gaplune-decode hmac-sha256:615cf338f18f3708585d0278d6bb15e18b1d30b83dfde8b3cdbe9c45cbdbe3a1
// CLI: AEP28-ENV-066 unbound field close gate.
fn main() {
    match aep_unbound_field_close::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
