//! Source gate: neither the docking module of the Base Node nor read_line_limited of this
//! crate awaits one byte at a time. The dock reads its lines with this crate. It reads
//! the code through aep-source-check, so a renamed or missing function fails the gate.

use std::path::PathBuf;

use aep_source_check::{workspace_path, CodeText, RustSource};

/// Fail if the code still awaits one byte at a time up to the 4MiB cap.
fn scan_no_one_byte_await(code: &CodeText) -> Result<String, String> {
    if code.contains("[0u8; 1]") {
        return Err(String::from(
            "dock line reader still uses a one-byte buffer",
        ));
    }
    if code.contains("read(&mut byte)") {
        return Err(String::from("dock line reader still awaits one byte"));
    }
    if code.contains("read_u8(") {
        return Err(String::from(
            "dock line reader still awaits one byte via read_u8",
        ));
    }
    Ok(String::from("ok dock line reader does not await one byte"))
}

/// Fail if the code neither reads with fill_buf and consume nor uses read_line_limited of
/// this crate.
fn scan_fill_buf_consume(code: &CodeText) -> Result<String, String> {
    if code.contains("aep_dock_line_reader") && code.contains("read_line_limited(") {
        return Ok(String::from(
            "ok dock line reader uses aep_dock_line_reader fill_buf consume",
        ));
    }
    if code.contains("fill_buf()") && code.contains(".consume(") {
        return Ok(String::from(
            "ok dock line reader uses fill_buf and consume",
        ));
    }
    Err(String::from(
        "dock line reader does not fill_buf and consume",
    ))
}

fn function(text: &str, name: &str) -> CodeText {
    match RustSource::parse("sample.rs", text).and_then(|s| s.function(name)) {
        Ok(f) => f,
        Err(e) => panic!("sample: {e}"),
    }
}

fn production(text: &str) -> CodeText {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s.production(),
        Err(e) => panic!("sample: {e}"),
    }
}

#[test]
fn the_dock_and_this_crate_read_lines_in_chunks() -> Result<(), String> {
    let dock_dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let dock = RustSource::read_module_dir(&dock_dir, &["tests.rs"])?.production();
    let lib = RustSource::read(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("lib.rs"),
    )?;
    let reader = lib.function("read_line_limited")?;
    scan_no_one_byte_await(&dock)?;
    scan_fill_buf_consume(&dock)?;
    scan_no_one_byte_await(&reader)?;
    scan_fill_buf_consume(&reader)?;
    Ok(())
}

#[test]
fn a_one_byte_buffer_fails() {
    let bad = function(
        "async fn read_line_limited() { let mut byte = [0u8; 1]; reader.read(&mut byte).await; }",
        "read_line_limited",
    );
    match scan_no_one_byte_await(&bad) {
        Err(e) => assert!(e.contains("one-byte")),
        Ok(v) => panic!("one-byte buffer passed: {v}"),
    }
    let comment_only = function(
        "async fn read_line_limited() {\n    // let mut byte = [0u8; 1];\n    reader.fill_buf().await; reader.consume(1);\n}",
        "read_line_limited",
    );
    assert!(scan_no_one_byte_await(&comment_only).is_ok());
}

#[test]
fn a_reader_without_fill_buf_fails() {
    let bad = function(
        "async fn read_line_limited() { let mut byte = [0u8; 1]; }",
        "read_line_limited",
    );
    match scan_fill_buf_consume(&bad) {
        Err(e) => assert!(e.contains("fill_buf")),
        Ok(v) => panic!("reader without fill_buf passed: {v}"),
    }
}

#[test]
fn a_dock_that_uses_this_crate_passes() {
    let good = production(
        "use aep_dock_line_reader::{read_line_limited, MAX_LINE_BYTES};\nasync fn serve() { let line = read_line_limited(&mut reader, MAX_LINE_BYTES).await; }",
    );
    match scan_fill_buf_consume(&good) {
        Ok(v) => assert!(v.contains("aep_dock_line_reader")),
        Err(e) => panic!("crate use failed: {e}"),
    }
    assert!(scan_no_one_byte_await(&good).is_ok());
}
