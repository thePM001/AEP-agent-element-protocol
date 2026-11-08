#![no_main]
//! Any bytes as the JSON program form: decoding refuses or gives a program whose JSON form
//! decodes back to the same tree.

use aep_ucm_core::Program;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(data) else {
        return;
    };
    let Ok(p) = Program::from_json(&v) else { return };
    let back = Program::from_json(&p.to_json()).expect("encoded program must decode");
    assert_eq!(p, back);
});
