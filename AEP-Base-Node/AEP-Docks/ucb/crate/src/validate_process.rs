//! Bounded foreign ingest validation in a separate validator process.
//!
//! The UCB never runs a foreign ingest check inside its own process. Each check
//! runs in a fresh `aep-ucb-validate` process that the UCB starts as a new
//! program. A new program inherits no lock that a UCB thread holds, so a
//! tracing or allocator lock cannot freeze the check. The validator confines
//! itself with seccomp before it reads any input (see [`crate::sandbox`]).
//!
//! The exchange is one JSON request on the child stdin and one JSON result on
//! the child stdout. The parent writes the request while it reads the result to
//! end of file and only then waits for the exit status, so a request or result
//! larger than the pipe buffer cannot stall either side.
//!
//! A two-slot pool bounds the number of live checks. Waiting for a slot longer
//! than the validate timeout returns [`ValidateWaitError::Busy`]. A check that
//! does not finish inside the timeout is killed and returns
//! [`ValidateWaitError::Timeout`]. A child that cannot start, exits with a
//! failure status or answers with an unreadable result returns
//! [`ValidateWaitError::Join`]. Every one of these outcomes is a deny.

use crate::ingress::{validate_foreign_ingest_with_profile, ForeignIngestBody, ValidationResult};
use aep_ucb_perimeter_v1::{parse_profile, PredicateProfile, ScannerId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Semaphore;

/// File name of the validator binary, without the platform executable suffix.
pub const VALIDATOR_BIN_NAME: &str = "aep-ucb-validate";

/// Largest result the parent accepts from the validator.
pub const MAX_RESULT_BYTES: usize = 1024 * 1024;

/// Largest request the validator accepts. It covers the 2 MiB ingest hard cap
/// plus the prior fingerprint list and the JSON envelope.
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;

/// Exit status of the validator when confinement cannot be installed.
pub const EXIT_CONFINE_FAILED: i32 = 3;

/// Why a bounded validation produced no result. Each case is a deny.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValidateWaitError {
    /// No validation slot became free inside the timeout.
    Busy,
    /// The validator did not answer inside the timeout and was killed.
    Timeout,
    /// The validator could not start, failed or answered with an unreadable result.
    Join,
}

#[derive(Serialize)]
struct RequestOut<'a> {
    body: &'a ForeignIngestBody,
    prior_fingerprints: &'a [u32],
    profile: &'static str,
}

#[derive(Deserialize)]
struct RequestIn {
    body: ForeignIngestBody,
    #[serde(default)]
    prior_fingerprints: Vec<u32>,
    profile: String,
}

/// Wire name of a predicate profile, as `parse_profile` reads it back.
pub fn profile_name(profile: PredicateProfile) -> &'static str {
    match profile {
        PredicateProfile::PerimeterV1 => "perimeter-v1",
    }
}

/// Encode one validation request for the validator stdin.
pub fn encode_request(
    body: &ForeignIngestBody,
    prior_fingerprints: &[u32],
    profile: PredicateProfile,
) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&RequestOut {
        body,
        prior_fingerprints,
        profile: profile_name(profile),
    })
    .map_err(|e| format!("validate request encode failed: {e}"))
}

/// Encode a validation result for the validator stdout.
pub fn encode_validation(v: &ValidationResult) -> Vec<u8> {
    serde_json::to_vec(v).unwrap_or_else(|_| Vec::from(b"{\"ok\":false}".as_slice()))
}

fn intern_predicate(raw: &str) -> &'static str {
    match raw {
        "P_P" => "P_P",
        "P_S" => "P_S",
        "P_C" => "P_C",
        "P_R" => "P_R",
        "profile" => "profile",
        _ => "unknown",
    }
}

