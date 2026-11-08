#![no_main]
//! Any text: the parser either refuses it or gives a program whose text form parses back
//! to the same tree. Evaluation under a small budget never panics.

use aep_ucm_core::{evaluate, parse::parse_program, Library, Limits};
use libfuzzer_sys::fuzz_target;
use std::sync::OnceLock;

fn lib() -> &'static Library {
    static L: OnceLock<Library> = OnceLock::new();
    L.get_or_init(|| Library::builtin().expect("library"))
}

fuzz_target!(|data: &[u8]| {
    let Ok(src) = std::str::from_utf8(data) else { return };
    let Ok(p) = parse_program(src) else { return };
    let again = parse_program(&p.to_text()).expect("printed program must parse");
    assert_eq!(aep_ucm_core::program_hash(&p).ok(), aep_ucm_core::program_hash(&again).ok());
    let small = Limits {
        steps: 20_000,
        bits: 4_096,
        len: 1_000,
        millis: 200,
    };
    let _ = evaluate(&p, &serde_json::json!({}), small, lib());
});
