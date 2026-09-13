// @PAD: aep-named-surfaces-cli-v1
// @GCDE: gaplune-decode hmac-sha256:87584f39ab5fcefa80665514052b76fcea5a54e33a934dd64cafd5763f226804
fn main() {
    match aep_named_surfaces::run_named_surface_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
