//! Source gate: the production docking module of the Base Node returns ok false on a
//! poisoned lock and never aborts on one. It reads the module through aep-source-check, so
//! a renamed or missing function fails the gate.

use aep_source_check::{workspace_path, RustSource};

/// Fail if the production docking module still takes a lock with expect or unwrap, or
/// recovers the inner state of a poisoned lock.
fn scan_prod_no_lock_expect(src: &RustSource) -> Result<String, String> {
    let prod = src.production();
    if prod.contains(".lock().expect") {
        return Err(String::from(
            "production dock request path still uses lock expect",
        ));
    }
    if prod.contains(".lock().unwrap()") {
        return Err(String::from(
            "production dock request path still uses lock unwrap",
        ));
    }
    if prod.contains(".lock().unwrap_or_else") && prod.contains("into_inner") {
        return Err(String::from(
            "production dock request path still recovers poisoned inner state",
        ));
    }
    Ok(String::from(
        "ok production dock request path does not abort on lock",
    ))
}

/// Fail if the dock request path does not return ok false on poisoned locks.
fn scan_ok_false_on_poison(src: &RustSource) -> Result<String, String> {
    src.function("process_request")?;
    let prod = src.production();
    if !prod.contains("poisoned_lock_response") && !prod.contains("poisoned_lock_message") {
        return Err(String::from(
            "dock request path does not name poisoned lock ok false",
        ));
    }
    if !prod.contains("lock_or_poison") && !prod.contains("lock_or_deny") {
        return Err(String::from(
            "dock request path does not map poisoned locks",
        ));
    }
    if !prod.contains("ok: false") {
        return Err(String::from("dock request path does not return ok false"));
    }
    Ok(String::from(
        "ok dock request path returns ok false on poisoned locks",
    ))
}

fn parse(text: &str) -> RustSource {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s,
        Err(e) => panic!("sample does not parse: {e}"),
    }
}

#[test]
fn the_docking_module_returns_ok_false_on_poisoned_locks() -> Result<(), String> {
    let dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let src = RustSource::read_module_dir(&dir, &["tests.rs"])?;
    scan_prod_no_lock_expect(&src)?;
    scan_ok_false_on_poison(&src)?;
    Ok(())
}

#[test]
fn lock_expect_fails() {
    let bad = "pub fn process_request() { let db = runtime.record.db.lock().expect(\"db lock\"); }";
    match scan_prod_no_lock_expect(&parse(bad)) {
        Err(e) => assert!(e.contains("lock expect")),
        Ok(v) => panic!("lock expect passed: {v}"),
    }
}

#[test]
fn lock_in_tests_or_comments_passes() {
    let good = "pub fn process_request() {\n    // runtime.record.db.lock().expect(\"in a comment\")\n    let db = dock_lock!(&runtime.record.db, \"db\");\n}\n#[cfg(test)]\nmod tests {\n    fn t() { let db = runtime.record.db.lock().expect(\"db lock\"); }\n}";
    assert!(scan_prod_no_lock_expect(&parse(good)).is_ok());
}

#[test]
fn a_missing_process_request_fails() {
    match scan_ok_false_on_poison(&parse("fn other() {}")) {
        Err(e) => assert!(e.contains("fn process_request not found")),
        Ok(v) => panic!("missing process_request passed: {v}"),
    }
}

#[test]
fn ok_false_on_poison_passes() {
    let good = "pub fn process_request() { let db = lock_or_deny(&runtime.record.db, \"db\"); }\nfn poisoned_lock_response(n: &str) -> DockFrameResponse { DockFrameResponse { ok: false, error: Some(poisoned_lock_message(n)) } }";
    assert!(scan_ok_false_on_poison(&parse(good)).is_ok());
}
