//! The driver of the multi-step red team corpus, shared by the tests that run it.
//!
//! One step of a chain becomes one opened event with its dock context. Each test
//! decides how the event meets Admit.
// Each test file compiles this module for itself and uses a part of it.
#![allow(dead_code)]

use aep_admit_live_dock::LiveDockContext;
use aep_live_entry::LiveEntry;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

const CORPUS_REL: &str = "../redteam/multistep-v1.json";

pub fn corpus() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(CORPUS_REL);
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => panic!("read {}: {e}", path.display()),
    };
    match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => panic!("corpus is not JSON: {e}"),
    }
}

pub fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

pub fn n(v: &Value, key: &str, default: u64) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(default)
}

/// Plain filler text of an exact byte length.
pub fn filler(len: usize) -> String {
    let unit = "data ";
    let mut out = String::with_capacity(len);
    while out.len() < len {
        out.push_str(unit);
    }
    out.truncate(len);
    out
}

/// The steps of one chain.
pub fn steps_of(chain: &Value) -> Vec<Value> {
    chain
        .get("steps")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default()
}

/// The clock of the corpus: its start and the default time between two steps.
pub fn clock_of(corpus: &Value) -> (i64, u64) {
    let clock = corpus.get("clock").cloned().unwrap_or(Value::Null);
    let start_ms = i64::try_from(n(&clock, "start_ms", 1_000_000)).unwrap_or(1_000_000);
    (start_ms, n(&clock, "step_ms", 250))
}

pub struct Run {
    pub live: LiveEntry,
    pub now_ms: i64,
    seq: HashMap<String, i64>,
}

impl Run {
    pub fn new(lattice: &Value, start_ms: i64) -> Self {
        let text = lattice.to_string();
        let mut live = match LiveEntry::from_yaml(&text) {
            Ok(l) => l,
            Err(e) => panic!("corpus lattice does not load: {e}"),
        };
        live.set_clock_ms(start_ms);
        Run {
            live,
            now_ms: start_ms,
            seq: HashMap::new(),
        }
    }

    /// Move the clock. Crossing a second boundary is a pulse beat that clears the
    /// per second event rate, as pulse_decay_rate does on the Base Node.
    pub fn advance(&mut self, ms: i64) {
        let before = self.now_ms / 1000;
        self.now_ms = self.now_ms.saturating_add(ms);
        if self.now_ms / 1000 != before {
            self.live.snapshot.event_rate = 0;
        }
        self.live.set_clock_ms(self.now_ms);
    }

    /// The opened event of one step and the dock context of its signer.
    pub fn event(&mut self, step: &Value, index: u64) -> (Vec<u8>, LiveDockContext) {
        let agent = s(step, "agent").to_string();
        let seq = self.seq.entry(agent.clone()).or_insert(0);
        *seq = seq.saturating_add(1);
        let target = s(step, "target").replace("{n}", &index.to_string());
        let target = if target.is_empty() {
            String::from("scene-rt")
        } else {
            target
        };
        let tool = s(step, "tool").replace("{n}", &index.to_string());
        let fill = usize::try_from(n(step, "fill", 0)).unwrap_or(0);
        let mut event = json!({
            "type": "CUSTOM",
            "action_path": s(step, "path"),
            "agent_id": agent,
            "timestamp": self.now_ms,
            "target_id": target,
            "_sequenceNumber": *seq,
            "payload": {
                "body": filler(fill),
                "note": s(step, "text"),
            }
        });
        if !tool.is_empty() {
            event["tool"] = Value::from(tool);
        }
        let mut dock = LiveDockContext::unit_open();
        dock.agent_id = agent;
        (event.to_string().into_bytes(), dock)
    }
}
