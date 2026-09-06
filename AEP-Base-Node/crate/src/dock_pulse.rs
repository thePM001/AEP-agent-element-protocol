//! Pulse queue enqueue and beat. AEP28-ENV-079.

use super::dock_apply::apply_held_capsule;
use super::dock_rate::{GLOBAL_RATE_LIMIT, SIGNER_RATE_LIMIT};
use super::dock_serve::MAX_CONNECTIONS;
use super::{
    deny_closed, deny_resp, dock_lock, lock_or_deny, DockFrameResponse,
};
use aep_base_node_pulse::{freeze_temporal_snapshot, BeatRelease, PulseQueue, QueuedCapsule};
use aep_lattice_channel::{ContractRegistry, DockingPort, LatticeChannelFrame, RateLimiter};
use aep_lattice_crypto::KemKeypair;
use aep_live_entry::LiveEntry;
use aep_wall_set_backpressure::CLASS_TEMPORAL;
use crate::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use crate::envelope_admit::load_live_entry;
use crate::{
    docking_port_specs, record_side_channel_anomaly, DockingPortSpec, ReplayGuard,
    SideChannelAnomalyKind,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;

pub(crate) struct HeldCapsule {
    pub(crate) frame: LatticeChannelFrame,
    pub(crate) plaintext: Vec<u8>,
    pub(crate) expected_port: DockingPort,
    pub(crate) bundle: aep_agentmesh::AgentMeshBundle,
}

pub struct PulseState {
    pub(crate) queue: PulseQueue,
    pub(crate) held: HashMap<String, HeldCapsule>,
    pub(crate) clock_ms: Option<i64>,
    pub(crate) last_applied: HashMap<String, DockFrameResponse>,
}

impl Default for PulseState {
    fn default() -> Self {
        Self {
            queue: PulseQueue::new(),
            held: HashMap::new(),
            clock_ms: None,
            last_applied: HashMap::new(),
        }
    }
}

pub struct DockingRuntime {
    pub socket_base: String,
    pub lrps: Vec<String>,
    pub db: Arc<Mutex<Connection>>,
    pub contracts: Arc<Mutex<ContractRegistry>>,
    pub rate_limiter: Arc<Mutex<RateLimiter>>,
    pub global_rate_limiter: Arc<Mutex<RateLimiter>>,
    pub agent_trust: Arc<Mutex<HashMap<String, u16>>>,
    pub agent_bundles: Arc<Mutex<HashMap<String, aep_agentmesh::AgentMeshBundle>>>,
    pub manifests: Arc<Mutex<crate::task_manifest::ManifestRegistry>>,
    pub dock_kem: Arc<KemKeypair>,
    pub agent_sign_keys: Arc<Mutex<AgentSignKeyStore>>,
    pub replay_guard: Arc<Mutex<ReplayGuard>>,
    pub live_entry: Arc<Mutex<LiveEntry>>,
    pub pulse: Arc<Mutex<PulseState>>,
    pub(crate) connection_limit: Arc<Semaphore>,
    pub(crate) stop: watch::Sender<bool>,
    pub(crate) inflight: Arc<Mutex<Vec<JoinHandle<()>>>>,
    sqlite_closed: AtomicBool,
}

impl DockingRuntime {
    pub fn new(socket_base: impl Into<String>, conn: Connection, lrps: &[String]) -> Self {
        let data_dir = conn
            .path()
            .and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
            .unwrap_or_else(crate::default_aep_data_dir);
        Self::with_data_dir(socket_base, conn, lrps, &data_dir)
    }

    pub fn with_data_dir(
        socket_base: impl Into<String>,
        conn: Connection,
        lrps: &[String],
        data_dir: &Path,
    ) -> Self {
        Self {
            socket_base: socket_base.into(),
            lrps: lrps.to_vec(),
            db: Arc::new(Mutex::new(conn)),
            contracts: Arc::new(Mutex::new(crate::bootstrap_contracts_from_lrps(lrps))),
            rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                SIGNER_RATE_LIMIT,
                Duration::from_secs(60),
            ))),
            global_rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                GLOBAL_RATE_LIMIT,
                Duration::from_secs(60),
            ))),
            agent_trust: Arc::new(Mutex::new(HashMap::new())),
            agent_bundles: Arc::new(Mutex::new(HashMap::new())),
            manifests: {
                let manifest_dir = std::env::var("AEP_TASK_MANIFEST_DIR")
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|_| data_dir.join("ucb").join("manifests"));
                let _ = std::fs::create_dir_all(&manifest_dir);
                Arc::new(Mutex::new(crate::task_manifest::ManifestRegistry::new(
                    manifest_dir,
                    true,
                )))
            },
            dock_kem: Arc::new(load_or_create_dock_kem(data_dir)),
            agent_sign_keys: Arc::new(Mutex::new(AgentSignKeyStore::load(data_dir))),
            replay_guard: Arc::new(Mutex::new(ReplayGuard::default())),
            live_entry: Arc::new(Mutex::new(load_live_entry(data_dir))),
            pulse: Arc::new(Mutex::new(PulseState::default())),
            connection_limit: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            stop: watch::channel(false).0,
            inflight: Arc::new(Mutex::new(Vec::new())),
            sqlite_closed: AtomicBool::new(false),
        }
    }

    pub fn port_specs(&self) -> Vec<DockingPortSpec> {
        docking_port_specs(&self.socket_base)
    }

    pub fn dock_kem_public(&self) -> &[u8] {
        &self.dock_kem.public
    }

    pub fn request_stop(&self) {
        let _ = self.stop.send(true);
    }

    pub fn is_stopping(&self) -> bool {
        *self.stop.borrow()
    }

    pub fn sqlite_is_closed(&self) -> bool {
        self.sqlite_closed.load(Ordering::SeqCst)
    }

    pub(crate) fn track_task(&self, handle: JoinHandle<()>) {
        match self.inflight.lock() {
            Ok(mut g) => g.push(handle),
            Err(p) => {
                let mut g = p.into_inner();
                g.push(handle);
            }
        }
    }

    pub(crate) fn take_inflight(&self) -> Vec<JoinHandle<()>> {
        match self.inflight.lock() {
            Ok(mut g) => std::mem::take(&mut *g),
            Err(p) => std::mem::take(&mut *p.into_inner()),
        }
    }

    pub fn close_sqlite(&self) {
        if self.sqlite_closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut g = match self.db.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let dummy = match Connection::open_in_memory() {
            Ok(c) => c,
            Err(_) => return,
        };
        let old = std::mem::replace(&mut *g, dummy);
        drop(g);
        let _ = old.close();
    }
}

