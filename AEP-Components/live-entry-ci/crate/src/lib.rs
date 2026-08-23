// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:ad29234bbeaa66ab8cc6fad39f9547d9ee120ad5f33d2c34d0519e8f052b9c07
// crate: aep-live-entry-ci
// tokens: 0
// HVVCAS: live_entry_ci domain:envelope type:service
use std::fs;
use std::path::PathBuf;
fn extract_process_event(src: &str) -> String {
    let start = match src.find("async processEvent") {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let bytes = rest.as_bytes();
    let mut brace_at = 0usize;
    let mut found = false;
    let mut j = 0usize;
    while j < rest.len() {
        if rest.as_bytes()[j] == 123u8 { brace_at = j; found = true; break; }
        j = j.saturating_add(1);
    }
    if found == false { return String::new(); }
    let mut i = brace_at;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == 123u8 { depth = depth.saturating_add(1); }
        if c == 125u8 {
            depth = depth.saturating_sub(1);
            if depth == 0 { return rest[..=i].to_string(); }
        }
        i = i.saturating_add(1);
    }
    String::new()
}
fn decomment_js(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0usize;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        if mode == 4 {
            if c == b'\n' { out.push(c); mode = 0; }
        } else if mode == 5 {
            if c == b'*' && n == b'/' { mode = 0; i = i.saturating_add(2); continue; }
        } else if mode == 0 && c == b'/' && n == b'/' {
            mode = 4; i = i.saturating_add(2); continue;
        } else if mode == 0 && c == b'/' && n == b'*' {
            mode = 5; i = i.saturating_add(2); continue;
        } else {
            out.push(c);
            if c == b'\\' && (mode == 1 || mode == 2 || mode == 3) {
                if i + 1 < bytes.len() { out.push(bytes[i + 1]); }
                i = i.saturating_add(2); continue;
            }
            if (mode == 1 && c == b'\'') || (mode == 2 && c == b'"') || (mode == 3 && c == b'`' && tmpl_expr == 0) { mode = 0; }
            else if mode == 3 && c == b'$' && n == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); out.push(n); i = i.saturating_add(2); continue; }
            else if mode == 3 && tmpl_expr >= 1 && c == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); }
            else if mode == 3 && tmpl_expr >= 1 && c == b'}' { tmpl_expr = tmpl_expr.saturating_sub(1); }
            else if mode == 0 && c == b'\'' { mode = 1; }
            else if mode == 0 && c == b'"' { mode = 2; }
            else if mode == 0 && c == b'`' { mode = 3; tmpl_expr = 0; }
        }
        i = i.saturating_add(1);
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn collapse_ws(src: &str) -> String { src.chars().filter(|c| c.is_whitespace() == false).collect() }
fn scan_code(body: &str) -> String { collapse_ws(&decomment_js(body)) }
pub fn scan_live(src: &str) -> Result<String, String> {
    let body = extract_process_event(src);
    if body.is_empty() { return Err(String::from("processEvent not found")); }
    let code = scan_code(&body);
    if code.contains("spawnSync") { return Err(String::from("processEvent still calls spawnSync")); }
    if code.contains("loadFromFile") { return Err(String::from("processEvent still calls loadFromFile")); }
    if code.contains("processStateDelta") { return Err(String::from("processEvent still calls processStateDelta")); }
    if code.contains("processDynAEPEvent") { return Err(String::from("processEvent still calls processDynAEPEvent")); }
    Ok(String::from("ok typescript processEvent is not product live path"))
}
pub fn default_bridge() -> PathBuf {
    let mut live = PathBuf::from(".");
    if let Ok(d) = std::env::var("CARGO_MANIFEST_DIR") {
        live = PathBuf::from(d);
    }
    live.join("../../../AEP-SDKs/typescript/dynaep/src/bridge.ts")
}
pub fn run_gate() -> Result<i32, String> {
    let live = default_bridge();
    if live.is_file() == false { return Err(String::from("live source missing")); }
    let src = match fs::read_to_string(&live) {
        Ok(v) => v,
        Err(e) => return Err(e.to_string()),
    };
    let proof = match scan_live(&src) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut msg = String::from("aep-live-entry-ci ok proof=");
    msg.push_str(&proof);
    let _ = std::io::Write::write_all(&mut std::io::stdout(), msg.as_bytes());
    let _ = std::io::Write::write_all(&mut std::io::stdout(), b"\n");
    Ok(0)
}
pub mod live_entry_ci {
    pub struct LiveEntryCi { pub bridge_source: String, pub scan: String }
    impl LiveEntryCi {
        pub fn new() -> Self { Self { bridge_source: String::new(), scan: String::new() } }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_live(&self.bridge_source) {
                Ok(v) => { self.scan = v; Ok(()) }
                Err(e) => Err(anyhow::Error::msg(e)),
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn must(cond: bool) { if cond == false { std::process::abort(); } }
    #[test]
    fn spawn_fails() {
        let src = "class X { async processEvent(e) { spawnSync('aep-envelope'); } }";
        must(scan_live(src).is_err());
    }
    #[test]
    fn state_delta_fails() {
        let src = "class X { async processEvent(e) { this.processStateDelta(e); } }";
        must(scan_live(src).is_err());
    }
    #[test]
    fn dyna_fails() {
        let src = "class X { async processEvent(e) { this.processDynAEPEvent(e); } }";
        must(scan_live(src).is_err());
    }
    #[test]
    fn load_fails() {
        let src = "class X { async processEvent(e) { lattice.loadFromFile(p); } }";
        must(scan_live(src).is_err());
    }
    #[test]
    fn comment_ok() {
        let src = "class X { async processEvent(e) { // spawnSync loadFromFile processStateDelta processDynAEPEvent\n return e; } }";
        must(scan_live(src).is_ok());
    }
}
