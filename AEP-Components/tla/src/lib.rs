use sha2::Digest;
use sha2::Sha256;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

pub mod tlc;

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

/// The name of the first well formed `---- MODULE Name ----` line, if any.
pub fn module_name(text: &str) -> Option<String> {
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
        let Some(rest) = inner.strip_prefix("MODULE ") else {
            continue;
        };
        let rest = rest.trim();
        if rest.is_empty() {
            continue;
        }
        if rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Some(rest.to_string());
        }
    }
    None
}

pub fn named_module(text: &str) -> bool {
    module_name(text).is_some()
}

/// The walls a model and its configuration must pass before a model check means
/// what the public text says: the deadlock check is on, the configuration names
/// at least one invariant and one temporal property and the specification states
/// a fairness condition, without which no liveness property can hold.
///
/// Returns the deny reasons, empty when the model passes every wall.
pub fn config_problems(tla_text: &str, cfg_text: Option<&str>) -> Vec<&'static str> {
    let mut problems = Vec::new();
    let Some(cfg) = cfg_text else {
        problems.push("cfg-missing");
        return problems;
    };
    let mut deadlock_on = false;
    let mut deadlock_off = false;
    let mut invariants = 0usize;
    let mut properties = 0usize;
    let mut specification = false;
    for line in cfg.lines() {
        let line = match line.find("\\*") {
            Some(at) => &line[..at],
            None => line,
        };
        let mut words = line.split_whitespace();
        let Some(key) = words.next() else {
            continue;
        };
        let value = words.next();
        match key {
            "CHECK_DEADLOCK" => match value {
                Some("TRUE") => deadlock_on = true,
                _ => deadlock_off = true,
            },
            "INVARIANT" | "INVARIANTS" => invariants += usize::from(value.is_some()),
            "PROPERTY" | "PROPERTIES" => properties += usize::from(value.is_some()),
            "SPECIFICATION" => specification = value.is_some(),
            _ => {}
        }
    }
    if deadlock_off || !deadlock_on {
        problems.push("deadlock-check-off");
    }
    if !specification {
        problems.push("no-specification");
    }
    if invariants == 0 {
        problems.push("no-invariant");
    }
    if properties == 0 {
        problems.push("no-property");
    }
    if !(tla_text.contains("WF_") || tla_text.contains("SF_")) {
        problems.push("no-fairness");
    }
    problems
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

pub fn audit_row(
    profile: &str,
    model: &str,
    tool: &str,
    verdict: &str,
    reason: &str,
    digest: &str,
) -> String {
    let mut row = String::new();
    row.push_str("profile: ");
    row.push_str(profile);
    row.push('\n');
    row.push_str("model: ");
    row.push_str(model);
    row.push('\n');
    row.push_str("tool: ");
    row.push_str(tool);
    row.push('\n');
    row.push_str("verdict: ");
    row.push_str(verdict);
    row.push('\n');
    row.push_str("reason: ");
    row.push_str(reason);
    row.push('\n');
    row.push_str("digest: ");
    row.push_str(digest);
    row.push('\n');
    row
}

/// The model files the arguments name. A path that does not exist is returned in
/// the second list, so a misspelled path denies instead of checking nothing.
fn collect_files(args: &[String]) -> (Vec<PathBuf>, Vec<String>) {
    let mut out = Vec::new();
    let mut missing = Vec::new();
    for a in args {
        let p = PathBuf::from(a);
        if p.is_file() {
            out.push(p);
        } else if p.is_dir() {
            gather_dir(&p, &mut out);
        } else {
            missing.push(a.clone());
        }
    }
    out.sort();
    (out, missing)
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
        } else if let Some(e) = p.extension() {
            if e == "tla" {
                out.push(p);
            }
        }
    }
}

fn write_audit(row: &str) {
    let dir = PathBuf::from("target").join("aep-tla-verify");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("audit.rec");
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(row.as_bytes());
    }
}

/// One line on stdout and one audit row per verdict.
fn report(profile: Profile, model: &str, tool: &str, verdict: &str, reason: &str, digest: &str) {
    println!(
        "aep-tla-verify: {model} {verdict} {reason} (profile {})",
        profile.label()
    );
    write_audit(&audit_row(
        profile.label(),
        model,
        tool,
        verdict,
        reason,
        digest,
    ));
}