fn decode_scanner_id(v: &Value) -> Option<ScannerId> {
    match v.get("scanner_id").and_then(Value::as_str)? {
        "Secrets" => Some(ScannerId::Secrets),
        "Injection" => Some(ScannerId::Injection),
        "Pii" => Some(ScannerId::Pii),
        "DestructiveShell" => Some(ScannerId::DestructiveShell),
        "PromptOverride" => Some(ScannerId::PromptOverride),
        _ => None,
    }
}

/// Decode a validation result. A missing or non-boolean `ok` decodes as a deny.
pub fn decode_validation(bytes: &[u8]) -> Option<ValidationResult> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    Some(ValidationResult {
        ok: v.get("ok").and_then(Value::as_bool).unwrap_or(false),
        predicate: v
            .get("predicate")
            .and_then(Value::as_str)
            .map(intern_predicate),
        scanner_id: decode_scanner_id(&v),
        error: v.get("error").and_then(Value::as_str).map(str::to_string),
    })
}

fn refused(error: &str) -> ValidationResult {
    ValidationResult {
        ok: false,
        predicate: None,
        scanner_id: None,
        error: Some(String::from(error)),
    }
}

/// Validator side of the exchange: one request in, one encoded result out.
///
/// Bad input never panics. It becomes a refused result.
pub fn answer_request(input: &[u8]) -> Vec<u8> {
    if input.len() > MAX_REQUEST_BYTES {
        return encode_validation(&refused("validator request over cap"));
    }
    let request: RequestIn = match serde_json::from_slice(input) {
        Ok(r) => r,
        Err(_) => return encode_validation(&refused("validator request unreadable")),
    };
    let profile = match parse_profile(Some(request.profile.as_str())) {
        Ok(p) => p,
        Err(e) => {
            return encode_validation(&ValidationResult {
                ok: false,
                predicate: Some("profile"),
                scanner_id: None,
                error: Some(e.to_string()),
            })
        }
    };
    encode_validation(&validate_foreign_ingest_with_profile(
        &request.body,
        &request.prior_fingerprints,
        profile,
    ))
}

/// How the UCB starts the validator.
#[derive(Debug, Clone)]
pub struct ValidatorProcess {
    program: PathBuf,
    args: Vec<OsString>,
}

impl ValidatorProcess {
    /// Run `program` with no arguments as the validator.
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
        }
    }

    /// Run `program` with `args` as the validator. Tests use it to stand in a
    /// slow or broken validator.
    pub fn with_args<I, S>(program: impl Into<PathBuf>, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        Self {
            program: program.into(),
            args: args.into_iter().map(Into::into).collect(),
        }
    }

    /// The validator installed beside the running executable.
    ///
    /// Release images install `aep-ucb-validate` next to `aep-ucb`. Cargo test
    /// binaries live in `target/<profile>/deps` while package binaries live one
    /// folder up, so that folder is checked as well. A missing validator is not
    /// an error here: every validation then returns [`ValidateWaitError::Join`].
    pub fn beside_current_exe() -> Self {
        Self::new(locate_validator())
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    /// Run one bounded validation of an encoded request.
    pub async fn validate(
        &self,
        slots: &Arc<Semaphore>,
        timeout_ms: u64,
        request: &[u8],
    ) -> Result<ValidationResult, ValidateWaitError> {
        let wait = Duration::from_millis(timeout_ms);
        let permit = match tokio::time::timeout(wait, Arc::clone(slots).acquire_owned()).await {
            Ok(Ok(p)) => p,
            Ok(Err(_)) | Err(_) => return Err(ValidateWaitError::Busy),
        };
        let spawned = Command::new(&self.program)
            .args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear()
            .kill_on_drop(true)
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(
                    validator = %self.program.display(),
                    error = %e,
                    "ucb validator did not start"
                );
                drop(permit);
                return Err(ValidateWaitError::Join);
            }
        };
        let (stdin, stdout) = match (child.stdin.take(), child.stdout.take()) {
            (Some(i), Some(o)) => (i, o),
            _ => {
                let _ = child.kill().await;
                drop(permit);
                return Err(ValidateWaitError::Join);
            }
        };
        let exchanged =
            tokio::time::timeout(wait, exchange(&mut child, stdin, stdout, request)).await;
        let outcome = match exchanged {
            Ok(Ok(bytes)) => decode_validation(&bytes).ok_or(ValidateWaitError::Join),
            Ok(Err(())) => Err(ValidateWaitError::Join),
            Err(_) => {
                let _ = child.kill().await;
                Err(ValidateWaitError::Timeout)
            }
        };
        drop(permit);
        outcome
    }
}

