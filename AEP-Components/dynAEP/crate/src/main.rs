// CLI: standalone dynAEP. YAML lattice plus event on stdin.
use aep_dynaep::{DynAep, ProcessOut};
use serde_json::Value;
use std::env;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process;
fn emit_err(msg: &str) {
    let _ = std::io::stderr().write_all(msg.as_bytes());
    let _ = std::io::stderr().write_all(b"\n");
}
fn emit_out(msg: &str) {
    let _ = std::io::stdout().write_all(msg.as_bytes());
    let _ = std::io::stdout().write_all(b"\n");
}
/// aep-dynaep ede-wall: the EDE lifecycle wall. Every argument is
/// a flag with a value; an unknown flag, a missing value or a lattice that does not load
/// is a usage error with exit 2. The answer is a verdict line and one line per wall,
/// exit 0 for allow and 1 for deny.
fn ede_wall(args: &[String]) -> i32 {
    use aep_dynaep::ede::{ede_wall, render, EdeRequest};
    let mut lattice = PathBuf::new();
    let mut req = EdeRequest {
        verb: String::new(),
        state: String::new(),
        satisfied: Default::default(),
        now: 0,
        seeded: 0,
        scanned: 0,
        sealed: 0,
        draft_max: 0,
        scan_max: 0,
        seal_max: 0,
    };
    let mut i = 0;
    while i < args.len() {
        let v = match args.get(i + 1) {
            Some(v) => v.clone(),
            None => {
                emit_err(&format!("ede-wall: {} needs a value", args[i]));
                return 2;
            }
        };
        let num = |v: &str| v.parse::<u64>().ok();
        let ok = match args[i].as_str() {
            "--lattice" => {
                lattice = PathBuf::from(&v);
                true
            }
            "--verb" => {
                req.verb = v.clone();
                true
            }
            "--state" => {
                req.state = v.clone();
                true
            }
            "--satisfied" => {
                req.satisfied = v
                    .split(',')
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect();
                true
            }
            "--now" => num(&v).map(|n| req.now = n).is_some(),
            "--seeded" => num(&v).map(|n| req.seeded = n).is_some(),
            "--scanned" => num(&v).map(|n| req.scanned = n).is_some(),
            "--sealed" => num(&v).map(|n| req.sealed = n).is_some(),
            "--draft-max" => num(&v).map(|n| req.draft_max = n).is_some(),
            "--scan-max" => num(&v).map(|n| req.scan_max = n).is_some(),
            "--seal-max" => num(&v).map(|n| req.seal_max = n).is_some(),
            _ => false,
        };
        if !ok {
            emit_err(&format!("ede-wall: bad flag or value {} {}", args[i], v));
            return 2;
        }
        i += 2;
    }
    let nodes = match aep_dynaep::load_lattice_yaml_file(&lattice) {
        Ok(n) => n,
        Err(e) => {
            emit_err(&format!("ede-wall: lattice {}: {}", lattice.display(), e));
            return 2;
        }
    };
    let result = ede_wall(&nodes, &req);
    let _ = std::io::stdout().write_all(render(&result).as_bytes());
    if result.allow {
        0
    } else {
        1
    }
}

fn main() {
    let all: Vec<String> = env::args().skip(1).collect();
    if all.first().map(|a| a == "ede-wall").unwrap_or(false) {
        process::exit(ede_wall(&all[1..]));
    }
    let mut yaml_path = PathBuf::from("");
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--yaml" {
            if let Some(v) = args.next() {
                yaml_path = PathBuf::from(v);
            }
        }
    }
    let mut dyna = if !yaml_path.as_os_str().is_empty() {
        match DynAep::from_yaml_file(&yaml_path) {
            Ok(v) => v,
            Err(e) => {
                emit_err(&e);
                process::exit(1);
            }
        }
    } else {
        DynAep::new()
    };
    let mut buf = String::new();
    match std::io::stdin().read_to_string(&mut buf) {
        Ok(_) => {}
        Err(e) => {
            emit_err(&e.to_string());
            process::exit(1);
        }
    }
    let event: Value = match serde_json::from_str(&buf) {
        Ok(v) => v,
        Err(e) => {
            emit_err(&e.to_string());
            process::exit(1);
        }
    };
    match dyna.process_event(event) {
        ProcessOut::Event(v) => {
            emit_out(&v.to_string());
            process::exit(0);
        }
        ProcessOut::Reject(r) => {
            let mut m = serde_json::Map::new();
            m.insert(
                String::from("dynaep_type"),
                Value::String(String::from("DYNAEP_REJECTION")),
            );
            m.insert(String::from("target_id"), Value::String(r.target_id));
            m.insert(String::from("error"), Value::String(r.error));
            emit_out(&Value::Object(m).to_string());
            process::exit(1);
        }
    }
}
