// @PAD: aep-one-admit-id-cli-v1
// @GCDE: gaplune-decode hmac-sha256:a17097a41a00e185a9e75595aac4c8fbfc2f7cae1cbdc548bf35daf4f82990d9
// CLI: the earlier law change one Admit function and one id vocabulary gate.
fn main() {
    match aep_one_admit_id::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
