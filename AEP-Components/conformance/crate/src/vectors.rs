//! Normative run of the language neutral conformance vectors.
//!
//! The vector files under `AEP-Components/conformance/vectors/v1` pin what the Rust
//! kernel does. Every other implementation (the Go CAW, the TypeScript helpers or a
//! third party) passes when it gives the same answers. This module runs every case of
//! every suite against the kernel, so a vector that drifts from the kernel fails here.

use crate::temp_docking_runtime;
use aep_base_node::{
    docking_port_specs, enforce_writing_text, lint_writing_prose, process_request,
    DockFrameResponse,
};
use aep_lattice_channel::DockingPort;
use aep_potomitan::{detect_network_mode, status};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The vector file format this runner reads.
pub const FORMAT: &str = "aep-conformance-vectors";
/// The one format version this runner reads. A new version is a new folder.
pub const FORMAT_VERSION: u64 = 1;
/// Every suite of format version 1. The kernel implements all of them.
pub const SUITES: &[&str] = &[
    "dock-answer",
    "dock-request",
    "dock-socket",
    "mesh-mode",
    "writing",
];

/// The vectors folder of this source tree.
pub fn default_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vectors/v1")
}

#[derive(Debug, Clone)]
pub struct Case {
    pub suite: String,
    pub id: String,
    pub input: Value,
    pub expect: Value,
}

#[derive(Debug, Serialize)]
pub struct CaseFailure {
    pub suite: String,
    pub id: String,
    pub error: String,
}

#[derive(Debug, Serialize, Default)]
pub struct SuiteCount {
    pub cases: usize,
    pub failed: usize,
}

#[derive(Debug, Serialize)]
pub struct VectorReport {
    pub format: &'static str,
    pub format_version: u64,
    pub implementation: &'static str,
    pub vectors: usize,
    pub passed: usize,
    pub failed: usize,
    pub suites: BTreeMap<String, SuiteCount>,
    pub failures: Vec<CaseFailure>,
}

fn field<'a>(doc: &'a Value, key: &str, file: &Path) -> Result<&'a Value, String> {
    doc.get(key)
        .ok_or_else(|| format!("{}: missing {key}", file.display()))
}

/// Read and check every vector file in a folder. A file with another format, a
/// suite outside format version 1, a duplicate case id or a case without input and
/// expect is an error, so a broken file never passes by running nothing.
pub fn load_cases(dir: &Path) -> Result<Vec<Case>, String> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    let mut seen_suites = BTreeSet::new();
    let mut out = Vec::new();
    for file in files {
        let text =
            std::fs::read_to_string(&file).map_err(|e| format!("{}: {e}", file.display()))?;
        let doc: Value =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", file.display()))?;
        if field(&doc, "format", &file)? != FORMAT {
            return Err(format!("{}: format is not {FORMAT}", file.display()));
        }
        if field(&doc, "format_version", &file)?.as_u64() != Some(FORMAT_VERSION) {
            return Err(format!(
                "{}: format_version is not {FORMAT_VERSION}",
                file.display()
            ));
        }
        if field(&doc, "normative", &file)? != "rust" {
            return Err(format!("{}: normative is not rust", file.display()));
        }
        let suite = field(&doc, "suite", &file)?
            .as_str()
            .ok_or_else(|| format!("{}: suite is not a string", file.display()))?
            .to_string();
        if !SUITES.contains(&suite.as_str()) {
            return Err(format!("{}: unknown suite {suite}", file.display()));
        }
        if !seen_suites.insert(suite.clone()) {
            return Err(format!(
                "{}: suite {suite} is declared twice",
                file.display()
            ));
        }
        let cases = field(&doc, "cases", &file)?
            .as_array()
            .ok_or_else(|| format!("{}: cases is not an array", file.display()))?;
        if cases.is_empty() {
            return Err(format!("{}: suite {suite} has no cases", file.display()));
        }
        let mut ids = BTreeSet::new();
        for c in cases {
            let id = c
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{}: a case has no id", file.display()))?
                .to_string();
            if !ids.insert(id.clone()) {
                return Err(format!("{}: duplicate case id {id}", file.display()));
            }
            let input = c
                .get("input")
                .cloned()
                .ok_or_else(|| format!("{suite}/{id}: no input"))?;
            let expect = c
                .get("expect")
                .cloned()
                .ok_or_else(|| format!("{suite}/{id}: no expect"))?;
            out.push(Case {
                suite: suite.clone(),
                id,
                input,
                expect,
            });
        }
    }
    for suite in SUITES {
        if !seen_suites.contains(*suite) {
            return Err(format!("{}: suite {suite} is missing", dir.display()));
        }
    }
    Ok(out)
}

