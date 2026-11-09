//! Bounded ingest validation runs in a separate validator process.
//!
//! These tests drive the real `aep-ucb-validate` binary that Cargo builds for
//! this package, plus small shell programs that stand in for a slow, broken or
//! talkative validator.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "integration test crate: a failed unwrap here is a failed test"
)]

use aep_ucb::ingress::{ForeignIngestBody, Provenance};
use aep_ucb::validate_process::{
    encode_request, ValidateWaitError, ValidatorProcess, MAX_RESULT_BYTES,
};
use aep_ucb_perimeter_v1::{PredicateProfile, WireLimits};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Semaphore;

const SLOTS: usize = 2;

/// Tests in this file spawn many processes. They run one at a time so the
/// stress test measures the validator and not a host crowded by its siblings.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn validator() -> ValidatorProcess {
    ValidatorProcess::new(env!("CARGO_BIN_EXE_aep-ucb-validate"))
}

fn sh(script: &str) -> ValidatorProcess {
    ValidatorProcess::with_args("/bin/sh", ["-c", script])
}

fn slots() -> Arc<Semaphore> {
    Arc::new(Semaphore::new(SLOTS))
}

fn clean_body(note_len: usize) -> ForeignIngestBody {
    let sentence = "the quick brown fox jumps over the lazy dog ";
    let note: String = sentence.chars().cycle().take(note_len).collect();
    ForeignIngestBody {
        provenance: Some(Provenance::bound("lg", "1.0", "s1")),
        payload: serde_json::json!({"subject": "a", "predicate": "b", "object": "c", "note": note}),
        ..Default::default()
    }
}

fn request(body: &ForeignIngestBody) -> Vec<u8> {
    encode_request(body, &[], PredicateProfile::PerimeterV1).expect("encode request")
}

#[tokio::test]
async fn validation_payload_at_the_256_kib_ingest_cap_returns_ok() {
    let _serial = SERIAL.lock().await;
    let cap = WireLimits::default().ingest_default_bytes;
    assert_eq!(cap, 256 * 1024);
    let overhead = serde_json::to_vec(&clean_body(0))
        .expect("encode body")
        .len();
    let body = clean_body(cap - overhead);
    let body_len = serde_json::to_vec(&body).expect("encode body").len();
    assert!(
        body_len <= cap && body_len > cap - 64,
        "payload is {body_len} bytes"
    );
    let started = Instant::now();
    let out = validator().validate(&slots(), 2000, &request(&body)).await;
    let v = out.expect("validator answered");
    assert!(v.ok, "{:?}", v.error);
    assert!(started.elapsed() < Duration::from_millis(2000));
}

#[tokio::test]
async fn result_larger_than_the_pipe_buffer_is_drained_before_wait() {
    let _serial = SERIAL.lock().await;
    let script = "cat >/dev/null; printf '{\"ok\":true,\"error\":\"'; \
                  head -c 262144 /dev/zero | tr '\\000' a; printf '\"}'";
    let started = Instant::now();
    let out = sh(script).validate(&slots(), 2000, b"{}").await;
    let v = out.expect("large result decoded");
    assert!(v.ok);
    assert_eq!(v.error.map(|e| e.len()), Some(262144));
    assert!(started.elapsed() < Duration::from_millis(2000));
}

#[tokio::test]
async fn result_over_the_cap_is_refused() {
    let _serial = SERIAL.lock().await;
    let script = format!(
        "head -c {} /dev/zero | tr '\\000' a",
        MAX_RESULT_BYTES + 4096
    );
    let out = sh(&script).validate(&slots(), 2000, b"{}").await;
    assert_eq!(out.err(), Some(ValidateWaitError::Join));
}

#[tokio::test]
async fn stalled_validator_is_killed_and_frees_its_slot() {
    let _serial = SERIAL.lock().await;
    let pool = slots();
    let started = Instant::now();
    let out = sh("sleep 30").validate(&pool, 60, b"{}").await;
    assert_eq!(out.err(), Some(ValidateWaitError::Timeout));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert_eq!(pool.available_permits(), SLOTS);
    let ok = validator()
        .validate(&pool, 2000, &request(&clean_body(64)))
        .await;
    assert_eq!(ok.map(|v| v.ok), Ok(true));
}

#[tokio::test]
async fn failing_crashing_or_missing_validator_is_join() {
    let _serial = SERIAL.lock().await;
    let pool = slots();
    let failed = sh("cat >/dev/null; printf '{\"ok\":true}'; exit 3")
        .validate(&pool, 2000, b"{}")
        .await;
    assert_eq!(failed.err(), Some(ValidateWaitError::Join));
    let garbage = sh("cat >/dev/null; printf 'not json'")
        .validate(&pool, 2000, b"{}")
        .await;
    assert_eq!(garbage.err(), Some(ValidateWaitError::Join));
    let crashed = sh("kill -SEGV $$").validate(&pool, 2000, b"{}").await;
    assert_eq!(crashed.err(), Some(ValidateWaitError::Join));
    let missing = ValidatorProcess::new("/nonexistent/aep-ucb-validate")
        .validate(&pool, 2000, b"{}")
        .await;
    assert_eq!(missing.err(), Some(ValidateWaitError::Join));
    assert_eq!(pool.available_permits(), SLOTS);
}

#[tokio::test]
async fn busy_when_both_slots_are_live() {
    let _serial = SERIAL.lock().await;
    let pool = slots();
    let slow = "cat >/dev/null; sleep 0.4; printf '{\"ok\":true}'";
    let a = tokio::spawn({
        let pool = pool.clone();
        async move { sh(slow).validate(&pool, 2000, b"{}").await }
    });
    let b = tokio::spawn({
        let pool = pool.clone();
        async move { sh(slow).validate(&pool, 2000, b"{}").await }
    });
    tokio::time::sleep(Duration::from_millis(120)).await;
    let busy = validator().validate(&pool, 40, b"{}").await;
    assert_eq!(busy.err(), Some(ValidateWaitError::Busy));
    assert_eq!(a.await.expect("a").map(|v| v.ok), Ok(true));
    assert_eq!(b.await.expect("b").map(|v| v.ok), Ok(true));
}

