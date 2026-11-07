use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;

pub fn tlc_required(strict: bool) -> bool {
    if strict {
        return true;
    }
    std::env::var("AEP_TLA_REQUIRE_TLC").ok().as_deref() == Some("1")
}

pub fn tlc_available() -> bool {
    if std::env::var("AEP_TLA_TLC_FORCE_MISSING").ok().as_deref() == Some("1") {
        return false;
    }
    find_tlc().is_some()
}

enum TlcCmd {
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

fn find_tlc() -> Option<TlcCmd> {
    if let Ok(raw) = std::env::var("AEP_TLA_TLC") {
        let p = PathBuf::from(raw);
        if p.is_file() {
            return Some(TlcCmd::Bin(p));
        }
    }
    if let Some(p) = which_bin("tlc") {
        return Some(TlcCmd::Bin(p));
    }
    if let Some(p) = which_bin("tlc2") {
        return Some(TlcCmd::Bin(p));
    }
    let java = which_bin("java")?;
    let jar = if let Ok(j) = std::env::var("AEP_TLA_TLC_JAR") {
        PathBuf::from(j)
    } else if let Ok(j) = std::env::var("TLA2TOOLS_JAR") {
        PathBuf::from(j)
    } else {
        let opt = PathBuf::from("/opt/tla/tla2tools.jar");
        if opt.is_file() {
            opt
        } else {
            PathBuf::from("/usr/share/java/tla2tools.jar")
        }
    };
    if !jar.is_file() {
        return None;
    }
    Some(TlcCmd::Jar { java, jar })
}

fn sibling_cfg(tla: &Path) -> PathBuf {
    let mut cfg = tla.to_path_buf();
    cfg.set_extension("cfg");
    cfg
}

pub fn run_model(tla: &Path) -> Result<(), String> {
    let cmd = match find_tlc() {
        Some(c) => c,
        None => return Err(String::from("tlc-missing")),
    };
    if !tla.is_file() {
        return Err(String::from("tla-missing"));
    }
    let dir = match tla.parent() {
        Some(d) => d.to_path_buf(),
        None => PathBuf::from("."),
    };
    let cfg = sibling_cfg(tla);
    let tmp = dir.join(".aep-tla-default.cfg");
    let cfg_path = if cfg.is_file() {
        cfg
    } else {
        let body = "SPECIFICATION Spec\nCHECK_DEADLOCK FALSE\n";
        if std::fs::write(&tmp, body).is_err() {
            return Err(String::from("cfg-write-failed"));
        }
        tmp
    };
    let file_name = match tla.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        None => return Err(String::from("tla-name")),
    };
    let output = match spawn_tlc(cmd, &cfg_path, &file_name, &dir) {
        Ok(o) => o,
        Err(e) => return Err(e),
    };
    classify_tlc(output)
}

fn spawn_tlc(cmd: TlcCmd, cfg_path: &Path, file_name: &str, dir: &Path) -> Result<std::process::Output, String> {
    let output = match cmd {
        TlcCmd::Bin(bin) => Command::new(bin)
            .arg("-config")
            .arg(cfg_path)
            .arg("-workers")
            .arg("1")
            .arg("-cleanup")
            .arg(file_name)
            .current_dir(dir)
            .stdin(Stdio::null())
            .output(),
        TlcCmd::Jar { java, jar } => Command::new(java)
            .arg("-cp")
            .arg(&jar)
            .arg("tlc2.TLC")
            .arg("-config")
            .arg(cfg_path)
            .arg("-workers")
            .arg("1")
            .arg("-cleanup")
            .arg(file_name)
            .current_dir(dir)
            .stdin(Stdio::null())
            .output(),
    };
    match output {
        Ok(o) => Ok(o),
        Err(_) => Err(String::from("tlc-exec")),
    }
}

fn classify_tlc(output: std::process::Output) -> Result<(), String> {
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    text.push('\n');
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    if text.contains("No error has been found") {
        return Ok(());
    }
    if text.contains("Model checking completed") {
        if !text.contains("Error") {
            return Ok(());
        }
    }
    if output.status.success() {
        if !text.contains("Error") {
            return Ok(());
        }
    }
    if text.contains("Invariant") {
        return Err(String::from("tlc-invariant"));
    }
    Err(String::from("tlc-failed"))
}
