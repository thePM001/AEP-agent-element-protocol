//! Official aep-base-node log.
//!
//! One subscriber for the whole daemon. The filter comes from AEP_LOG, then
//! RUST_LOG, then info. Output always goes to stderr. AEP_LOG_JSON=1 writes JSON
//! lines and AEP_LOG_FILE=1 also appends to $AEP_DATA/log/aep-base-node.log with
//! mode 0600 inside a 0700 directory. Every kernel event carries one id from the
//! closed DockEvent set while seal or credential fields are redacted before any
//! line is written.

use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::field::MakeExt;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields, MakeWriter};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, Registry};

pub const LOG_DIR_NAME: &str = "log";
pub const LOG_FILE_NAME: &str = "aep-base-node.log";
pub const REDACTED: &str = "[redacted]";

/// Field names whose values never reach a log line.
pub const REDACTED_FIELDS: &[&str] = &[
    "api_key",
    "authorization",
    "data_key",
    "token",
    "secret",
    "secret_hex",
    "key_pem",
    "signer_public_hex",
    "capsule",
    "frame",
    "sealed",
    "lattice_frame",
    "ciphertext_hex",
    "nonce_hex",
    "grants",
];

/// The closed set of kernel event ids.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DockEvent {
    BootStart,
    BootReady,
    BootDegraded,
    BootError,
    DockBind,
    DockTlsHandshakeRefused,
    DockTlsConnectionClosed,
    DockDrain,
    FrameDeny,
    FrameReplay,
    FramePending,
    FrameApply,
    HealthProbe,
    SqliteClose,
    StopSignal,
    DataDockBind,
    DataDockAuthFail,
    DataDockLedgerRead,
    DataDockActionAccept,
    DataDockActionDeny,
    DataDockRateLimited,
}

impl DockEvent {
    pub const ALL: [DockEvent; 21] = [
        DockEvent::BootStart,
        DockEvent::BootReady,
        DockEvent::BootDegraded,
        DockEvent::BootError,
        DockEvent::DockBind,
        DockEvent::DockTlsHandshakeRefused,
        DockEvent::DockTlsConnectionClosed,
        DockEvent::DockDrain,
        DockEvent::FrameDeny,
        DockEvent::FrameReplay,
        DockEvent::FramePending,
        DockEvent::FrameApply,
        DockEvent::HealthProbe,
        DockEvent::SqliteClose,
        DockEvent::StopSignal,
        DockEvent::DataDockBind,
        DockEvent::DataDockAuthFail,
        DockEvent::DataDockLedgerRead,
        DockEvent::DataDockActionAccept,
        DockEvent::DataDockActionDeny,
        DockEvent::DataDockRateLimited,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            DockEvent::BootStart => "boot.start",
            DockEvent::BootReady => "boot.ready",
            DockEvent::BootDegraded => "boot.degraded",
            DockEvent::BootError => "boot.error",
            DockEvent::DockBind => "dock.bind",
            DockEvent::DockTlsHandshakeRefused => "dock.tls.handshake_refused",
            DockEvent::DockTlsConnectionClosed => "dock.tls.connection_closed",
            DockEvent::DockDrain => "dock.drain",
            DockEvent::FrameDeny => "frame.deny",
            DockEvent::FrameReplay => "frame.replay",
            DockEvent::FramePending => "frame.pending",
            DockEvent::FrameApply => "frame.apply",
            DockEvent::HealthProbe => "health.probe",
            DockEvent::SqliteClose => "sqlite.close",
            DockEvent::StopSignal => "stop.signal",
            DockEvent::DataDockBind => "data_dock.bind",
            DockEvent::DataDockAuthFail => "data_dock.auth_fail",
            DockEvent::DataDockLedgerRead => "data_dock.ledger_read",
            DockEvent::DataDockActionAccept => "data_dock.action_accept",
            DockEvent::DataDockActionDeny => "data_dock.action_deny",
            DockEvent::DataDockRateLimited => "data_dock.rate_limited",
        }
    }
}

/// Emit one kernel event: `dock_event!(info, DockEvent::BootReady, status = "ok", "ready")`.
#[macro_export]
macro_rules! dock_event {
    ($level:ident, $event:expr, $($rest:tt)+) => {
        ::tracing::$level!(event = $crate::dock_log::DockEvent::as_str($event), $($rest)+)
    };
}

fn is_redacted(name: &str) -> bool {
    REDACTED_FIELDS.iter().any(|f| f.eq_ignore_ascii_case(name))
}

#[derive(Debug, Clone)]
pub struct LogConfig {
    pub filter: String,
    pub json: bool,
    pub file: Option<PathBuf>,
}