#[tokio::test]
async fn real_validator_denies_secrets_like_the_in_process_check() {
    let _serial = SERIAL.lock().await;
    let body = ForeignIngestBody {
        provenance: Some(Provenance::bound("lg", "1.0", "s1")),
        payload: serde_json::json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"}),
        ..Default::default()
    };
    let v = validator()
        .validate(&slots(), 2000, &request(&body))
        .await
        .expect("validator answered");
    assert!(!v.ok);
    assert_eq!(v.predicate, Some("P_C"));
}

/// 10,000 validations through the real validator while two threads log
/// through a tracing subscriber. Zero timeouts, zero busy and zero join.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn ten_thousand_validations_under_tracing_load_have_zero_timeouts() {
    let _serial = SERIAL.lock().await;
    let total = 10_000usize;
    let workers = 8usize;
    let subscriber = tracing_subscriber::fmt()
        .with_writer(std::io::sink)
        .with_max_level(tracing::Level::TRACE)
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    let stop = Arc::new(AtomicBool::new(false));
    let mut loggers = Vec::new();
    for t in 0..2 {
        let stop = Arc::clone(&stop);
        let dispatch = tracing::dispatcher::get_default(|d| d.clone());
        loggers.push(std::thread::spawn(move || {
            tracing::dispatcher::with_default(&dispatch, || {
                let mut n = 0u64;
                while !stop.load(Ordering::Relaxed) {
                    tracing::info!(thread = t, n, "tracing load while validators run");
                    n += 1;
                    std::thread::yield_now();
                }
                n
            })
        }));
    }

    let pool = slots();
    let next = Arc::new(AtomicUsize::new(0));
    let req = Arc::new(request(&clean_body(256)));
    let started = Instant::now();
    let mut tasks = Vec::new();
    for _ in 0..workers {
        let pool = Arc::clone(&pool);
        let next = Arc::clone(&next);
        let req = Arc::clone(&req);
        tasks.push(tokio::spawn(async move {
            let v = validator();
            let mut bad = Vec::new();
            while next.fetch_add(1, Ordering::Relaxed) < total {
                match v.validate(&pool, 2000, &req).await {
                    Ok(r) if r.ok => {}
                    other => bad.push(format!("{other:?}")),
                }
            }
            bad
        }));
    }
    let mut failures = Vec::new();
    for t in tasks {
        failures.extend(t.await.expect("worker"));
    }
    stop.store(true, Ordering::Relaxed);
    let logged: u64 = loggers.into_iter().map(|h| h.join().expect("logger")).sum();
    let elapsed = started.elapsed();
    assert!(logged > 0, "tracing load ran");
    let timeouts = failures.iter().filter(|f| f.contains("Timeout")).count();
    let busy = failures.iter().filter(|f| f.contains("Busy")).count();
    let join = failures.iter().filter(|f| f.contains("Join")).count();
    assert!(
        failures.is_empty(),
        "{} of {total} validations failed in {elapsed:?}: {timeouts} timeout, {busy} busy, {join} join, first {:?}",
        failures.len(),
        failures.first()
    );
    eprintln!("{total} validations in {elapsed:?} with {logged} tracing events");
}

fn workspace_root() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    manifest
        .ancestors()
        .find(|p| p.join("Cargo.lock").is_file() && p.join("AEP-Base-Node").is_dir())
        .map(Path::to_path_buf)
        .expect("workspace root")
}

fn rust_sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if matches!(
                name.as_ref(),
                "target" | ".git" | "node_modules" | "AEP-CAW"
            ) {
                continue;
            }
            rust_sources(&path, out);
        } else if name.ends_with(".rs") {
            out.push(path);
        }
    }
}

#[test]
fn workspace_has_no_fork_extern() {
    let _serial = SERIAL.blocking_lock();
    let mut files = Vec::new();
    rust_sources(&workspace_root(), &mut files);
    assert!(files.len() > 50, "scanned {} Rust files", files.len());
    let needles = [["fn ", "fork("].concat(), ["libc::", "fork"].concat()];
    let offenders: Vec<_> = files
        .iter()
        .filter(|f| {
            std::fs::read_to_string(f)
                .map(|s| needles.iter().any(|n| s.contains(n.as_str())))
                .unwrap_or(false)
        })
        .collect();
    assert!(offenders.is_empty(), "fork declared in {offenders:?}");
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
#[test]
fn confined_process_is_killed_on_a_forbidden_syscall() {
    let _serial = SERIAL.blocking_lock();
    use std::os::unix::process::ExitStatusExt;
    const PROBE: &str = "AEP_UCB_CONFINE_PROBE";
    if std::env::var_os(PROBE).is_some() {
        aep_ucb::sandbox::confine().expect("confine");
        let opened = std::fs::File::open("/proc/self/status");
        println!("escaped confinement: {}", opened.is_ok());
        std::process::exit(0);
    }
    let exe = std::env::current_exe().expect("test binary");
    let out = std::process::Command::new(exe)
        .args([
            "confined_process_is_killed_on_a_forbidden_syscall",
            "--exact",
            "--test-threads=1",
            "--nocapture",
        ])
        .env(PROBE, "1")
        .output()
        .expect("probe ran");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(!stdout.contains("escaped confinement"), "{stdout}");
    assert_eq!(out.status.signal(), Some(libc::SIGSYS), "{:?}", out.status);
}