/// Checks one model file. Returns true when the model passes.
fn check_model(profile: Profile, path: &Path) -> bool {
    let model = match path.file_name() {
        Some(n) => n.to_string_lossy().into_owned(),
        None => String::from("-"),
    };
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => {
            report(
                profile,
                &model,
                "aep-tla-verify",
                "deny",
                "read-failed",
                "-",
            );
            return false;
        }
    };
    let digest = digest_hex(&bytes);
    let Ok(text) = String::from_utf8(bytes) else {
        report(
            profile,
            &model,
            "aep-tla-verify",
            "deny",
            "not-utf8",
            &digest,
        );
        return false;
    };
    let Some(name) = module_name(&text) else {
        report(
            profile,
            &model,
            "aep-tla-verify",
            "deny",
            "malformed-module",
            &digest,
        );
        return false;
    };
    // TLC loads a module from the file of the same name.
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    if stem != name {
        report(
            profile,
            &model,
            "aep-tla-verify",
            "deny",
            "module-name-mismatch",
            &digest,
        );
        return false;
    }
    let cfg_text = fs::read_to_string(path.with_extension("cfg")).ok();
    let problems = config_problems(&text, cfg_text.as_deref());
    if !problems.is_empty() {
        report(
            profile,
            &model,
            "aep-tla-verify",
            "deny",
            &problems.join(","),
            &digest,
        );
        return false;
    }
    if profile == Profile::Off {
        report(
            profile,
            &model,
            "aep-tla-verify",
            "allow",
            "l0-module",
            &digest,
        );
        return true;
    }
    match tlc::check_model(path) {
        tlc::Outcome::Pass => {
            report(profile, &model, "tlc", "allow", "tlc-pass", &digest);
            true
        }
        tlc::Outcome::Missing => {
            if profile == Profile::Strict {
                report(profile, &model, "tlc", "deny", "tlc-missing", &digest);
                false
            } else {
                eprintln!("aep-tla-verify: warning: TLC is not installed, {model} was checked for shape only");
                report(profile, &model, "tlc", "allow", "tlc-missing", &digest);
                true
            }
        }
        tlc::Outcome::Fail(reason) => {
            report(profile, &model, "tlc", "deny", reason, &digest);
            false
        }
    }
}

pub fn run(args: Vec<String>) -> i32 {
    let profile = match Profile::from_env() {
        Ok(p) => p,
        Err(UnknownProfile(raw)) => {
            let row = audit_row("unknown", "-", "aep-tla-verify", "deny", &raw, "-");
            write_audit(&row);
            eprintln!("aep-tla-verify: unknown profile {raw:?}: use off, warn or strict");
            return 2;
        }
    };
    if args.is_empty() {
        eprintln!("usage: aep-tla-verify <model.tla | folder>...");
        return 2;
    }
    let (files, missing) = collect_files(&args);
    let mut denied = false;
    for m in &missing {
        report(profile, m, "aep-tla-verify", "deny", "path-missing", "-");
        denied = true;
    }
    if files.is_empty() && missing.is_empty() {
        report(profile, "-", "aep-tla-verify", "allow", "no-files", "-");
        return 0;
    }
    for path in &files {
        if !check_model(profile, path) {
            denied = true;
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

    const SPEC_FAIR: &str =
        "---- MODULE M ----\nSpec == Init /\\ [][Next]_v /\\ WF_v(Next)\n====\n";
    const CFG_GOOD: &str =
        "SPECIFICATION Spec\nINVARIANT TypeOK\nPROPERTY Live\nCHECK_DEADLOCK TRUE\n";

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
        assert_eq!(
            module_name("\\* note\n---- MODULE Foo_2 ----\n").as_deref(),
            Some("Foo_2")
        );
    }
    #[test]
    fn shape_bad() {
        assert!(!named_module("hello"));
        assert!(!named_module("---- MODULE ----"));
        assert!(!named_module("---- MODULE Foo-Bar ----"));
    }
    #[test]
    fn config_good_passes() {
        assert!(config_problems(SPEC_FAIR, Some(CFG_GOOD)).is_empty());
    }
    #[test]
    fn config_missing_denies() {
        assert_eq!(config_problems(SPEC_FAIR, None), vec!["cfg-missing"]);
    }
    #[test]
    fn deadlock_off_denies() {
        let cfg = CFG_GOOD.replace("CHECK_DEADLOCK TRUE", "CHECK_DEADLOCK FALSE");
        assert_eq!(
            config_problems(SPEC_FAIR, Some(&cfg)),
            vec!["deadlock-check-off"]
        );
        // An explicit TRUE is required, and a later FALSE still switches it off.
        let absent = CFG_GOOD.replace("CHECK_DEADLOCK TRUE\n", "");
        assert_eq!(
            config_problems(SPEC_FAIR, Some(&absent)),
            vec!["deadlock-check-off"]
        );
        let both = format!("{CFG_GOOD}CHECK_DEADLOCK FALSE\n");
        assert_eq!(
            config_problems(SPEC_FAIR, Some(&both)),
            vec!["deadlock-check-off"]
        );
    }
    #[test]
    fn commented_deadlock_line_does_not_count() {
        let cfg = CFG_GOOD.replace("CHECK_DEADLOCK TRUE", "\\* CHECK_DEADLOCK TRUE");
        assert_eq!(
            config_problems(SPEC_FAIR, Some(&cfg)),
            vec!["deadlock-check-off"]
        );
    }
    #[test]
    fn liveness_needs_property_and_fairness() {
        let no_prop = CFG_GOOD.replace("PROPERTY Live\n", "");
        assert_eq!(
            config_problems(SPEC_FAIR, Some(&no_prop)),
            vec!["no-property"]
        );
        let unfair = "---- MODULE M ----\nSpec == Init /\\ [][Next]_v\n====\n";
        assert_eq!(config_problems(unfair, Some(CFG_GOOD)), vec!["no-fairness"]);
    }
    #[test]
    fn invariant_and_spec_required() {
        let cfg = "PROPERTY Live\nCHECK_DEADLOCK TRUE\n";
        assert_eq!(
            config_problems(SPEC_FAIR, Some(cfg)),
            vec!["no-specification", "no-invariant"]
        );
    }
}
