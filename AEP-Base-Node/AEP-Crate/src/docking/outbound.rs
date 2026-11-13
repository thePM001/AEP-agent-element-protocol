//! The bound outbound request of an admitted gateway frame, off the pulse.
//!
//! Admit decides the gateway path with two walls: the operator route list and the request
//! bound of the signer. The bound is a slot that Apply reserves before Admit runs and that
//! the request returns when it settles. An admitted gateway frame leaves the held map for
//! the in flight book, its request runs on a thread of its own and its answer is recorded
//! when the request ends. A collect of the digest reads pending until then, so neither the
//! pulse nor an async worker ever waits on a remote server.

use super::pulse::{remember_applied, PulseState};
use super::{deny_closed, DockFrameResponse};
use aep_lattice_gated_fetch::{
    execute_bound_http_after_allow_with_policy, GatewayRoutes, GatewaySpec, SsrfPolicy,
};
use aep_wall_set_backpressure::CLASS_SECURITY;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

/// Outbound requests one signer may hold in flight.
pub(crate) const MAX_OUTBOUND_PER_AGENT: usize = 2;
/// Outbound requests the whole Base Node may hold in flight.
pub(crate) const MAX_OUTBOUND_TOTAL: usize = 16;

/// The route list and the address policy of the gateway path, read once at start.
pub struct DockOutbound {
    pub routes: GatewayRoutes,
    /// Why the route list file was refused. A refused file opens no route.
    pub routes_error: Option<String>,
    pub policy: SsrfPolicy,
}

impl DockOutbound {
    /// The route list of the data folder and the address policy of the environment.
    pub fn load(data_dir: &std::path::Path) -> Self {
        let (routes, routes_error) = match GatewayRoutes::load_for_data_dir(data_dir) {
            Ok(r) => (r, None),
            Err(e) => (GatewayRoutes::empty(), Some(e)),
        };
        Self {
            routes,
            routes_error,
            policy: SsrfPolicy::from_env(),
        }
    }

    /// The verdict of the route wall for one request.
    pub(crate) fn route_verdict(&self, spec: &GatewaySpec) -> Result<(), String> {
        if let Some(e) = &self.routes_error {
            return Err(format!("the gateway route list was refused at start: {e}"));
        }
        self.routes.route_for(spec).map(|_| ())
    }
}

/// Slots and in flight digests of the outbound requests. It lives in the pulse state, so
/// a digest moves from the held map to this book in one pulse lock step.
#[derive(Default)]
pub(crate) struct OutboundBook {
    by_agent: HashMap<String, usize>,
    total: usize,
    in_flight: HashMap<String, String>,
}

impl OutboundBook {
    /// Take one slot for the signer. False when the signer or the node holds its bound.
    pub(crate) fn reserve(&mut self, agent: &str) -> bool {
        let held = self.by_agent.get(agent).copied().unwrap_or(0);
        if held >= MAX_OUTBOUND_PER_AGENT || self.total >= MAX_OUTBOUND_TOTAL {
            return false;
        }
        self.by_agent.insert(String::from(agent), held + 1);
        self.total += 1;
        true
    }

    /// Return one slot of the signer.
    pub(crate) fn release(&mut self, agent: &str) {
        if let Some(n) = self.by_agent.get_mut(agent) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                self.by_agent.remove(agent);
            }
            self.total = self.total.saturating_sub(1);
        }
    }

    pub(crate) fn is_in_flight(&self, digest: &str) -> bool {
        self.in_flight.contains_key(digest)
    }

    /// Slots the signer holds, reserved or in flight.
    #[cfg(test)]
    pub(crate) fn held_by(&self, agent: &str) -> usize {
        self.by_agent.get(agent).copied().unwrap_or(0)
    }
}

fn pulse_guard(pulse: &Mutex<PulseState>) -> MutexGuard<'_, PulseState> {
    // A settle must always run, so a poisoned pulse lock is taken over and not refused.
    match pulse.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

