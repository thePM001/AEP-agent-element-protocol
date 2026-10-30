use std::path::PathBuf;
use std::process::Command;

fn bin() -> Command {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("..");
    p.push("..");
    p.push("..");
    p.push("rust");
    p.push("target");
    p.push("debug");
    p.push("aep-tla-verify");
    Command::new(p)
}

#[test]
fn profile_off_no_files_exits_0() {
    let d = std::env::temp_dir().join("aep-tla-empty-dir");
    let _ = std::fs::create_dir_all(&d);
    let st = bin().env("AEP_TLA_PROFILE", "off").arg(&d).status().expect("run");
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
    let st = bin().env("AEP_TLA_PROFILE", "off").arg(&f).status().expect("run");
    assert_ne!(st.code(), Some(0));
}
