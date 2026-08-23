// @PAD: aep-admit-parity-cli-v1
// @GCDE: gaplune.policy.v1

use aep_admit_parity::run_parity::RunParity;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let parsed = match RunParity::parse(&args) {
        Ok(v) => v,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };
    let runner = RunParity::from_args(&parsed);
    match runner.run() {
        Ok(code) => std::process::exit(code),
        Err(err) => {
            eprintln!("{err:#}");
            std::process::exit(2);
        }
    }
}
