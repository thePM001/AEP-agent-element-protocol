// @PAD: aep-live-entry-cli-v1
// @GCDE: gaplune.policy.v1
// CLI: AEP28-ENV-024 live entry. YAML lattice plus event on stdin.
use aep_live_entry::{LiveEntry, ProcessOut};
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
fn main() {
    let mut yaml_path = PathBuf::from("");
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--yaml" {
            if let Some(v) = args.next() { yaml_path = PathBuf::from(v); }
        }
    }
    let mut le = if yaml_path.as_os_str().is_empty() == false {
        match LiveEntry::from_yaml_file(&yaml_path) {
            Ok(v) => v,
            Err(e) => { emit_err(&e); process::exit(1); }
        }
    } else {
        LiveEntry::new()
    };
    let mut buf = String::new();
    match std::io::stdin().read_to_string(&mut buf) {
        Ok(_) => {}
        Err(e) => { emit_err(&e.to_string()); process::exit(1); }
    }
    let event: Value = match serde_json::from_str(&buf) {
        Ok(v) => v,
        Err(e) => { emit_err(&e.to_string()); process::exit(1); }
    };
    match le.process_event(event) {
        ProcessOut::Event(v) => { emit_out(&v.to_string()); process::exit(0); }
        ProcessOut::Reject(r) => {
            let mut m = serde_json::Map::new();
            m.insert(String::from("dynaep_type"), Value::String(String::from("DYNAEP_REJECTION")));
            m.insert(String::from("target_id"), Value::String(r.target_id));
            m.insert(String::from("error"), Value::String(r.error));
            emit_out(&Value::Object(m).to_string());
            process::exit(1);
        }
    }
}