/// A reserved request slot. It returns to the book when dropped, unless the admitted
/// request takes it over with [`SlotGuard::hand_to_request`].
pub(crate) struct SlotGuard<'a> {
    pulse: &'a Mutex<PulseState>,
    agent: String,
    armed: bool,
}

impl SlotGuard<'_> {
    /// The request now owns the slot and returns it when it settles.
    pub(crate) fn hand_to_request(mut self) {
        self.armed = false;
    }
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            pulse_guard(self.pulse).outbound.release(&self.agent);
        }
    }
}

/// Reserve a slot of the signer before Admit. None when the signer or the node holds its
/// bound. Whether a slot came back becomes the bound wall of Admit.
pub(crate) fn reserve_slot<'a>(pulse: &'a Mutex<PulseState>, agent: &str) -> Option<SlotGuard<'a>> {
    if pulse_guard(pulse).outbound.reserve(agent) {
        Some(SlotGuard {
            pulse,
            agent: String::from(agent),
            armed: true,
        })
    } else {
        None
    }
}

/// One admitted gateway request, with its slot.
pub(crate) struct OutboundJob {
    pub(crate) digest: String,
    pub(crate) agent_id: String,
    pub(crate) event_id: i64,
    pub(crate) spec: GatewaySpec,
}

/// The pending answer of a digest whose request is in flight.
pub(crate) fn outbound_pending_response(digest: &str) -> DockFrameResponse {
    DockFrameResponse {
        ok: false,
        event_id: None,
        digest: Some(String::from(digest)),
        error: None,
        pong: None,
        http: None,
        deny: None,
        pending: Some(true),
        http_queued: Some(true),
    }
}

fn settled_answer(
    job: &OutboundJob,
    result: Result<aep_lattice_gated_fetch::DockHttp, String>,
) -> DockFrameResponse {
    let (ok, http, error) = match result {
        Ok(http) => (true, Some(http), None),
        // The row was written before the request, so a failed request answers not ok and
        // still carries the event id of that row.
        Err(e) => (false, None, Some(e)),
    };
    DockFrameResponse {
        ok,
        event_id: Some(job.event_id),
        digest: Some(job.digest.clone()),
        error,
        pong: None,
        http,
        deny: None,
        pending: None,
        http_queued: None,
    }
}

/// Record the answer of a request, end its in flight entry and return its slot, in one
/// pulse lock step.
fn settle(pulse: &Mutex<PulseState>, job: &OutboundJob, resp: DockFrameResponse) {
    let mut g = pulse_guard(pulse);
    g.outbound.in_flight.remove(&job.digest);
    g.outbound.release(&job.agent_id);
    remember_applied(&mut g, job.digest.clone(), resp);
}

/// Settles the request with a Deny when its thread ends before it recorded an answer, so
/// the digest never stays in flight and the slot always comes back.
struct SettleGuard {
    pulse: Arc<Mutex<PulseState>>,
    job: Option<OutboundJob>,
}

impl SettleGuard {
    fn finish(mut self, resp: DockFrameResponse) {
        if let Some(job) = self.job.take() {
            settle(&self.pulse, &job, resp);
        }
    }
}

impl Drop for SettleGuard {
    fn drop(&mut self) {
        if let Some(job) = self.job.take() {
            let resp = deny_closed(
                Some(job.digest.clone()),
                String::from("outbound request ended before the answer was recorded"),
                "outbound.interrupted",
                CLASS_SECURITY,
            );
            settle(&self.pulse, &job, resp);
        }
    }
}

fn run_job(pulse: Arc<Mutex<PulseState>>, policy: SsrfPolicy, job: OutboundJob) {
    let spec = job.spec.clone();
    let guard = SettleGuard {
        pulse,
        job: Some(job),
    };
    let result = execute_bound_http_after_allow_with_policy(&spec, &policy);
    let resp = match &guard.job {
        Some(job) => settled_answer(job, result),
        None => return,
    };
    crate::dock_event!(
        debug,
        crate::dock_log::DockEvent::FrameOutbound,
        digest = resp.digest.as_deref().unwrap_or(""),
        ok = resp.ok,
        "outbound request settled"
    );
    guard.finish(resp);
}

