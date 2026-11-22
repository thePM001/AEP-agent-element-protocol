//! The core builds for `wasm32-wasip2`.
//!
//! The test builds this crate for that target with the toolchain that runs the test.
//! It needs the target of the toolchain, so it is ignored in a plain test run and the
//! CI job for WASM runs it with `--ignored`. A toolchain without the target fails the
//! test: it never passes without a build.
use std::path::PathBuf;
use std::process::Command;

const TARGET: &str = "wasm32-wasip2";

#[test]
#[ignore = "needs the wasm32-wasip2 target of the toolchain; the CI job for WASM runs it"]
fn core_builds_wasm32_wasip2() {
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| String::from("cargo"));
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    // A folder of its own, so the build waits for no lock of the build that runs this test.
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("core-wasm32-wasip2");
    let output = Command::new(cargo)
        .arg("build")
        .arg("--manifest-path")
        .arg(&manifest)
        .arg("--target")
        .arg(TARGET)
        .arg("--target-dir")
        .arg(&out)
        .arg("--locked")
        .output()
        .expect("cargo starts");
    assert!(
        output.status.success(),
        "the core does not build for {TARGET}:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let library = out
        .join(TARGET)
        .join("debug")
        .join("libaep_lattice_memory_core.rlib");
    assert!(library.is_file(), "no library at {}", library.display());
}