impl LogConfig {
    pub fn from_env() -> Self {
        let filter = std::env::var("AEP_LOG")
            .ok()
            .filter(|v| v.trim().is_empty() == false)
            .or_else(|| std::env::var("RUST_LOG").ok().filter(|v| v.trim().is_empty() == false))
            .unwrap_or_else(|| String::from("info"));
        let json = std::env::var("AEP_LOG_JSON").ok().as_deref() == Some("1");
        let file = if std::env::var("AEP_LOG_FILE").ok().as_deref() == Some("1") {
            Some(crate::default_aep_data_dir())
        } else {
            None
        };
        Self { filter, json, file }
    }
}

fn nearest_existing(path: &Path) -> PathBuf {
    let mut cur = path.to_path_buf();
    loop {
        if cur.exists() {
            return cur;
        }
        match cur.parent() {
            Some(p) if p.as_os_str().is_empty() == false => cur = p.to_path_buf(),
            _ => return PathBuf::from("."),
        }
    }
}

/// Opens the official log file under `data_dir`. A world-writable parent is
/// refused the same way as for the lattice database.
pub fn open_log_file(data_dir: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let parent = nearest_existing(data_dir);
        let mode = std::fs::metadata(&parent)?.permissions().mode();
        if mode & 0o002 != 0 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!("log parent {} is world-writable", parent.display()),
            ));
        }
    }
    let dir = data_dir.join(LOG_DIR_NAME);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(LOG_FILE_NAME);
    let mut opts = OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let file = opts.open(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        let dir_mode = std::fs::metadata(&dir)?.permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(&path)?.permissions().mode() & 0o777;
        if dir_mode != 0o700 || file_mode != 0o600 {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                String::from("log dir must be 0700 and log file 0600"),
            ));
        }
    }
    Ok(file)
}

/// Collects event fields into a JSON map with seal and credential values redacted.
#[derive(Default)]
struct JsonVisitor {
    message: Option<String>,
    event: Option<String>,
    fields: serde_json::Map<String, serde_json::Value>,
}

impl JsonVisitor {
    fn put(&mut self, field: &Field, value: serde_json::Value) {
        let name = field.name();
        if is_redacted(name) {
            self.fields
                .insert(name.to_string(), serde_json::Value::String(String::from(REDACTED)));
            return;
        }
        match name {
            "message" => self.message = value.as_str().map(String::from).or_else(|| Some(value.to_string())),
            "event" => self.event = value.as_str().map(String::from),
            _ => {
                self.fields.insert(name.to_string(), value);
            }
        }
    }
}

impl Visit for JsonVisitor {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.put(field, serde_json::Value::String(value.to_string()));
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, serde_json::Value::Bool(value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, serde_json::Value::from(value));
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, serde_json::Value::from(value));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.put(field, serde_json::Value::String(format!("{value:?}")));
    }
}

/// JSON lines formatter: ts_ms, level, target, event, message and fields.
pub struct JsonLines;

impl<S, N> FormatEvent<S, N> for JsonLines
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(&self, _ctx: &FmtContext<'_, S, N>, mut writer: Writer<'_>, event: &Event<'_>) -> fmt::Result {
        let mut v = JsonVisitor::default();
        event.record(&mut v);
        let meta = event.metadata();
        let ts_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let mut line = serde_json::Map::new();
        line.insert(String::from("ts_ms"), serde_json::Value::from(ts_ms));
        line.insert(String::from("level"), serde_json::Value::String(meta.level().to_string()));
        line.insert(String::from("target"), serde_json::Value::String(meta.target().to_string()));
        if let Some(ev) = v.event {
            line.insert(String::from("event"), serde_json::Value::String(ev));
        }
        if let Some(msg) = v.message {
            line.insert(String::from("message"), serde_json::Value::String(msg));
        }
        if v.fields.is_empty() == false {
            line.insert(String::from("fields"), serde_json::Value::Object(v.fields));
        }
        let text = serde_json::to_string(&serde_json::Value::Object(line)).map_err(|_| fmt::Error)?;
        writeln!(writer, "{text}")
    }
}

type BoxedLayer = Box<dyn Layer<Registry> + Send + Sync>;

fn env_filter(spec: &str) -> EnvFilter {
    EnvFilter::try_new(spec).unwrap_or_else(|_| EnvFilter::new("info"))
}

