//! aep-ede command line. See the crate documentation and AEP-Components/ede/README.md.

use std::io::Write;

const USAGE: &str = "usage: aep-ede seed <owner/repo> [ref] | diff <draft> | scan <draft> | promote <draft> -m <message> | refresh <draft> | status <draft> | path <draft> | expire <draft>
The forge comes from AEP_EDE_FORGE: github (the default, promote needs GITHUB_TOKEN) or git (with AEP_EDE_GIT_REMOTE).";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 {
        eprintln!("{}", USAGE);
        std::process::exit(2);
    }
    let forge = aep_ede::forge::from_env();
    let draft = args[1].as_str();
    let report = match args[0].as_str() {
        "seed" => aep_ede::seed(forge.as_ref(), draft, args.get(2).map(|s| s.as_str()).unwrap_or("")),
        "diff" => aep_ede::diff(draft),
        "scan" => aep_ede::scan(draft),
        "refresh" => aep_ede::refresh(forge.as_ref(), draft),
        "status" => aep_ede::status(draft),
        "expire" => aep_ede::expire(draft),
        "path" => {
            let r = aep_ede::status(draft);
            if r.ok {
                println!("{}", r.note.split_whitespace().nth(1).unwrap_or(""));
                return;
            }
            r
        }
        "promote" => {
            let mut message = String::new();
            let mut i = 2;
            while i < args.len() {
                if args[i] == "-m" {
                    message = args.get(i + 1).cloned().unwrap_or_default();
                    i += 2;
                } else {
                    i += 1;
                }
            }
            aep_ede::promote(forge.as_ref(), draft, &message)
        }
        _ => {
            eprintln!("{}", USAGE);
            std::process::exit(2);
        }
    };
    let _ = std::io::stdout().write_all(report.render().as_bytes());
    std::process::exit(if report.ok { 0 } else { 1 });
}
