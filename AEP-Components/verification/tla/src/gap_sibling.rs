use std::path::Path;
use std::path::PathBuf;
pub enum FieldRead {
    Absent,
    Present(String),
}
pub fn field_name() -> &'static str {
    "tla_plus"
}
pub fn read_field(text: &str) -> FieldRead {
    for line in text.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        match take_json(t) {
            Some(v) => return FieldRead::Present(v),
            None => {}
        }
        match take_yaml(t) {
            Some(v) => return FieldRead::Present(v),
            None => {}
        }
    }
    FieldRead::Absent
}
fn take_json(t: &str) -> Option<String> {
    let k = "\"tla_plus\"";
    if !t.starts_with(k) {
        return None;
    }
    let r = t[k.len()..].trim();
    if r.is_empty() {
        return None;
    }
    if r.as_bytes()[0] != 58 {
        return None;
    }
    clean(&r[1..])
}
fn take_yaml(t: &str) -> Option<String> {
    let k = "tla_plus:";
    if !t.starts_with(k) {
        return None;
    }
    clean(&t[k.len()..])
}
fn clean(raw: &str) -> Option<String> {
    let t = raw.trim().trim_end_matches(',').trim();
    let n = t.len();
    let inner = strip_quotes(t, n);
    let p = inner.trim();
    if bad_path(p) {
        return None;
    }
    Some(String::from(p))
}
fn strip_quotes(t: &str, n: usize) -> &str {
    if n < 2 {
        return t;
    }
    let b = t.as_bytes();
    if b[0] == 34 && b[n - 1] == 34 {
        return &t[1..n - 1];
    }
    if b[0] == 39 && b[n - 1] == 39 {
        return &t[1..n - 1];
    }
    t
}
fn bad_path(p: &str) -> bool {
    if p.is_empty() {
        return true;
    }
    if p.starts_with('/') {
        return true;
    }
    if p.contains("..") {
        return true;
    }
    if p.contains('\\') {
        return true;
    }
    if !p.ends_with(".tla") {
        return true;
    }
    false
}
pub fn resolve(gap: &Path, rel: &str) -> PathBuf {
    match gap.parent() {
        Some(d) => d.join(rel),
        None => PathBuf::from(rel),
    }
}
pub fn from_gap_file(gap: &Path) -> FieldRead {
    match std::fs::read_to_string(gap) {
        Ok(t) => read_field(&t),
        Err(_) => FieldRead::Absent,
    }
}
