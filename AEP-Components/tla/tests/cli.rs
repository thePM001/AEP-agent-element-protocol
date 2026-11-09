use std::process::Command;

// Cargo builds the binary for integration tests and names its path, whatever the target dir is.
fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_aep-tla-verify"))
}

#[test]
fn profile_off_no_files_exits_0() {
    let d = std::env::temp_dir().join("aep-tla-empty-dir");
    let _ = std::fs::create_dir_all(&d);
    let st = bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg(&d)
        .status()
        .expect("run");
    assert_eq!(st.code(), Some(0));
}

#[test]
fn unknown_profile_nonzero() {
    let st = bin().env("AEP_TLA_PROFILE", "bogus").status().expect("run");
    assert_ne!(st.code(), Some(0));
}

#[test]
fn malformed_tla_nonzero_on_off() {
    let d = std::env::temp_dir().join("aep-tla-bad-dir");
    let _ = std::fs::create_dir_all(&d);
    let f = d.join("bad.tla");
    std::fs::write(&f, "not a module\n").expect("write");
    let st = bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg(&f)
        .status()
        .expect("run");
    assert_ne!(st.code(), Some(0));
}
