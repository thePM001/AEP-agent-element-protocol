//! Pulse queue enqueue and beat.

use super::dock_apply::apply_held_capsule;
use super::dock_apply::apply_display_after_admit;
use super::dock_rate::{GLOBAL_RATE_LIMIT, SIGNER_RATE_LIMIT};
use super::dock_serve::MAX_CONNECTIONS;
use super::{
    deny_closed, deny_resp, dock_lock, lock_or_deny, pending_held_response, DockFrameResponse,
};
use aep_base_node_pulse::{freeze_temporal_snapshot, BeatRelease, PulseQueue, QueuedCapsule};
use aep_lattice_channel::{ContractRegistry, DockingPort, LatticeChannelFrame, RateLimiter};
use aep_lattice_crypto::KemKeypair;
use aep_live_entry::LiveEntry;
use aep_agent_control_hub::{AgentControlHub, resolve_gap_root};
use aep_wall_set_backpressure::CLASS_SECURITY;
use aep_wall_set_backpressure::CLASS_TEMPORAL;
use crate::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use crate::envelope_admit::load_live_entry;
use crate::{
    docking_port_specs, record_side_channel_anomaly, DockingPortSpec, BaseNodeError, ReplayGuard,
    SideChannelAnomalyKind,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::collections::VecDeque;
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
    pub(crate) last_applied_at: HashMap<String, i64>,
    pub(crate) last_applied_order: VecDeque<String>,
    pub(crate) pending_display: HashMap<String, (String, Vec<u8>)>,
}

impl Default for PulseState {
    fn default() -> Self {
        Self {
            queue: PulseQueue::new(),
            held: HashMap::new(),
            clock_ms: None,
            last_applied_at: HashMap::new(),
            last_applied_order: VecDeque::new(),
            last_applied: HashMap::new(),
            pending_display: HashMap::new(),
        }
    }
}
    pub(crate) fn remember_applied(pulse: &mut PulseState, digest: String, resp: DockFrameResponse) {
        while pulse.last_applied.len() >= 4096 {
            let Some(old) = pulse.last_applied_order.pop_front() else {
                break;
            };
            pulse.last_applied.remove(&old);
            pulse.last_applied_at.remove(&old);
        }
        pulse.last_applied_at.insert(digest.clone(), crate::now_unix() as i64);
        pulse.last_applied.insert(digest.clone(), resp);
        pulse.last_applied_order.push_back(digest);
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
    pub hub: Arc<AgentControlHub>,
    pub pulse: Arc<Mutex<PulseState>>,
    pub display: Arc<Mutex<crate::dock_display::DisplayStaging>>,
    pub(crate) connection_limit: Arc<Semaphore>,
    pub(crate) stop: watch::Sender<bool>,
    pub(crate) inflight: Arc<Mutex<Vec<JoinHandle<()>>>>,
    sqlite_closed: AtomicBool,
}

impl DockingRuntime {
    pub fn new(socket_base: impl Into<String>, conn: Connection, lrps: &[String]) -> Result<Self, BaseNodeError> {
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
    ) -> Result<Self, BaseNodeError> {
    let mut live_entry = load_live_entry(data_dir)?;
    let display = crate::dock_display::DisplayStaging::load(data_dir)?;
    crate::dock_display::seed_pre_staged_display_actions(&mut live_entry, &display);
        Ok(Self {
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
            live_entry: Arc::new(Mutex::new(live_entry)),
            hub: {
                let loaded = match AgentControlHub::load_from_gap(&data_dir.join("gap")) {
                    Ok(h) => h,
                    Err(_) => match AgentControlHub::load_from_gap(&resolve_gap_root()) {
                    Ok(h) => h,
                    Err(e) => return Err(BaseNodeError::HubLoad(e.to_string())),
            },
                };
                Arc::new(loaded)
            },
            pulse: Arc::new(Mutex::new(PulseState::default())),
            display: Arc::new(Mutex::new(display)),
            connection_limit: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
            stop: watch::channel(false).0,
            inflight: Arc::new(Mutex::new(Vec::new())),
            sqlite_closed: AtomicBool::new(false),
        })
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

/// Seal stamp in milliseconds for a frame that carries one.
///
/// The kernel freezes the bridge clock at the seal, so a frame that carries its
/// own seal stamp is admitted against that stamp rather than against the time
/// the kernel happened to read the frame. The stamp must sit in the same second
/// as the frame seal, so the frame freshness walls still bound the frame and a
/// stamp that disagrees with the frame is ignored here.
fn seal_stamp_ms(frame: &LatticeChannelFrame, plaintext: &[u8]) -> Option<i64> {
    seal_stamp_in_second(frame.sent_at_unix, plaintext)
}

/// Seal stamp in milliseconds when it sits in the given frame second.
pub(crate) fn seal_stamp_in_second(frame_sec: u64, plaintext: &[u8]) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_slice(plaintext).ok()?;
    let ms = value.get("timestamp")?.as_i64()?;
    if ms <= 0 {
        return None;
    }
    let frame_sec = frame_sec as i64;
    if frame_sec <= 0 {
        return None;
    }
    if (ms / 1000 - frame_sec).abs() > 1 {
        return None;
    }
    Some(ms)
}

pub(crate) fn collect_applied(runtime: &DockingRuntime, digest: &str) -> DockFrameResponse {
    if digest.is_empty() {
        return deny_resp(None, String::from("collect requires digest"));
    }
    let _ = pulse_beat(runtime);
    apply_display_after_admit(runtime, digest);
    let mut pulse = dock_lock!(&runtime.pulse, "pulse");
    if let Some(&at) = pulse.last_applied_at.get(digest) {
        if crate::now_unix() as i64 - at > 600 {
            drop((pulse.last_applied.remove(digest), pulse.last_applied_at.remove(digest)))
        }
    }
    if let Some(resp) = pulse.last_applied.get(digest) {
        if resp.ok && resp.event_id.is_none() {
            return deny_closed(
                Some(String::from(digest)),
                String::from("collect allow missing event_id"),
                "collect.event_id",
                CLASS_SECURITY,
            );
        }
        return resp.clone();
    }
    if pulse.held.contains_key(digest) {
        return pending_held_response(String::from(digest));
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
    let mut freeze_ms = match pulse_now_ms(runtime) {
        Ok(ms) => ms,
        Err(resp) => return resp,
    };
    if let Some(ms) = seal_stamp_ms(frame, plaintext) {
        freeze_ms = ms;
    }
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
    {
        let db = dock_lock!(&runtime.db, "db");
        if let Err(e) = crate::persist_held_digest(&db, &digest, crate::now_unix() as i64) {
            return deny_closed(Some(digest), format!("ledger unavailable: {e}"), "ledger.unavailable", "ledger.unavailable");
        }
    }
    DockFrameResponse {
        ok: false,
        event_id: None,
        digest: Some(digest),
        error: None,
        pong: None,
        http: None,
        deny: None,
        pending: Some(true),
        http_queued: None,
        projection: None,
    }
}

/// Clear the per-second action counters for the whole live entry.
///
/// The periodic beat calls this once per PULSE_MS, so the lattice rate wall
/// reads the actions of the last second rather than a counter that never falls.
/// The per-request beat does not call this, so a burst inside one second still
/// reaches the wall.
pub fn pulse_decay_rate(runtime: &DockingRuntime) {
    if let Ok(mut live) = lock_or_deny(&runtime.live_entry, "live_entry") {
        live.snapshot.event_rate = 0;
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
        remember_applied(&mut pulse, cap.digest.clone(), deny_closed(
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
