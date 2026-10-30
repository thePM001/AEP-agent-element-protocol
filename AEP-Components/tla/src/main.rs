fn main() {
    let code = aep_tla_verify::run(std::env::args().skip(1).collect());
    std::process::exit(code);
}
