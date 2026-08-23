//! CLI entry for aep-hyperlattice-ssot
//! @GCDE: gaplune.policy.v1

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let parsed = match aep_hyperlattice_ssot::ssot_gate::SsotGate::parse(&args) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(2);
        }
    };
    let gate = aep_hyperlattice_ssot::ssot_gate::SsotGate::from_args(&parsed);
    match gate.run() {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(2);
        }
    }
}