// CLI: stdin channel plus order records compiled to Admit walls then collect-all.
// `--gate` runs the fold self-check on a fixed frame instead.

use aep_admit_channel_order_walls::{
    fold_channel_order_into_admit, parse_channel_from_text, parse_extra_walls,
    parse_order_from_text, run_gate,
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
    let channel = parse_channel_from_text(&buf);
    let order = parse_order_from_text(&buf);
    let extra = parse_extra_walls(&buf);
    let result = fold_channel_order_into_admit(&channel, &order, &extra);
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
    print!("{}", out);
}