/// Move an admitted gateway frame from the held map to the in flight book and start its
/// request on a thread of its own. The digest sits in the held map, the book or the
/// answers at every instant that the pulse lock is free.
pub(crate) fn start(pulse: &Arc<Mutex<PulseState>>, policy: SsrfPolicy, job: OutboundJob) {
    {
        let mut g = pulse_guard(pulse);
        g.held.remove(&job.digest);
        g.outbound
            .in_flight
            .insert(job.digest.clone(), job.agent_id.clone());
    }
    let digest = job.digest.clone();
    let agent_id = job.agent_id.clone();
    let event_id = job.event_id;
    let thread_pulse = pulse.clone();
    let spawned = std::thread::Builder::new()
        .name(String::from("aep-outbound"))
        .spawn(move || run_job(thread_pulse, policy, job));
    if let Err(e) = spawned {
        // The closure and its job are gone with the failed spawn, so the answer is
        // recorded here from the copies.
        let failed = OutboundJob {
            digest,
            agent_id,
            event_id,
            spec: GatewaySpec::default(),
        };
        let resp = settled_answer(
            &failed,
            Err(format!(
                "lattice-gated-fetch: outbound thread did not start: {e}"
            )),
        );
        settle(pulse, &failed, resp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slots_bound_one_agent_and_the_node() {
        let mut book = OutboundBook::default();
        for _ in 0..MAX_OUTBOUND_PER_AGENT {
            assert!(book.reserve("a"));
        }
        assert!(!book.reserve("a"), "one agent took more than its share");
        assert_eq!(book.held_by("a"), MAX_OUTBOUND_PER_AGENT);
        book.release("a");
        assert!(book.reserve("a"));
        let mut n = 0usize;
        let mut agent = 0usize;
        while book.total < MAX_OUTBOUND_TOTAL {
            if book.reserve(&format!("b{agent}")) {
                n += 1;
            } else {
                agent += 1;
            }
        }
        assert!(n > 0);
        assert!(!book.reserve("fresh"), "the node took more than its bound");
        // A release of an agent without a slot changes nothing.
        let before = book.total;
        book.release("nobody");
        assert_eq!(book.total, before);
    }

    #[test]
    fn a_slot_returns_unless_the_request_takes_it() {
        let pulse = Mutex::new(PulseState::default());
        {
            let _refused = reserve_slot(&pulse, "a").expect("slot");
        }
        assert_eq!(pulse_guard(&pulse).outbound.held_by("a"), 0);
        reserve_slot(&pulse, "a").expect("slot").hand_to_request();
        assert_eq!(pulse_guard(&pulse).outbound.held_by("a"), 1);
    }

    #[test]
    fn a_job_whose_thread_ends_early_is_settled_with_a_deny_and_its_slot_returns() {
        let pulse = Arc::new(Mutex::new(PulseState::default()));
        reserve_slot(&pulse, "a").expect("slot").hand_to_request();
        pulse_guard(&pulse)
            .outbound
            .in_flight
            .insert(String::from("d1"), String::from("a"));
        drop(SettleGuard {
            pulse: pulse.clone(),
            job: Some(OutboundJob {
                digest: String::from("d1"),
                agent_id: String::from("a"),
                event_id: 7,
                spec: GatewaySpec::default(),
            }),
        });
        let g = pulse_guard(&pulse);
        assert!(!g.outbound.is_in_flight("d1"));
        assert_eq!(g.outbound.held_by("a"), 0);
        let resp = g.last_applied.get("d1").expect("answer");
        assert!(!resp.ok);
        assert!(resp.deny.is_some());
    }
}