fn sequence_from_plaintext(plaintext: &[u8]) -> i64 {
    serde_json::from_slice::<serde_json::Value>(plaintext)
        .ok()
        .and_then(|v| {
            v.get("_sequenceNumber")
                .and_then(|x| x.as_i64())
                .or_else(|| v.get("sequence_number").and_then(|x| x.as_i64()))
        })
        .unwrap_or(0)
}

pub(crate) fn pulse_now_ms(runtime: &DockingRuntime) -> Result<i64, DockFrameResponse> {
    let pulse = lock_or_deny(&runtime.pulse, "pulse")?;
    if let Some(ms) = pulse.clock_ms {
        return Ok(ms);
    }
    drop(pulse);
    let live = lock_or_deny(&runtime.live_entry, "live_entry")?;
    Ok(live.now_ms())
}

pub(crate) fn collect_applied(runtime: &DockingRuntime, digest: &str) -> DockFrameResponse {
    if digest.is_empty() {
        return deny_resp(None, String::from("collect requires digest"));
    }
    let _ = pulse_beat(runtime);
    let pulse = dock_lock!(&runtime.pulse, "pulse");
    if let Some(resp) = pulse.last_applied.get(digest) {
        return resp.clone();
    }
    if pulse.held.contains_key(digest) {
        return DockFrameResponse {
            ok: true,
            event_id: None,
            digest: Some(String::from(digest)),
            error: None,
            pong: None,
            http: None,
            deny: None,
        };
    }
    deny_resp(
        Some(String::from(digest)),
        format!("collect unknown digest: {digest}"),
    )
}

pub(crate) fn pulse_enqueue(
    runtime: &DockingRuntime,
    frame: &LatticeChannelFrame,
    plaintext: &[u8],
    expected_port: &DockingPort,
    digest: String,
    bundle: aep_agentmesh::AgentMeshBundle,
) -> DockFrameResponse {
    let freeze_ms = match pulse_now_ms(runtime) {
        Ok(ms) => ms,
        Err(resp) => return resp,
    };
    {
        let live = dock_lock!(&runtime.live_entry, "live_entry");
        let _ = live.now_ms();
    }
    let seq = sequence_from_plaintext(plaintext);
    let freeze = freeze_temporal_snapshot(freeze_ms, 0);
    let cap = QueuedCapsule {
        digest: digest.clone(),
        agent_id: frame.agent_id.clone(),
        sequence_number: seq,
        byte_len: plaintext.len(),
        freeze,
    };
    {
        let mut pulse = dock_lock!(&runtime.pulse, "pulse");
        if let Err(e) = pulse.queue.enqueue(cap) {
            return deny_resp(None, String::from(e.as_str()));
        }
        pulse.held.insert(
            digest.clone(),
            HeldCapsule {
                frame: frame.clone(),
                plaintext: plaintext.to_vec(),
                expected_port: *expected_port,
                bundle,
            },
        );
    }
    DockFrameResponse {
        ok: true,
        event_id: None,
        digest: Some(digest),
        error: None,
        pong: None,
        http: None,
        deny: None,
    }
}

pub fn pulse_beat(runtime: &DockingRuntime) -> BeatRelease {
    let now = match pulse_now_ms(runtime) {
        Ok(ms) => ms,
        Err(_) => return BeatRelease::default(),
    };
    let release = match lock_or_deny(&runtime.pulse, "pulse") {
        Ok(mut pulse) => pulse.queue.beat(now),
        Err(_) => return BeatRelease::default(),
    };
    for cap in &release.aged {
        finish_aged(runtime, cap);
    }
    for cap in &release.ready {
        apply_held_capsule(runtime, cap);
    }
    release
}

fn finish_aged(runtime: &DockingRuntime, cap: &QueuedCapsule) {
    let detail = String::from("pulse capsule aged out");
    if let Ok(mut pulse) = lock_or_deny(&runtime.pulse, "pulse") {
        pulse.held.remove(&cap.digest);
        pulse.last_applied.insert(
            cap.digest.clone(),
            deny_closed(
                Some(cap.digest.clone()),
                detail.clone(),
                "time.authority",
                CLASS_TEMPORAL,
            ),
        );
    }
    if let Ok(db) = lock_or_deny(&runtime.db, "db") {
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::EnvelopeAdmitRejected,
            &cap.agent_id,
            &DockingPort::ValidationEngine,
            detail,
        );
    }
}
