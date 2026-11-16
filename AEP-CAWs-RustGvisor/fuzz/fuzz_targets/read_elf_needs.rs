#![no_main]
//! Any bytes as a program file: the reader of program needs refuses or reads, without
//! a panic and without a read past the end of the file.

use aep_caw_runtime::elf::read_needs;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = read_needs(data);
});