fn str_input<'a>(case: &'a Case, key: &str) -> Result<&'a str, String> {
    case.input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("input.{key} is not a string"))
}

fn dock_socket(case: &Case) -> Result<Value, String> {
    let port = str_input(case, "port")?;
    let parsed: Result<DockingPort, _> = serde_json::from_value(json!(port));
    let Ok(parsed) = parsed else {
        return Ok(json!({ "error": "unknown_dock" }));
    };
    let base = "aep-socket-base";
    let spec = docking_port_specs(base)
        .into_iter()
        .find(|s| s.port == parsed)
        .ok_or_else(|| format!("kernel binds no socket for {port}"))?;
    let suffix = spec
        .listen_path
        .strip_prefix(&format!("{base}/"))
        .ok_or_else(|| {
            format!(
                "listen path {} is not under the socket base",
                spec.listen_path
            )
        })?;
    Ok(json!({ "suffix": suffix }))
}

fn dock_request(case: &Case) -> Result<Value, String> {
    let line = str_input(case, "line")?;
    let (_dir, rt) = temp_docking_runtime()?;
    let resp = process_request(&rt, &DockingPort::ValidationEngine, line);
    if resp.event_id.is_some() {
        return Err(format!(
            "a plain request recorded event {:?}",
            resp.event_id
        ));
    }
    // The answer the dock writes back must read the same way to a caller.
    let wire = serde_json::to_string(&resp).map_err(|e| e.to_string())?;
    let read_back = DockFrameResponse::verdict_of_line(&wire);
    if read_back != resp.verdict() {
        return Err(format!(
            "dock answer reads as {read_back:?} on the wire but {:?} in the kernel",
            resp.verdict()
        ));
    }
    Ok(json!({
        "verdict": resp.verdict(),
        "error": resp.error.unwrap_or_default(),
    }))
}

fn dock_answer(case: &Case) -> Result<Value, String> {
    let line = str_input(case, "line")?;
    Ok(json!({ "verdict": DockFrameResponse::verdict_of_line(line) }))
}

fn mesh_mode(case: &Case) -> Result<Value, String> {
    let internet_up = case
        .input
        .get("internet_up")
        .and_then(Value::as_bool)
        .ok_or("input.internet_up is not a bool")?;
    let peers = case
        .input
        .get("mesh_peers")
        .and_then(Value::as_u64)
        .ok_or("input.mesh_peers is not an unsigned integer")?;
    let peers = u32::try_from(peers).map_err(|_| "input.mesh_peers is above u32")?;
    let mode = detect_network_mode(internet_up, peers);
    Ok(json!({ "mode": mode, "reachable": status(mode, peers).reachable }))
}

fn writing(case: &Case) -> Result<Value, String> {
    let text = str_input(case, "text")?;
    let violations: Vec<Value> = lint_writing_prose(text)
        .into_iter()
        .map(|v| json!({ "rule": v.rule, "line": v.line }))
        .collect();
    let enforced = enforce_writing_text(text);
    Ok(json!({
        "violations": violations,
        "fixed": enforced.text,
        "ok_after_fix": enforced.ok,
    }))
}

/// The kernel answer of one case.
pub fn kernel_answer(case: &Case) -> Result<Value, String> {
    match case.suite.as_str() {
        "dock-socket" => dock_socket(case),
        "dock-request" => dock_request(case),
        "dock-answer" => dock_answer(case),
        "mesh-mode" => mesh_mode(case),
        "writing" => writing(case),
        other => Err(format!("unknown suite {other}")),
    }
}

