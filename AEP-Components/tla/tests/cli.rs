use std::path::{Path, PathBuf};
use std::process::Command;

/// A folder of one test under the temp dir. It is removed when the test ends, so a run
/// leaves nothing behind, and the checker runs inside it, so its audit file lands there.
struct Scratch(PathBuf);

impl Scratch {
    fn new(tag: &str) -> Self {
        let d = std::env::temp_dir().join(format!("aep-tla-cli-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        if let Err(e) = std::fs::create_dir_all(&d) {
            panic!("{}: {e}", d.display());
        }
        Scratch(d)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn write(&self, name: &str, body: &str) {
        let p = self.0.join(name);
        if let Err(e) = std::fs::write(&p, body) {
            panic!("{}: {e}", p.display());
        }
    }

    // Cargo builds the binary for integration tests and names its path, whatever the
    // target dir is.
    fn bin(&self) -> Command {
        let mut c = Command::new(env!("CARGO_BIN_EXE_aep-tla-verify"));
        c.current_dir(&self.0);
        c
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const GOOD_TLA: &str = "---- MODULE Good ----\nVARIABLES x\nInit == x = 0\nNext == x' = 1 - x\nSpec == Init /\\ [][Next]_x /\\ WF_x(Next)\nTypeOK == x \\in {0, 1}\nFlips == []<>(x = 1)\n====\n";
const GOOD_CFG: &str =
    "SPECIFICATION Spec\nINVARIANT TypeOK\nPROPERTY Flips\nCHECK_DEADLOCK TRUE\n";

#[test]
fn profile_off_no_files_exits_0() {
    let d = Scratch::new("empty");
    let models = d.path().join("models");
    std::fs::create_dir_all(&models).expect("mkdir");
    let st = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg(&models)
        .status()
        .expect("run");
    assert_eq!(st.code(), Some(0));
}

#[test]
fn no_arguments_is_a_usage_error() {
    let d = Scratch::new("usage");
    let st = d.bin().env("AEP_TLA_PROFILE", "off").status().expect("run");
    assert_eq!(st.code(), Some(2));
}

#[test]
fn missing_path_denies() {
    let d = Scratch::new("missing");
    let st = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg("/nonexistent/aep-tla-model.tla")
        .status()
        .expect("run");
    assert_eq!(st.code(), Some(1));
}

#[test]
fn unknown_profile_nonzero() {
    let d = Scratch::new("profile");
    let st = d
        .bin()
        .env("AEP_TLA_PROFILE", "bogus")
        .arg(".")
        .status()
        .expect("run");
    assert_ne!(st.code(), Some(0));
}

#[test]
fn malformed_tla_nonzero_on_off() {
    let d = Scratch::new("bad");
    d.write("bad.tla", "not a module\n");
    let st = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg("bad.tla")
        .status()
        .expect("run");
    assert_ne!(st.code(), Some(0));
}

#[test]
fn good_model_passes_on_off() {
    let d = Scratch::new("good");
    d.write("Good.tla", GOOD_TLA);
    d.write("Good.cfg", GOOD_CFG);
    let st = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg("Good.tla")
        .status()
        .expect("run");
    assert_eq!(st.code(), Some(0));
}

#[test]
fn deadlock_check_off_denies_on_every_profile() {
    let d = Scratch::new("nodeadlock");
    d.write("Good.tla", GOOD_TLA);
    d.write(
        "Good.cfg",
        &GOOD_CFG.replace("CHECK_DEADLOCK TRUE", "CHECK_DEADLOCK FALSE"),
    );
    let out = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg("Good.tla")
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stdout).contains("deadlock-check-off"));
}

#[test]
fn module_name_must_match_the_file() {
    let d = Scratch::new("name");
    d.write("Other.tla", GOOD_TLA);
    d.write("Other.cfg", GOOD_CFG);
    let out = d
        .bin()
        .env("AEP_TLA_PROFILE", "off")
        .arg("Other.tla")
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stdout).contains("module-name-mismatch"));
}

#[test]
fn strict_without_tlc_denies() {
    let d = Scratch::new("strict");
    d.write("Good.tla", GOOD_TLA);
    d.write("Good.cfg", GOOD_CFG);
    // No PATH and no named tool or jar: TLC cannot be found.
    let out = d
        .bin()
        .env_clear()
        .env("AEP_TLA_PROFILE", "strict")
        .env("AEP_TLA_TLC_JAR", "/nonexistent/tla2tools.jar")
        .arg("Good.tla")
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stdout).contains("tlc-missing"));
}

#[test]
fn warn_without_tlc_passes_with_a_warning() {
    let d = Scratch::new("warn");
    d.write("Good.tla", GOOD_TLA);
    d.write("Good.cfg", GOOD_CFG);
    let out = d
        .bin()
        .env_clear()
        .env("AEP_TLA_PROFILE", "warn")
        .env("AEP_TLA_TLC_JAR", "/nonexistent/tla2tools.jar")
        .arg("Good.tla")
        .output()
        .expect("run");
    assert_eq!(out.status.code(), Some(0));
    assert!(String::from_utf8_lossy(&out.stderr).contains("warning"));
}
