//! Owned slices of DockingRuntime. Callers take the slice they need.
use crate::dock_keys::AgentSignKeyStore;
use aep_agent_control_hub::AgentControlHub;
use aep_lattice_channel::{ContractRegistry, RateLimiter};
use aep_lattice_crypto::KemKeypair;
use aep_live_entry::LiveEntry;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Mutex};
use tokio::sync::{watch, Semaphore};
use tokio::task::JoinHandle;
pub struct DockIo {
    pub socket_base: String,
    /// Connection slots of each docking port, in the order of [`port_slot_index`]. Each
    /// port holds its own share, so connections that fill one port leave the others free.
    pub port_slots: [Arc<Semaphore>; 4],
    /// A connection that completes no line within this time is closed.
    pub idle_timeout: std::time::Duration,
    pub stop: watch::Sender<bool>,
    pub inflight: Arc<Mutex<Vec<JoinHandle<()>>>>,
    /// Last refused TLS handshake. Stored for health and never a stop signal.
    pub last_tls_handshake_err: Mutex<Option<String>>,
    /// Tasks the last drain had to abort after DRAIN_JOIN_TIMEOUT.
    pub drain_aborted_tasks: AtomicU64,
}
pub struct DockKeys {
    pub dock_kem: Arc<KemKeypair>,
    pub agent_sign_keys: Arc<Mutex<AgentSignKeyStore>>,
    pub agent_bundles: Arc<Mutex<HashMap<String, aep_agentmesh::AgentMeshBundle>>>,
    pub agent_trust: Arc<Mutex<HashMap<String, u16>>>,
}
pub struct DockDefence {
    pub rate_limiter: Arc<Mutex<RateLimiter>>,
    pub global_rate_limiter: Arc<Mutex<RateLimiter>>,
    pub replay_guard: Arc<Mutex<crate::ReplayGuard>>,
}
pub struct DockAdmit {
    pub contracts: Arc<Mutex<ContractRegistry>>,
    pub lrps: Vec<String>,
    pub manifests: Arc<Mutex<crate::task_manifest::ManifestRegistry>>,
    pub live_entry: Arc<Mutex<LiveEntry>>,
    pub hub: Arc<AgentControlHub>,
}
pub struct DockRecord {
    pub db: Arc<Mutex<Connection>>,
    pub pulse: Arc<Mutex<crate::docking::PulseState>>,
    pub sqlite_closed: AtomicBool,
}
/// Index of a docking port in [`DockIo::port_slots`].
pub fn port_slot_index(port: aep_lattice_channel::DockingPort) -> usize {
    use aep_lattice_channel::DockingPort;
    match port {
        DockingPort::InferenceEngine => 0,
        DockingPort::ValidationEngine => 1,
        DockingPort::FutureFeatures => 2,
        DockingPort::RegulationModule => 3,
    }
}
impl DockIo {
    /// The connection slots of one docking port.
    pub fn port_slot(&self, port: aep_lattice_channel::DockingPort) -> Arc<Semaphore> {
        self.port_slots[port_slot_index(port)].clone()
    }
    pub fn request_stop(&self) {
        self.stop.send_replace(true);
    }
    pub fn is_stopping(&self) -> bool {
        *self.stop.borrow()
    }
}
