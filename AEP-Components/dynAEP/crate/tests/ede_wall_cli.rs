//! The command line of the EDE lifecycle wall, as a draft environment calls it.

use std::process::Command;

const LATTICE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../registries/aep-lattice.yaml"
);

fn wall(extra: &[&str]) -> (i32, String) {
    let mut args = vec![
        "ede-wall",
        "--lattice",
        LATTICE,
        "--now",
        "100",
        "--seeded",
        "10",
        "--scanned",
        "20",
        "--sealed",
        "0",
        "--draft-max",
        "1000",
        "--scan-max",
        "1000",
        "--seal-max",
        "1000",
    ];
    args.extend_from_slice(extra);
    let o = Command::new(env!("CARGO_BIN_EXE_aep-dynaep"))
        .args(&args)
        .output()
        .unwrap_or_else(|e| panic!("run: {}", e));
    (
        o.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&o.stdout).to_string(),
    )
}

#[test]
fn the_wall_answers_allow_deny_and_usage() {
    let (code, out) = wall(&[
        "--verb",
        "scan",
        "--state",
        "seeded",
        "--satisfied",
        "ede.seed",
    ]);
    assert_eq!(code, 0, "{}", out);
    assert!(
        out.starts_with("verdict: allow\n") && out.contains("wall: dag.parents open"),
        "{}",
        out
    );
    let (code, out) = wall(&[
        "--verb",
        "promote",
        "--state",
        "scanned",
        "--satisfied",
        "ede.seed,ede.scan",
    ]);
    assert_eq!(code, 1, "{}", out);
    assert!(
        out.starts_with("verdict: deny\n")
            && out.contains("wall: dag.parents closed missing parents ede.verify"),
        "{}",
        out
    );
    let (code, _) = wall(&[
        "--verb",
        "scan",
        "--state",
        "seeded",
        "--satisfied",
        "ede.seed",
        "--colour",
        "red",
    ]);
    assert_eq!(code, 2);
    let (code, _) = wall(&["--verb", "scan", "--state", "seeded", "--now", "soon"]);
    assert_eq!(code, 2);
    let o = Command::new(env!("CARGO_BIN_EXE_aep-dynaep"))
        .args([
            "ede-wall",
            "--lattice",
            "/nonexistent.yaml",
            "--verb",
            "scan",
        ])
        .output()
        .unwrap_or_else(|e| panic!("run: {}", e));
    assert_eq!(
        o.status.code(),
        Some(2),
        "a lattice that does not load is no verdict"
    );
}
