// @PAD: aep-admit-temporal-bounds-cli-v1
// @GCDE: gaplune-decode hmac-sha256:b478d503a6842ab07413e7268f7c2ef74fb5f5e348059a3dcfd911e126da8cd9
// stdin temporal records compiled to Admit walls then collect-all. Soft warn stays warn.

use aep_admit_temporal_bounds::{
    compile_temporal_warns, default_filter_ts, fold_temporal_into_admit, parse_extra_walls,
    parse_temporal_from_text, run_gate,
};
use std::env;
use std::io::{self, Read};
use std::path::PathBuf;
use std::process;

fn main() {
    let mut args = env::args().skip(1);
    let mut filter: Option<PathBuf> = None;
    while let Some(a) = args.next() {
        if a == "--filter" {
            if let Some(v) = args.next() {
                filter = Some(PathBuf::from(v));
            }
        } else if a == "--gate" {
            let path = filter.unwrap_or_else(default_filter_ts);
            match run_gate(&path) {
                Ok(code) => process::exit(code),
                Err(err) => {
                    eprintln!("{err}");
                    process::exit(1);
                }
            }
        }
    }
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let temporal = parse_temporal_from_text(&buf);
    let extra = parse_extra_walls(&buf);
    let result = fold_temporal_into_admit(&temporal, &extra);
    let warns = compile_temporal_warns(&temporal);
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push_str("\n");
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push_str("\n");
    }
    for warn in &warns {
        out.push_str("warn=");
        out.push_str(warn);
        out.push_str("\n");
    }
    print!("{}", out);
}

