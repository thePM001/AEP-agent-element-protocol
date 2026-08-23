//! Sparse vector clocks and causal order. Hot path is HashMap only.
//! @PAD: aep-sdk-dynaep-causal
//! @GCDE: gaplune.code.v1

use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Default)]
pub struct SparseVectorClock {
    entries: HashMap<String, u64>,
}

impl SparseVectorClock {
    pub fn from_map(m: HashMap<String, u64>) -> Self {
        Self { entries: m.into_iter().filter(|(_, v)| *v > 0).collect() }
    }
    pub fn get(&self, agent: &str) -> u64 { self.entries.get(agent).copied().unwrap_or(0) }
    pub fn increment(&mut self, agent: &str) { *self.entries.entry(agent.to_string()).or_insert(0) += 1; }
    pub fn merge(&mut self, other: &Self) {
        for (k, v) in &other.entries {
            let e = self.entries.entry(k.clone()).or_insert(0);
            if *v > *e { *e = *v; }
        }
    }
    pub fn dominates(&self, other: &Self) -> bool {
        for (k, ov) in &other.entries { if self.get(k) < *ov { return false; } }
        self.entries.iter().any(|(k, v)| *v > other.get(k))
    }
}

#[derive(Debug, Clone)]
pub struct CausalEvent {
    pub event_id: String,
    pub agent_id: String,
    pub sequence_number: u64,
    pub target_element_id: String,
}

#[derive(Debug, Clone)]
pub struct CausalOrderResult { pub ordered: bool, pub violations: Vec<String> }

pub struct CausalOrderingEngine {
    last_seq: HashMap<String, u64>,
    buffer: VecDeque<CausalEvent>,
    max_buf: usize,
}

impl CausalOrderingEngine {
    pub fn new(max_buf: usize) -> Self {
        Self { last_seq: HashMap::new(), buffer: VecDeque::new(), max_buf }
    }
    pub fn process(&mut self, ev: CausalEvent) -> CausalOrderResult {
        let last = self.last_seq.get(&ev.agent_id).copied().unwrap_or(0);
        if ev.sequence_number == last {
            return CausalOrderResult { ordered: false, violations: vec![format!("duplicate_sequence {}", ev.sequence_number)] };
        }
        if ev.sequence_number < last {
            return CausalOrderResult { ordered: false, violations: vec![format!("agent_clock_regression seq {} last {}", ev.sequence_number, last)] };
        }
        if ev.sequence_number > last + 1 {
            if self.buffer.len() >= self.max_buf {
                return CausalOrderResult { ordered: false, violations: vec!["reorder buffer full".into()] };
            }
            self.buffer.push_back(ev);
            return CausalOrderResult { ordered: false, violations: vec!["out_of_order".into()] };
        }
        self.last_seq.insert(ev.agent_id.clone(), ev.sequence_number);
        CausalOrderResult { ordered: true, violations: Vec::new() }
    }
}
