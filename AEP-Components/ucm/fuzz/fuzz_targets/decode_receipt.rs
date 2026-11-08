#![no_main]
//! Any bytes as a receipt: verification refuses without a panic. No fuzzed receipt can be
//! trusted, since no key is trusted here.

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(v) = serde_json::from_slice::<serde_json::Value>(data) else {
        return;
    };
    if let Ok(c) = aep_ucm_receipt::verify_signature(&v, &[]) {
        assert!(!c.trusted);
    }
});
