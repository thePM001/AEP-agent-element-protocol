//! Pulse queue enqueue and beat.

use super::apply::apply_held_capsule;
use super::rate::{GLOBAL_RATE_LIMIT, SIGNER_RATE_LIMIT};
use super::serve::MAX_CONNECTIONS;
use super::{
    deny_closed, deny_resp, dock_lock, lock_or_deny, pending_held_response, DockFrameResponse,
};
use crate::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use crate::envelope_admit::load_live_entry;
use crate::{
    docking_port_specs, record_side_channel_anomaly, BaseNodeError, DockingPortSpec, ReplayGuard,
    SideChannelAnomalyKind,
};
use aep_agent_control_hub::{resolve_gap_root, AgentControlHub};
use aep_base_node_pulse::{
    freeze_temporal_snapshot, BeatRelease, EnqueueDeny, PulseQueue, QueuedCapsule, MAX_AGE_MS,
    MAX_DRIFT_MS,
};
use aep_lattice_channel::{DockingPort, LatticeChannelFrame, RateLimiter};
use aep_wall_set_backpressure::CLASS_SECURITY;
use aep_wall_set_backpressure::CLASS_TEMPORAL;
use rusqlite::Connection;
use std::collections::HashMap;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;

#[derive(Clone)]
pub(crate) struct HeldCapsule {
    pub(crate) frame: LatticeChannelFrame,
    pub(crate) plaintext: Vec<u8>,
    pub(crate) expected_port: DockingPort,
    pub(crate) bundle: aep_agentmesh::AgentMeshBundle,
    /// Event time that the time walls of Admit measure against: the stamp of the agent
    /// once the kernel checked it against its own clock at enqueue. It is the arrival
    /// reading of the kernel clock when the event carries no stamp.
    pub(crate) wall_bridge_ms: i64,
}

pub struct PulseState {
    pub(crate) queue: PulseQueue,
    pub(crate) held: HashMap<String, HeldCapsule>,
    pub(crate) clock_ms: Option<i64>,
    pub(crate) last_applied: HashMap<String, DockFrameResponse>,
    pub(crate) last_applied_at: HashMap<String, i64>,
    pub(crate) last_applied_order: VecDeque<String>,
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
    pulse
        .last_applied_at
        .insert(digest.clone(), crate::now_unix() as i64);
    pulse.last_applied.insert(digest.clone(), resp);
    pulse.last_applied_order.push_back(digest);
}

/// Record the answer for a held digest and drop it from the held map in one step.
///
/// A digest must sit in `held` or in `last_applied` at every instant that the
/// pulse lock is free, so a collect never finds it nowhere.
pub(crate) fn settle_held(pulse: &mut PulseState, digest: &str, resp: DockFrameResponse) {
    pulse.held.remove(digest);
    remember_applied(pulse, String::from(digest), resp);
}

pub struct DockingRuntime {
    pub io: crate::dock_parts::DockIo,
    pub keys: crate::dock_parts::DockKeys,
    pub defence: crate::dock_parts::DockDefence,
    pub admit: crate::dock_parts::DockAdmit,
    pub record: crate::dock_parts::DockRecord,
}

