// @PAD: aep-admit-channel-order-walls-cli-v1
// @GCDE: gaplune-decode hmac-sha256:1f6d134b766c19e7dc857cb9da49651ce3cdc26f44a9c332c5a5eadb00c35e3e
// CLI: stdin channel plus order records compiled to Admit walls then collect-all.

use aep_admit_channel_order_walls::{
    default_filter_ts, fold_channel_order_into_admit, parse_channel_from_text, parse_extra_walls,
    parse_order_from_text, run_gate,
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
