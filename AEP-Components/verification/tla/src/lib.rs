use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile {
    Off,
    Warn,
    Strict,
}

pub struct UnknownProfile(pub String);

impl Profile {
    pub fn from_env() -> Result<Self, UnknownProfile> {
        let raw = std::env::var("AEP_TLA_PROFILE").unwrap_or_default();
        Self::parse(&raw)
    }
    pub fn parse(raw: &str) -> Result<Self, UnknownProfile> {
        let t = raw.trim().to_ascii_lowercase();
        if t.is_empty() || t == "off" {
            return Ok(Profile::Off);
        }
        if t == "warn" {
            return Ok(Profile::Warn);
        }
        if t == "strict" {
            return Ok(Profile::Strict);
        }
        Err(UnknownProfile(t))
    }
    pub fn label(self) -> &'static str {
        if matches!(self, Profile::Off) {
            return "off";
        }
        if matches!(self, Profile::Warn) {
            return "warn";
        }
        "strict"
    }
}

pub fn named_module(text: &str) -> bool {
    for line in text.lines() {
        let t = line.trim();
        if t.len() < 12 {
            continue;
        }
        if !t.starts_with("----") {
            continue;
        }
        if !t.ends_with("----") {
            continue;
        }
        let inner = t.trim_matches('-').trim();
        if !inner.starts_with("MODULE ") {
            continue;
        }
        let rest = inner[7..].trim();
        if rest.is_empty() {
            continue;
        }
        let mut ok = true;
        for c in rest.chars() {
            if !(c.is_ascii_alphanumeric() || c == '_') {
                ok = false;
            }
        }
        if ok {
            return true;
        }
    }
    false
}

fn digest_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    let mut s = String::new();
    for b in out {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

pub fn audit_row(profile: &str, model: &str, tool: &str, verdict: &str, reason: &str, digest: &str) -> String {
    let mut row = String::new();
    row.push_str("profile: ");
    row.push_str(profile);
    row.push_str("\n");
    row.push_str("model: ");
    row.push_str(model);
    row.push_str("\n");
    row.push_str("tool: ");
    row.push_str(tool);
    row.push_str("\n");
    row.push_str("verdict: ");
    row.push_str(verdict);
    row.push_str("\n");
    row.push_str("reason: ");
    row.push_str(reason);
    row.push_str("\n");
    row.push_str("digest: ");
    row.push_str(digest);
    row.push_str("\n");
    row
}

fn collect_files(args: &[String]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if args.is_empty() {
        return out;
    }
    for a in args {
        let p = PathBuf::from(a);
        if p.is_file() {
            out.push(p);
        } else if p.is_dir() {
            gather_dir(&p, &mut out);
        }
    }
    out
}

fn gather_dir(dir: &Path, out: &mut Vec<PathBuf>) {
    let rd = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for ent in rd {
        let ent = match ent {
            Ok(v) => v,
            Err(_) => continue,
        };
        let p = ent.path();
        if p.is_dir() {
            gather_dir(&p, out);
        } else {
            match p.extension() {
                Some(e) => {
                    if e == "tla" {
                        out.push(p);
                    }
                }
                None => {}
            }
        }
    }
}

fn write_audit(row: &str) {
    let dir = PathBuf::from("target").join("aep-tla-verify");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("audit.gaplune");
    match fs::OpenOptions::new().create(true).append(true).open(path) {
        Ok(mut f) => {
            let _ = f.write_all(row.as_bytes());
        }
        Err(_) => {}
    }
}
pub fn run(args: Vec<String>) -> i32 {
    let profile = match Profile::from_env() {
        Ok(p) => p,
        Err(UnknownProfile(raw)) => {
            let row = audit_row("unknown", "-", "aep-tla-verify", "deny", &raw, "-");
            write_audit(&row);
            return 2;
        }
    };
    let files = collect_files(&args);
    if files.is_empty() {
        let row = audit_row(profile.label(), "-", "aep-tla-verify", "allow", "no-files", "-");
        write_audit(&row);
        return 0;
    }
    let mut denied = false;
    for path in &files {
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => {
                denied = true;
                continue;
            }
        };
        let digest = digest_hex(&bytes);
        let text = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => {
                denied = true;
                continue;
            }
        };
        let model = match path.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => String::from("-"),
        };
        if named_module(&text) {
            let row = audit_row(profile.label(), &model, "aep-tla-verify", "allow", "l0-module", &digest);
            write_audit(&row);
        } else {
            denied = true;
            let row = audit_row(profile.label(), &model, "aep-tla-verify", "deny", "malformed-module", &digest);
            write_audit(&row);
        }
    }

    if denied {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_values() {
        assert!(Profile::parse("").ok() == Some(Profile::Off));
        assert!(Profile::parse("off").ok() == Some(Profile::Off));
        assert!(Profile::parse("warn").ok() == Some(Profile::Warn));
        assert!(Profile::parse("strict").ok() == Some(Profile::Strict));
        assert!(Profile::parse("nope").is_err());
    }
    #[test]
    fn shape_ok() {
        assert!(named_module("---- MODULE Foo ----\n"));
    }
    #[test]
    fn shape_bad() {
        assert!(!named_module("hello"));
        assert!(!named_module("---- MODULE ----"));
    }
}