impl DockingRuntime {
    pub fn new(
        socket_base: impl Into<String>,
        conn: Connection,
        lrps: &[String],
    ) -> Result<Self, BaseNodeError> {
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
        let live_entry = load_live_entry(data_dir)?;
        Ok(Self {
            io: crate::dock_parts::DockIo {
                socket_base: socket_base.into(),
                connection_limit: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
                stop: watch::channel(false).0,
                inflight: Arc::new(Mutex::new(Vec::new())),
                last_tls_handshake_err: Mutex::new(None),
                drain_aborted_tasks: AtomicU64::new(0),
            },
            keys: crate::dock_parts::DockKeys {
                dock_kem: Arc::new(load_or_create_dock_kem(data_dir)),
                agent_sign_keys: Arc::new(Mutex::new(AgentSignKeyStore::load(data_dir))),
                agent_bundles: Arc::new(Mutex::new(HashMap::new())),
                agent_trust: Arc::new(Mutex::new(HashMap::new())),
            },
            defence: crate::dock_parts::DockDefence {
                rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                    SIGNER_RATE_LIMIT,
                    Duration::from_secs(60),
                ))),
                global_rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                    GLOBAL_RATE_LIMIT,
                    Duration::from_secs(60),
                ))),
                replay_guard: Arc::new(Mutex::new(ReplayGuard::default())),
            },
            admit: crate::dock_parts::DockAdmit {
                contracts: Arc::new(Mutex::new(crate::bootstrap_contracts_from_lrps(lrps))),
                lrps: lrps.to_vec(),
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
            },
            record: crate::dock_parts::DockRecord {
                db: Arc::new(Mutex::new(conn)),
                pulse: Arc::new(Mutex::new(PulseState::default())),
                sqlite_closed: AtomicBool::new(false),
            },
        })
    }
    pub fn port_specs(&self) -> Vec<DockingPortSpec> {
        docking_port_specs(&self.io.socket_base)
    }

    pub fn dock_kem_public(&self) -> &[u8] {
        &self.keys.dock_kem.public
    }

    pub fn request_stop(&self) {
        self.io.stop.send_replace(true);
    }

    pub fn is_stopping(&self) -> bool {
        *self.io.stop.borrow()
    }

    pub fn sqlite_is_closed(&self) -> bool {
        self.record.sqlite_closed.load(Ordering::SeqCst)
    }

    /// True when all four unix dock sockets exist on disk.
    pub fn docking_ports_listening(&self) -> bool {
        super::serve::sockets_exist(&self.io.socket_base)
    }

    pub fn last_tls_handshake_err(&self) -> Option<String> {
        match self.io.last_tls_handshake_err.lock() {
            Ok(g) => g.clone(),
            Err(p) => p.into_inner().clone(),
        }
    }

    pub(crate) fn note_last_tls_handshake_err(&self, detail: String) {
        match self.io.last_tls_handshake_err.lock() {
            Ok(mut g) => *g = Some(detail),
            Err(p) => *p.into_inner() = Some(detail),
        }
    }

    pub fn drain_aborted_tasks(&self) -> u64 {
        self.io.drain_aborted_tasks.load(Ordering::SeqCst)
    }

    pub(crate) fn track_task(&self, handle: JoinHandle<()>) {
        match self.io.inflight.lock() {
            Ok(mut g) => g.push(handle),
            Err(p) => {
                let mut g = p.into_inner();
                g.push(handle);
            }
        }
    }

    pub(crate) fn take_inflight(&self) -> Vec<JoinHandle<()>> {
        match self.io.inflight.lock() {
            Ok(mut g) => std::mem::take(&mut *g),
            Err(p) => std::mem::take(&mut *p.into_inner()),
        }
    }

    pub fn close_sqlite(&self) {
        if self.record.sqlite_closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let mut g = match self.record.db.lock() {
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

// DockFrameResponse is the reply the node sends as is, so the deny path returns it unboxed.
#[allow(clippy::result_large_err)]
pub(crate) fn pulse_now_ms(runtime: &DockingRuntime) -> Result<i64, DockFrameResponse> {
    let pulse = lock_or_deny(&runtime.record.pulse, "pulse")?;
    if let Some(ms) = pulse.clock_ms {
        return Ok(ms);
    }
    drop(pulse);
    let live = lock_or_deny(&runtime.admit.live_entry, "live_entry")?;
    Ok(live.now_ms())
}

/// Stamp of the agent in milliseconds, when the opened event carries one.
///
/// The stamp is a claim of the agent. The kernel never adopts it as its own clock:
/// the freeze reads the kernel clock and the stamp is compared with that clock.
pub(crate) fn agent_stamp_ms(plaintext: &[u8]) -> Option<i64> {
    let value: serde_json::Value = serde_json::from_slice(plaintext).ok()?;
    let ms = value.get("timestamp")?.as_i64()?;
    if ms <= 0 {
        return None;
    }
    Some(ms)
}

/// Closed wall id and detail when the stamp of the agent sits outside its window around
/// the kernel clock. None when the stamp is inside the window.
///
/// The window is not symmetric. A stamp is written before the seal and read after the
/// transit, so an agent whose clock agrees with the kernel always arrives with a stamp
/// in the past. Ahead of the kernel clock only clock drift can put a stamp, so that side
/// holds the drift bound. Behind the kernel clock the stamp may be as old as the age
/// bound, which is the time the seal and the transit may take.
pub(crate) fn stamp_outside_window(
    stamp_ms: i64,
    kernel_ms: i64,
    max_drift_ms: i64,
    max_age_ms: i64,
) -> Option<(&'static str, String)> {
    let ahead = stamp_ms.saturating_sub(kernel_ms);
    if ahead > max_drift_ms {
        return Some((
            "temporal:future_skew",
            format!(
                "agent stamp is {ahead} ms ahead of the kernel clock: future skew over the {max_drift_ms} ms drift bound"
            ),
        ));
    }
    let behind = kernel_ms.saturating_sub(stamp_ms);
    if behind > max_age_ms {
        return Some((
            "temporal:stale_event",
            format!(
                "agent stamp is {behind} ms behind the kernel clock: stale over the {max_age_ms} ms age bound"
            ),
        ));
    }
    None
}

pub(crate) fn collect_applied(runtime: &DockingRuntime, digest: &str) -> DockFrameResponse {
    if digest.is_empty() {
        return deny_resp(None, String::from("collect requires digest"));
    }
    let _ = pulse_beat(runtime);
    let mut pulse = dock_lock!(&runtime.record.pulse, "pulse");
    if let Some(&at) = pulse.last_applied_at.get(digest) {
        if crate::now_unix() as i64 - at > 600 {
            drop((
                pulse.last_applied.remove(digest),
                pulse.last_applied_at.remove(digest),
            ))
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
    kernel_ms: i64,
) -> DockFrameResponse {
    // The freeze is the kernel clock as read when the frame arrived. The stamp of the
    // agent never becomes the freeze, so a capsule is held for one pulse of kernel time
    // whatever the agent stamped. The kernel clock also decides whether the stamp is
    // acceptable: the check below runs before the capsule takes room in the queue.
    let (max_drift_ms, max_age_ms) = {
        let live = dock_lock!(&runtime.admit.live_entry, "live_entry");
        let drift = if live.snapshot.max_drift_ms > 0 {
            live.snapshot.max_drift_ms
        } else {
            MAX_DRIFT_MS
        };
        let age = if live.snapshot.max_age_ms > 0 {
            live.snapshot.max_age_ms
        } else {
            MAX_AGE_MS
        };
        (drift, age)
    };
    // A stamp outside its window is refused here. An event without a stamp goes on to
    // Admit, whose time walls close with the report. A stamp inside the window is the
    // event time that the time walls of Admit measure against, so the time the seal and
    // the transit took is not read as clock drift.
    let stamp = agent_stamp_ms(plaintext);
    if let Some(stamp_ms) = stamp {
        if let Some((wall_id, detail)) =
            stamp_outside_window(stamp_ms, kernel_ms, max_drift_ms, max_age_ms)
        {
            let db = dock_lock!(&runtime.record.db, "db");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::StaleFrameRejected,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return deny_closed(None, detail, wall_id, CLASS_TEMPORAL);
        }
    }
    let wall_bridge_ms = stamp.unwrap_or(kernel_ms);
    let seq = sequence_from_plaintext(plaintext);
    let freeze = freeze_temporal_snapshot(kernel_ms, 0);
    let cap = QueuedCapsule {
        digest: digest.clone(),
        agent_id: frame.agent_id.clone(),
        sequence_number: seq,
        byte_len: plaintext.len(),
        freeze,
    };
    // The held digest is recorded before the capsule enters the queue. When the ledger
    // refuses the record the caller reads a deny and no capsule exists that a later beat
    // could apply.
    {
        let db = dock_lock!(&runtime.record.db, "db");
        if let Err(e) = crate::persist_held_digest(&db, &digest, crate::now_unix() as i64) {
            return deny_closed(
                Some(digest),
                format!("ledger unavailable: {e}"),
                "ledger.unavailable",
                "ledger.unavailable",
            );
        }
    }
    let refused = {
        let mut pulse = dock_lock!(&runtime.record.pulse, "pulse");
        match pulse.queue.enqueue(cap) {
            Ok(()) => {
                pulse.held.insert(
                    digest.clone(),
                    HeldCapsule {
                        frame: frame.clone(),
                        plaintext: plaintext.to_vec(),
                        expected_port: *expected_port,
                        bundle,
                        wall_bridge_ms,
                    },
                );
                None
            }
            Err(e) => Some(e),
        }
    };
    if let Some(e) = refused {
        // The queue refused the capsule, so its held record is taken back. A duplicate
        // digest keeps the record: it belongs to the capsule that is already queued.
        if e != EnqueueDeny::DuplicateDigest {
            if let Ok(db) = lock_or_deny(&runtime.record.db, "db") {
                let _ = crate::forget_held_digest(&db, &digest);
            }
        }
        return deny_resp(None, String::from(e.as_str()));
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
    }
}

/// Clear the per-second action counters for the whole live entry.
///
/// The periodic beat calls this once per PULSE_MS, so the lattice rate wall
/// reads the actions of the last second rather than a counter that never falls.
/// The per-request beat does not call this, so a burst inside one second still
/// reaches the wall.
pub fn pulse_decay_rate(runtime: &DockingRuntime) {
    if let Ok(mut live) = lock_or_deny(&runtime.admit.live_entry, "live_entry") {
        live.snapshot.event_rate = 0;
    }
}

pub fn pulse_beat(runtime: &DockingRuntime) -> BeatRelease {
    let now = match pulse_now_ms(runtime) {
        Ok(ms) => ms,
        Err(_) => return BeatRelease::default(),
    };
    let release = match lock_or_deny(&runtime.record.pulse, "pulse") {
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
    if let Ok(mut pulse) = lock_or_deny(&runtime.record.pulse, "pulse") {
        settle_held(
            &mut pulse,
            &cap.digest,
            deny_closed(
                Some(cap.digest.clone()),
                detail.clone(),
                "time.authority",
                CLASS_TEMPORAL,
            ),
        );
    }
    if let Ok(db) = lock_or_deny(&runtime.record.db, "db") {
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::EnvelopeAdmitRejected,
            &cap.agent_id,
            &DockingPort::ValidationEngine,
            detail,
        );
    }
}
