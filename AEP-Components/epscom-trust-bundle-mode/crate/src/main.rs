// @PAD: aep-epscom-trust-bundle-mode-cli-v1
// @GCDE: gaplune-decode hmac-sha256:96a05cbc159c9d3a0447bab26b0f26849d1f5a3c1dbe7486e7f258fa46b6d201
fn main() {
    match aep_epscom_trust_bundle_mode::run_trust_bundle_mode_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
