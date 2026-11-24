//! Source gate: the docking module collects post-beat Admit by digest and the UCB client
//! collects before it reads an answer as Admit. It reads the code through aep-source-check,
//! so a renamed or missing function or type fails the gate.

use aep_source_check::{workspace_path, RustSource};

/// Fail if DockRequest lacks a collect digest variant.
fn scan_dock_collect_variant(src: &RustSource) -> Result<String, String> {
    let code = src.type_item("DockRequest")?;
    if !code.contains("Collect { collect: String") {
        return Err(String::from("DockRequest lacks collect digest variant"));
    }
    Ok(String::from("ok DockRequest collect variant"))
}

/// Fail if process_request does not collect last_applied by digest.
fn scan_process_request_collect(src: &RustSource) -> Result<String, String> {
    let code = src.function("process_request")?;
    if !code.contains("DockRequest::Collect") {
        return Err(String::from("process_request does not match Collect"));
    }
    let collect = src.function("collect_applied")?;
    if !collect.contains("last_applied") {
        return Err(String::from("collect_applied does not read last_applied"));
    }
    Ok(String::from("ok process_request collects last_applied"))
}

/// Fail if UCB send_frame returns enqueue as Admit and skips collect-by-digest.
fn scan_ucb_collect(src: &RustSource) -> Result<String, String> {
    let code = src.function("send_frame")?;
    if !code.contains("\"collect\"") {
        return Err(String::from("UCB send_frame skips collect-by-digest"));
    }
    if !code.contains("event_id") {
        return Err(String::from("UCB send_frame does not inspect event_id"));
    }
    Ok(String::from("ok UCB collect-by-digest"))
}

/// Fail if the docking module no longer reads the pulse constant or skips the pulse.
fn scan_pulse_untouched(src: &RustSource) -> Result<String, String> {
    let code = src.production();
    if !code.contains("PULSE_MS") {
        return Err(String::from("docking module missing PULSE_MS"));
    }
    if code.contains("skip_pulse") {
        return Err(String::from("collect must not skip the 1000 ms pulse"));
    }
    Ok(String::from("ok pulse untouched"))
}

/// Fail if the dock connection does not wait for a collect until the beat.
fn scan_wait_collect(src: &RustSource) -> Result<String, String> {
    let wait = src.function("wait_collect_if_needed")?;
    if !wait.contains("collect_applied") {
        return Err(String::from("wait_collect_if_needed does not collect"));
    }
    let serve = src.function("serve_connection_presented")?;
    if !serve.contains("wait_collect_if_needed(") {
        return Err(String::from("serve_connection does not wait collect"));
    }
    Ok(String::from("ok wait collect until beat"))
}

fn parse(text: &str) -> RustSource {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s,
        Err(e) => panic!("sample does not parse: {e}"),
    }
}

#[test]
fn the_dock_and_ucb_collect_by_digest() -> Result<(), String> {
    let dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let dock = RustSource::read_module_dir(&dir, &["tests.rs"])?;
    let ucb = RustSource::read(&workspace_path(&[
        "AEP-Base-Node",
        "AEP-Docks",
        "ucb",
        "crate",
        "src",
        "lattice.rs",
    ])?)?;
    scan_dock_collect_variant(&dock)?;
    scan_process_request_collect(&dock)?;
    scan_ucb_collect(&ucb)?;
    scan_pulse_untouched(&dock)?;
    scan_wait_collect(&dock)?;
    Ok(())
}

#[test]
fn scan_requires_collect_variant() {
    let good = parse("enum DockRequest { Collect { collect: String, }, Ping { ping: bool } }");
    assert!(scan_dock_collect_variant(&good).is_ok());
    let bad = parse("enum DockRequest { Ping { ping: bool } }");
    assert!(scan_dock_collect_variant(&bad).is_err());
    let gone = parse("enum DockLine { Collect { collect: String } }");
    match scan_dock_collect_variant(&gone) {
        Err(e) => assert!(e.contains("type DockRequest not found")),
        Ok(v) => panic!("missing DockRequest passed: {v}"),
    }
}

#[test]
fn scan_process_request_requires_collect_arm() {
    let good = parse("pub fn process_request(r: DockRequest) { match r { DockRequest::Collect { collect } => collect_applied(&collect), _ => {} } }\nfn collect_applied(d: &str) { pulse.last_applied.get(d); }");
    assert!(scan_process_request_collect(&good).is_ok());
    let no_arm = parse("pub fn process_request(r: DockRequest) {}\nfn collect_applied(d: &str) { pulse.last_applied.get(d); }");
    assert!(scan_process_request_collect(&no_arm).is_err());
    let no_collect = parse("pub fn process_request(r: DockRequest) { DockRequest::Collect; }");
    match scan_process_request_collect(&no_collect) {
        Err(e) => assert!(e.contains("fn collect_applied not found")),
        Ok(v) => panic!("missing collect_applied passed: {v}"),
    }
}

#[test]
fn scan_ucb_requires_collect() {
    let good = parse(
        "impl Client { pub async fn send_frame() { let collect = json!({ \"collect\": digest }); resp.event_id } }",
    );
    assert!(scan_ucb_collect(&good).is_ok());
    let bad = parse("impl Client { pub async fn send_frame() { Ok(resp) } }");
    match scan_ucb_collect(&bad) {
        Err(e) => assert!(e.contains("collect")),
        Ok(v) => panic!("send_frame without collect passed: {v}"),
    }
}

#[test]
fn scan_pulse_keeps_1000() {
    assert!(scan_pulse_untouched(&parse("use aep_base_node_pulse::PULSE_MS;")).is_ok());
    assert!(
        scan_pulse_untouched(&parse("fn f() { skip_pulse(); } const P: u64 = PULSE_MS;")).is_err()
    );
    // A name in a comment is not code.
    assert!(scan_pulse_untouched(&parse("// PULSE_MS\nfn f() {}")).is_err());
}

#[test]
fn scan_wait_requires_helper() {
    let good = parse("async fn wait_collect_if_needed() { collect_applied(&rt, &d); }\nasync fn serve_connection_presented() { wait_collect_if_needed(&runtime, port, line).await; }");
    assert!(scan_wait_collect(&good).is_ok());
    let unused = parse("async fn wait_collect_if_needed() { collect_applied(&rt, &d); }\nasync fn serve_connection_presented() { process(line); }");
    assert!(scan_wait_collect(&unused).is_err());
}
