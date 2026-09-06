// @PAD: aep-policy-system-admit-cli-v1
// @GCDE: gaplune-decode hmac-sha256:550dd0b80916ad8bf3925e60fe606fa95da9a748c51a4bb92978604037f4f20b
// CLI: AEP28-ENV-056 load AEP-Policy-System GAP files as live Admit walls.
fn main() {
    match aep_policy_system_admit::run_gate() {
        Ok(_) => std::process::exit(0),
        Err(e) => {
            let _ = std::io::Write::write_all(&mut std::io::stderr(), e.as_bytes());
            let _ = std::io::Write::write_all(&mut std::io::stderr(), b"\n");
            std::process::exit(1);
        }
    }
}