/// Compare one answer with its expectation. `error_prefix` matches the start of
/// `error`, for refusals whose tail is a parser message of the implementation.
pub fn matches(expect: &Value, got: &Value) -> Result<(), String> {
    let (Some(want), Some(have)) = (expect.as_object(), got.as_object()) else {
        return if expect == got {
            Ok(())
        } else {
            Err(format!("want {expect} got {got}"))
        };
    };
    for (key, value) in want {
        if key == "error_prefix" {
            let prefix = value.as_str().ok_or("error_prefix is not a string")?;
            let err = have
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if !err.starts_with(prefix) {
                return Err(format!("error {err:?} does not start with {prefix:?}"));
            }
            continue;
        }
        match have.get(key) {
            Some(v) if v == value => {}
            Some(v) => return Err(format!("{key}: want {value} got {v}")),
            None => return Err(format!("{key}: missing, want {value}")),
        }
    }
    Ok(())
}

pub fn run(dir: &Path) -> Result<VectorReport, String> {
    let cases = load_cases(dir)?;
    let mut suites: BTreeMap<String, SuiteCount> = BTreeMap::new();
    let mut failures = Vec::new();
    for case in &cases {
        let count = suites.entry(case.suite.clone()).or_default();
        count.cases += 1;
        let outcome = kernel_answer(case).and_then(|got| matches(&case.expect, &got));
        if let Err(error) = outcome {
            count.failed += 1;
            failures.push(CaseFailure {
                suite: case.suite.clone(),
                id: case.id.clone(),
                error,
            });
        }
    }
    Ok(VectorReport {
        format: FORMAT,
        format_version: FORMAT_VERSION,
        implementation: "rust-kernel",
        vectors: cases.len(),
        passed: cases.len() - failures.len(),
        failed: failures.len(),
        suites,
        failures,
    })
}

/// `aep-conformance vectors [dir]`: print the report as JSON, exit 0 only when every
/// vector passes.
pub fn run_cli(dir: &Path) -> i32 {
    match run(dir) {
        Ok(report) => {
            for f in &report.failures {
                eprintln!("FAIL vector {}/{} - {}", f.suite, f.id, f.error);
            }
            eprintln!(
                "vectors {} passed {} failed {} ({})",
                report.vectors,
                report.passed,
                report.failed,
                dir.display()
            );
            match serde_json::to_string_pretty(&report) {
                Ok(text) => println!("{text}"),
                Err(err) => {
                    eprintln!("FAIL vector report could not be written as JSON - {err}");
                    return 2;
                }
            }
            if report.failed > 0 {
                1
            } else {
                0
            }
        }
        Err(err) => {
            eprintln!("FAIL vectors could not be read - {err}");
            2
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_vector_matches_the_kernel() {
        let report = run(&default_dir()).expect("vectors load");
        let failures: Vec<String> = report
            .failures
            .iter()
            .map(|f| format!("{}/{}: {}", f.suite, f.id, f.error))
            .collect();
        assert!(failures.is_empty(), "{failures:#?}");
        assert_eq!(report.suites.len(), SUITES.len());
        assert!(report.vectors > 0);
    }

    #[test]
    fn error_prefix_matches_only_the_start() {
        let want = json!({ "verdict": "refused", "error_prefix": "invalid JSON: " });
        assert!(matches(
            &want,
            &json!({ "verdict": "refused", "error": "invalid JSON: eof" })
        )
        .is_ok());
        assert!(matches(
            &want,
            &json!({ "verdict": "refused", "error": "x invalid JSON: " })
        )
        .is_err());
        assert!(matches(
            &want,
            &json!({ "verdict": "admitted", "error": "invalid JSON: " })
        )
        .is_err());
    }

    #[test]
    fn a_broken_vector_folder_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(
            load_cases(dir.path()).is_err(),
            "an empty folder runs nothing"
        );
        std::fs::write(
            dir.path().join("x.json"),
            r#"{"format":"aep-conformance-vectors","format_version":2,"normative":"rust","suite":"mesh-mode","cases":[]}"#,
        )
        .expect("write");
        let err = load_cases(dir.path()).expect_err("version 2 is not read");
        assert!(err.contains("format_version"), "{err}");
    }

    #[test]
    fn a_wrong_expectation_fails() {
        let case = Case {
            suite: "mesh-mode".into(),
            id: "wrong".into(),
            input: json!({ "internet_up": false, "mesh_peers": 0 }),
            expect: json!({ "mode": "potomitan", "reachable": true }),
        };
        let got = kernel_answer(&case).expect("answer");
        assert!(matches(&case.expect, &got).is_err());
    }
}