/// Feed the request and drain the result at the same time, then reap the child.
async fn exchange(
    child: &mut Child,
    mut stdin: ChildStdin,
    stdout: ChildStdout,
    request: &[u8],
) -> Result<Vec<u8>, ()> {
    let feed = async move {
        let fed = stdin.write_all(request).await;
        drop(stdin);
        fed
    };
    let drain = async move {
        let mut out = Vec::new();
        let mut limited = stdout.take(MAX_RESULT_BYTES as u64 + 1);
        limited.read_to_end(&mut out).await.map(|_| out)
    };
    let (fed, drained) = tokio::join!(feed, drain);
    let out = match drained {
        Ok(out) if out.len() <= MAX_RESULT_BYTES => out,
        _ => {
            let _ = child.kill().await;
            return Err(());
        }
    };
    let status = child.wait().await.map_err(|_| ())?;
    if fed.is_err() || !status.success() {
        return Err(());
    }
    Ok(out)
}

fn locate_validator() -> PathBuf {
    let name = format!("{VALIDATOR_BIN_NAME}{}", std::env::consts::EXE_SUFFIX);
    let exe = std::env::current_exe().ok();
    let dir = match exe.as_deref().and_then(Path::parent) {
        Some(d) => d,
        None => return PathBuf::from(name),
    };
    let beside = dir.join(&name);
    if beside.is_file() {
        return beside;
    }
    if dir.file_name().map(|n| n == "deps").unwrap_or(false) {
        if let Some(up) = dir.parent().map(|p| p.join(&name)) {
            if up.is_file() {
                return up;
            }
        }
    }
    beside
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingress::Provenance;

    #[test]
    fn request_round_trips_through_answer() {
        let body = ForeignIngestBody {
            provenance: Some(Provenance::bound("lg", "1.0", "s1")),
            payload: serde_json::json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"}),
            ..Default::default()
        };
        let req = encode_request(&body, &[7, 9], PredicateProfile::PerimeterV1).expect("encode");
        let back = decode_validation(&answer_request(&req)).expect("decode");
        assert!(!back.ok);
        assert_eq!(back.predicate, Some("P_C"));
        assert_eq!(back.scanner_id, Some(ScannerId::Secrets));
    }

    #[test]
    fn unreadable_or_oversized_request_is_refused() {
        let back = decode_validation(&answer_request(b"not json")).expect("decode");
        assert!(!back.ok);
        assert_eq!(back.error.as_deref(), Some("validator request unreadable"));
        let big = vec![b' '; MAX_REQUEST_BYTES + 1];
        let back = decode_validation(&answer_request(&big)).expect("decode");
        assert!(!back.ok);
        assert_eq!(back.error.as_deref(), Some("validator request over cap"));
    }

    #[test]
    fn unknown_profile_is_refused_on_the_profile_predicate() {
        let raw = br#"{"body":{"payload":{}},"prior_fingerprints":[],"profile":"perimeter-v9"}"#;
        let back = decode_validation(&answer_request(raw)).expect("decode");
        assert!(!back.ok);
        assert_eq!(back.predicate, Some("profile"));
    }

    #[test]
    fn result_without_boolean_ok_decodes_as_deny() {
        let back = decode_validation(br#"{"ok":"yes"}"#).expect("decode");
        assert!(!back.ok);
        assert!(decode_validation(b"garbage").is_none());
    }
}
