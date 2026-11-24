//! Source gate: the docking module of the Base Node executes the bound request of an
//! allowed gateway event and reads a gateway request only through the gateway path check
//! of this crate. It reads the module through aep-source-check, so a renamed or missing
//! item fails the gate.
//!
//! The client half has no text check. lattice-channels/lib/lattice-gated-fetch.ts is the
//! one source of the client and the lint rules of the repository refuse every fetch bypass
//! in it. Its vitest suite runs it against a test dock with a built-in fetch that throws.

use aep_source_check::{workspace_path, RustSource};

fn scan_dock_attaches_bound_http(dock: &RustSource) -> Result<(), String> {
    let prod = dock.production();
    if !prod.contains("execute_bound_http_after_allow") {
        return Err(String::from(
            "the dock allow path does not execute the bound http",
        ));
    }
    if !prod.contains("gateway_request_of") && !prod.contains("gateway_spec_from_plaintext") {
        return Err(String::from(
            "the dock allow path does not parse the gateway spec",
        ));
    }
    if !dock
        .type_item("DockFrameResponse")?
        .contains("pub http: Option<DockHttp>")
    {
        return Err(String::from("DockFrameResponse missing http field"));
    }
    Ok(())
}

fn parse(text: &str) -> RustSource {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s,
        Err(e) => panic!("sample does not parse: {e}"),
    }
}

#[test]
fn the_dock_executes_the_bound_request_after_allow() -> Result<(), String> {
    let dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let dock = RustSource::read_module_dir(&dir, &["tests.rs"])?;
    scan_dock_attaches_bound_http(&dock)
}

#[test]
fn a_dock_without_the_bound_request_fails() {
    let bad = parse("pub struct DockFrameResponse { pub http: Option<DockHttp> }\nfn allow() { gateway_request_of(&event); }");
    match scan_dock_attaches_bound_http(&bad) {
        Err(e) => assert!(e.contains("does not execute the bound http")),
        Ok(()) => panic!("a dock without the bound request passed"),
    }
    let good = parse("pub struct DockFrameResponse { pub http: Option<DockHttp> }\nfn allow() { if let Some(Ok(spec)) = gateway_request_of(&event) { execute_bound_http_after_allow(&spec); } }");
    assert_eq!(scan_dock_attaches_bound_http(&good), Ok(()));
}