/// One output layer with redaction, in JSON or plain text.
pub fn layer_for<W>(filter: &str, json: bool, ansi: bool, writer: W) -> BoxedLayer
where
    W: for<'a> MakeWriter<'a> + Send + Sync + 'static,
{
    if json {
        tracing_subscriber::fmt::layer()
            .event_format(JsonLines)
            .with_writer(writer)
            .with_filter(env_filter(filter))
            .boxed()
    } else {
        let fields = tracing_subscriber::fmt::format::debug_fn(|w: &mut Writer<'_>, field: &Field, value: &dyn fmt::Debug| {
            let name = field.name();
            if name == "message" {
                write!(w, "{value:?}")
            } else if is_redacted(name) {
                write!(w, "{name}={REDACTED}")
            } else {
                write!(w, "{name}={value:?}")
            }
        })
        .delimited(" ");
        tracing_subscriber::fmt::layer()
            .with_ansi(ansi)
            .fmt_fields(fields)
            .with_writer(writer)
            .with_filter(env_filter(filter))
            .boxed()
    }
}

/// Installs the official log. Returns the log file path when one was opened.
pub fn init(cfg: &LogConfig) -> Result<Option<PathBuf>, String> {
    let mut layers: Vec<BoxedLayer> = vec![layer_for(&cfg.filter, cfg.json, cfg.json == false, io::stderr)];
    let mut file_path = None;
    if let Some(data_dir) = &cfg.file {
        let file = open_log_file(data_dir).map_err(|e| format!("official log file: {e}"))?;
        layers.push(layer_for(&cfg.filter, cfg.json, false, Mutex::new(file)));
        file_path = Some(data_dir.join(LOG_DIR_NAME).join(LOG_FILE_NAME));
    }
    tracing_subscriber::registry()
        .with(layers)
        .try_init()
        .map_err(|e| e.to_string())?;
    Ok(file_path)
}

/// In-memory writer for tests of the log output.
#[derive(Clone, Default)]
pub struct SharedBuffer(pub Arc<Mutex<Vec<u8>>>);

impl SharedBuffer {
    pub fn text(&self) -> String {
        let g = match self.0.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        String::from_utf8_lossy(&g).into_owned()
    }
}

pub struct SharedBufferGuard(Arc<Mutex<Vec<u8>>>);

impl Write for SharedBufferGuard {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self.0.lock() {
            Ok(mut g) => g.extend_from_slice(buf),
            Err(p) => p.into_inner().extend_from_slice(buf),
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for SharedBuffer {
    type Writer = SharedBufferGuard;
    fn make_writer(&'a self) -> Self::Writer {
        SharedBufferGuard(self.0.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_ids_are_a_closed_unique_set() {
        let mut seen = std::collections::BTreeSet::new();
        for ev in DockEvent::ALL {
            assert!(seen.insert(ev.as_str()), "duplicate {}", ev.as_str());
        }
        assert_eq!(seen.len(), 21);
        assert!(seen.contains("data_dock.rate_limited"));
    }

    #[cfg(unix)]
    #[test]
    fn log_refuses_world_writable_parent() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("tempdir");
        let data = dir.path().join("data");
        std::fs::create_dir_all(&data).expect("data");
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o777)).expect("chmod 777");
        let err = open_log_file(&data).expect_err("world-writable parent must refuse");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(data.join(LOG_DIR_NAME).exists(), false);
        std::fs::set_permissions(&data, std::fs::Permissions::from_mode(0o700)).expect("chmod 700");
        let _file = open_log_file(&data).expect("private parent opens");
        let dir_mode = std::fs::metadata(data.join(LOG_DIR_NAME)).expect("dir").permissions().mode() & 0o777;
        let file_mode = std::fs::metadata(data.join(LOG_DIR_NAME).join(LOG_FILE_NAME))
            .expect("file")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }

    #[test]
    fn log_omits_seal_material() {
        for json in [true, false] {
            let buf = SharedBuffer::default();
            let subscriber = tracing_subscriber::registry().with(vec![layer_for("info", json, false, buf.clone())]);
            tracing::subscriber::with_default(subscriber, || {
                crate::dock_event!(
                    info,
                    DockEvent::FrameDeny,
                    signer_public_hex = "deadbeefcafe",
                    api_key = "k-secret-value",
                    frame = "capsule-bytes-xyz",
                    grants = "grant-root",
                    digest = "digest-visible",
                    "frame denied"
                );
            });
            let text = buf.text();
            for secret in ["deadbeefcafe", "k-secret-value", "capsule-bytes-xyz", "grant-root"] {
                assert_eq!(text.contains(secret), false, "json={json} leaked {secret}: {text}");
            }
            assert!(text.contains("frame.deny"), "json={json}: {text}");
            assert!(text.contains("digest-visible"), "json={json}: {text}");
            assert!(text.contains(REDACTED), "json={json}: {text}");
            if json {
                let v: serde_json::Value = serde_json::from_str(text.trim()).expect("json line");
                assert_eq!(v.get("event").and_then(|e| e.as_str()), Some("frame.deny"));
                assert_eq!(v.get("message").and_then(|e| e.as_str()), Some("frame denied"));
            }
        }
    }
}
