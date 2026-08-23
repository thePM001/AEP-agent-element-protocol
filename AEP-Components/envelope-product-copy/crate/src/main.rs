// @PAD: aep-envelope-product-copy-cli-v1
// @GCDE: gaplune-decode hmac-sha256:89cafd1e14bc19409c8975306135c8ad4b2f645ecc6d5affdd42499adf64f0df
// CLI: scan named files. Live copy must name Admit collect-all walls then Apply
// and must not sell 15-step as live. CHANGELOG.md historical lines stay.

use aep_envelope_product_copy::rewrite_file;
use aep_envelope_product_copy::rewrite_tree;
use aep_envelope_product_copy::scan_paths::ScanPaths;
use std::env;
use std::io::{self, Write};
use std::process;

fn write_err(msg: &str) {
    let mut err = io::stderr();
    let _ = err.write_all(msg.as_bytes());
    let _ = err.write_all(b"\n");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(|s| s.as_str()) == Some("rewrite-tree") {
        let root = match args.get(2) {
            Some(r) => r,
            None => {
                write_err("rewrite-tree requires a repository root");
                process::exit(2);
            }
        };
        match rewrite_tree(root) {
            Ok(denied) => process::exit(denied),
            Err(e) => {
                write_err(&e);
                process::exit(2);
            }
        }
    }
    if args.get(1).map(|s| s.as_str()) == Some("rewrite") {
        let mut failed = 0i32;
        for path in args.iter().skip(2) {
            match rewrite_file(path) {
                Ok(_) => {}
                Err(e) => {
                    write_err(&e);
                    failed += 1;
                }
            }
        }
        process::exit(failed);
    }
    let parsed = match ScanPaths::parse(&args) {
        Ok(p) => p,
        Err(e) => {
            write_err(&e);
            process::exit(2);
        }
    };
    let runner = ScanPaths::from_args(&parsed);
    match runner.run() {
        Ok(denied) => process::exit(denied),
        Err(e) => {
            write_err(&e);
            process::exit(2);
        }
    }
}
