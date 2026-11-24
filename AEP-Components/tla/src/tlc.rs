//! Runs the TLC model checker on one model with the configuration beside it.
//!
//! TLC is found in this order: the program that `AEP_TLA_TLC` names, `tlc` or
//! `tlc2` on PATH, then `java` on PATH with the jar that `AEP_TLA_TLC_JAR` or
//! `TLA2TOOLS_JAR` names, `/opt/tla/tla2tools.jar` or
//! `/usr/share/java/tla2tools.jar`.

use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    /// TLC explored every reachable state and found no violation.
    Pass,
    /// No TLC program could be found.
    Missing,
    /// TLC ran and did not pass. The reason names the class of the failure.
    Fail(&'static str),
}

enum Tool {
    Bin(PathBuf),
    Jar { java: PathBuf, jar: PathBuf },
}

fn which_bin(name: &str) -> Option<PathBuf> {
    let path = std::env::var("PATH").ok()?;
    for dir in path.split(':') {
        if dir.is_empty() {
            continue;
        }
        let p = PathBuf::from(dir).join(name);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn find_tool() -> Option<Tool> {
    if let Ok(raw) = std::env::var("AEP_TLA_TLC") {
        let p = PathBuf::from(raw);
        if p.is_file() {
            return Some(Tool::Bin(p));
        }
    }
    if let Some(p) = which_bin("tlc").or_else(|| which_bin("tlc2")) {
        return Some(Tool::Bin(p));
    }
    let java = which_bin("java")?;
    let named = std::env::var("AEP_TLA_TLC_JAR")
        .ok()
        .or_else(|| std::env::var("TLA2TOOLS_JAR").ok())
        .map(PathBuf::from);
    let jar = match named {
        Some(j) => j,
        None => [
            PathBuf::from("/opt/tla/tla2tools.jar"),
            PathBuf::from("/usr/share/java/tla2tools.jar"),
        ]
        .into_iter()
        .find(|p| p.is_file())?,
    };
    if !jar.is_file() {
        return None;
    }
    Some(Tool::Jar { java, jar })
}

/// True when a TLC program can be found.
pub fn available() -> bool {
    find_tool().is_some()
}

/// Classify the output of one TLC run. A violation wins over every other text, so a
/// run that reports a violation never passes.
pub fn classify(success: bool, text: &str) -> Outcome {
    if text.contains("Deadlock reached") {
        return Outcome::Fail("tlc-deadlock");
    }
    if text.contains("Temporal properties were violated") {
        return Outcome::Fail("tlc-liveness");
    }
    if text.contains(" is violated") {
        return Outcome::Fail("tlc-safety");
    }
    if success && text.contains("Model checking completed. No error has been found.") {
        return Outcome::Pass;
    }
    Outcome::Fail("tlc-failed")
}

/// Model check `tla` with the sibling `.cfg`. The state folder of TLC goes to a
/// fresh folder under the temp dir and is removed after the run.
pub fn check_model(tla: &Path) -> Outcome {
    let Some(tool) = find_tool() else {
        return Outcome::Missing;
    };
    let Some(dir) = tla.parent() else {
        return Outcome::Fail("tlc-path");
    };
    let dir = if dir.as_os_str().is_empty() {
        Path::new(".")
    } else {
        dir
    };
    let Some(file_name) = tla.file_name() else {
        return Outcome::Fail("tlc-path");
    };
    let cfg = tla.with_extension("cfg");
    let Some(cfg_name) = cfg.file_name() else {
        return Outcome::Fail("tlc-path");
    };
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let meta =
        std::env::temp_dir().join(format!("aep-tla-verify-{}-{}", std::process::id(), stamp));
    let mut cmd = match tool {
        Tool::Bin(bin) => Command::new(bin),
        Tool::Jar { java, jar } => {
            let mut c = Command::new(java);
            c.arg("-cp").arg(jar).arg("tlc2.TLC");
            c
        }
    };
    let output = cmd
        .arg("-config")
        .arg(cfg_name)
        .arg("-workers")
        .arg("1")
        .arg("-cleanup")
        .arg("-metadir")
        .arg(&meta)
        .arg(file_name)
        .current_dir(dir)
        .stdin(Stdio::null())
        .output();
    let _ = std::fs::remove_dir_all(&meta);
    let Ok(output) = output else {
        return Outcome::Fail("tlc-exec");
    };
    let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    classify(output.status.success(), &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn violations_never_pass() {
        let done = "Model checking completed. No error has been found.";
        assert_eq!(classify(true, done), Outcome::Pass);
        assert_eq!(classify(false, done), Outcome::Fail("tlc-failed"));
        assert_eq!(
            classify(true, &format!("Error: Deadlock reached.\n{done}")),
            Outcome::Fail("tlc-deadlock")
        );
        assert_eq!(
            classify(false, "Error: Invariant TypeOK is violated."),
            Outcome::Fail("tlc-safety")
        );
        assert_eq!(
            classify(false, "Error: Action property P is violated."),
            Outcome::Fail("tlc-safety")
        );
        assert_eq!(
            classify(false, "Error: Temporal properties were violated."),
            Outcome::Fail("tlc-liveness")
        );
        assert_eq!(classify(false, "Parse error"), Outcome::Fail("tlc-failed"));
    }
}
