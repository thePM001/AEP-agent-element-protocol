// @PAD: aep-python-sdk-path-cli-v1
// @GCDE: gaplune-decode hmac-sha256:6e28019aecf807c7b36efb74bcf2f8689d34a6ff75af3c893cf4510528c9747b
fn main() {
    match aep_python_sdk_path::run_python_sdk_path_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
