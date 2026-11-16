#![no_main]
//! Any text as a profile record: the parser refuses or gives a record. A record that
//! parses compiles or is refused, both without a panic.

use aep_caw_policy::plan::{compile, Variables};
use aep_caw_policy::record::parse_record;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(record) = parse_record(text) else { return };
    let vars = Variables::new()
        .with("PROJECT_ROOT", "/home/agent/project")
        .with("HOME", "/home/agent")
        .with("AEP_MODEL_GATEWAY_HOST", "gateway.example.com");
    let _ = compile(&record, &vars);
});
