//! aep-ede command line. See the crate documentation and AEP-Components/ede/README.md.

use std::io::Write;

const USAGE: &str = "usage: aep-ede seed <owner/repo> [branch] | diff <draft> | scan <draft> | promote <draft> -m <message> | refresh <draft> | status <draft> | path <draft> | expire <draft>
       aep-ede profile init <agent-id> <owner/repo>... | profile check | agent keygen <seed-file> | agent register <agent-id> <public-hex> | sweep | ledger-check
Every verb proves the agent of AEP_AGENT_ID with the signing seed in the file AEP_AGENT_KEY against the key the operator registered.
Every control (forge, roots, quota, age bounds) comes from the operator folder /etc/aep-ede.";

fn usage() -> ! {
    eprintln!("{}", USAGE);
    std::process::exit(2);
}

fn refuse(e: &str) -> ! {
    eprintln!("refused: {}", e);
    std::process::exit(1);
}

fn main() {
    aep_ede::privilege::init();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        usage();
    }
    match args[0].as_str() {
        "profile" => {
            let op = aep_ede::operator::load();
            if let Some(why) = &op.broken {
                refuse(why);
            }
            match args.get(1).map(|s| s.as_str()) {
                Some("init") if args.len() >= 4 => {
                    match aep_ede::profile::init(&op, &args[2], &args[3..]) {
                        Ok(p) => println!("profile: {}", p.display()),
                        Err(e) => refuse(&e),
                    }
                }
                Some("check") => {
                    let agent = std::env::var("AEP_AGENT_ID").unwrap_or_default();
                    match aep_ede::profile::load(&op, &agent) {
                        Ok(p) => println!("{}", p.summary()),
                        Err(e) => refuse(&e),
                    }
                }
                _ => usage(),
            }
            return;
        }
        "agent" => {
            match (args.get(1).map(|s| s.as_str()), args.get(2), args.get(3)) {
                (Some("keygen"), Some(file), None) => {
                    use std::os::unix::fs::OpenOptionsExt;
                    let (secret, public) = aep_ede::identity::keygen();
                    let written = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .mode(0o600)
                        .open(file)
                        .and_then(|mut f| f.write_all(format!("{}\n", secret).as_bytes()));
                    if let Err(e) = written {
                        refuse(&format!("{}: {}", file, e));
                    }
                    println!("seed: {}", file);
                    println!("public: {}", public);
                    println!(
                        "next: the operator runs aep-ede agent register <agent-id> {}",
                        public
                    );
                }
                (Some("register"), Some(agent), Some(public)) => {
                    let op = aep_ede::operator::load();
                    if let Some(why) = &op.broken {
                        refuse(why);
                    }
                    match aep_ede::profile::register(&op, agent, public) {
                        Ok(p) => println!("registered: {}", p.display()),
                        Err(e) => refuse(&e),
                    }
                }
                _ => usage(),
            }
            return;
        }
        "sweep" => {
            let lines = aep_ede::sweep();
            let refused = lines.iter().any(|l| l.starts_with("refused:"));
            for l in lines {
                println!("{}", l);
            }
            std::process::exit(if refused { 1 } else { 0 });
        }
        "ledger-check" => {
            let op = aep_ede::operator::load();
            if let Some(why) = &op.broken {
                refuse(why);
            }
            match aep_ede::store::verify_ledger(&op) {
                Ok(n) => println!("ledger: {} entries, chain and seals verify", n),
                Err(e) => refuse(&format!("ledger: {}", e)),
            }
            return;
        }
        _ => {}
    }
    if args.len() < 2 {
        usage();
    }
    let draft = args[1].as_str();
    let report = match args[0].as_str() {
        "seed" => aep_ede::seed(draft, args.get(2).map(|s| s.as_str()).unwrap_or("")),
        "diff" => aep_ede::diff(draft),
        "scan" => aep_ede::scan(draft),
        "refresh" => aep_ede::refresh(draft),
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
            aep_ede::promote(draft, &message)
        }
        _ => usage(),
    };
    let _ = std::io::stdout().write_all(report.render().as_bytes());
    std::process::exit(if report.ok { 0 } else { 1 });
}
