// stdin temporal records compiled to Admit walls then collect-all. Soft warn stays warn.
// `--gate` runs the fold self-check on fixed inputs instead.

use aep_admit_temporal_bounds::{
    compile_temporal_warns, fold_temporal_into_admit, parse_extra_walls, parse_temporal_from_text,
    run_gate,
};
use std::env;
use std::io::{self, Read};
use std::process;

fn main() {
    if env::args().skip(1).any(|a| a == "--gate") {
        match run_gate() {
            Ok(code) => process::exit(code),
            Err(err) => {
                eprintln!("{err}");
                process::exit(1);
            }
        }
    }
    let mut buf = String::new();
    if let Err(err) = io::stdin().read_to_string(&mut buf) {
        eprintln!("stdin read failed: {err}");
        std::process::exit(1);
    }
    let temporal = parse_temporal_from_text(&buf);
    let extra = parse_extra_walls(&buf);
    let result = fold_temporal_into_admit(&temporal, &extra);
    let warns = compile_temporal_warns(&temporal);
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    for warn in &warns {
        out.push_str("warn=");
        out.push_str(warn);
        out.push('\n');
    }
    print!("{}", out);
}
