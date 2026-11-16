#![no_main]
//! Any bytes as a packet of the gVisor trace sink: the decoder refuses or gives an
//! event, without a panic.

use aep_caw_runtime::trace::decode_packet;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = decode_packet(data);
});
