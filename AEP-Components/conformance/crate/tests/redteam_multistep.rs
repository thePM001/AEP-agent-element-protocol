//! CC-35. The multi-step red team corpus.
//!
//! Every case of AEP-Components/conformance/redteam/multistep-v1.json is a chain
//! of actions that each look permitted on their own and that together reach a
//! forbidden outcome: data leaving in small slices, slices spread over several
//! agents of one wrap, sensitive reads summed past a limit, probing of new
//! targets one after another and steps that try to climb past a grant. The
//! harness drives every step through the Base Node live dock entry
//! (envelope_admit::admit_sealed_payload_report) with the reference policy
//! system of this repository, so the walls that answer are the product walls.
//! The pulse decay of the per second event rate is emulated between beats.
//!
//! A case passes when every step answers as the corpus expects and the step
//! that reaches the forbidden outcome is denied by the named wall. Control
//! chains spread the same kind of work over time and every step is allowed,
//! so the corpus also shows the budgets do not deny ordinary work.
use aep_admit_live_dock::LiveDockContext;
use aep_base_node::envelope_admit::admit_sealed_payload_report;
use aep_live_entry::LiveEntry;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;

const CORPUS_REL: &str = "../redteam/multistep-v1.json";
const MIN_CASES: usize = 50;

fn corpus() -> Value {
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

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn n(v: &Value, key: &str, default: u64) -> u64 {
    v.get(key).and_then(|x| x.as_u64()).unwrap_or(default)
}

/// Plain filler text of an exact byte length.
fn filler(len: usize) -> String {
    let unit = "data ";
    let mut out = String::with_capacity(len);
    while out.len() < len {
        out.push_str(unit);
    }
    out.truncate(len);
    out
}

struct Run {
    live: LiveEntry,
    now_ms: i64,
    seq: HashMap<String, i64>,
}

impl Run {
    fn new(lattice: &Value, start_ms: i64) -> Self {
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
    fn advance(&mut self, ms: i64) {
        let before = self.now_ms / 1000;
        self.now_ms = self.now_ms.saturating_add(ms);
        if self.now_ms / 1000 != before {
            self.live.snapshot.event_rate = 0;
        }
        self.live.set_clock_ms(self.now_ms);
    }

    fn submit(&mut self, step: &Value, index: u64) -> Result<(), Vec<String>> {
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
        let bytes = event.to_string().into_bytes();
        match admit_sealed_payload_report(&mut self.live, &bytes, &dock) {
            Ok(()) => Ok(()),
            Err(report) => Err(report.closed.iter().map(|w| w.id.clone()).collect()),
        }
    }
}

/// Run one chain. Returns the failures and whether the last step was a deny by its named wall.
fn run_chain(c: &Value, lattice: &Value, start_ms: i64, step_ms: u64) -> (Vec<String>, bool) {
    let id = s(c, "id");
    let mut run = Run::new(lattice, start_ms);
    let mut failures = Vec::new();
    let mut last_denied_as_named = false;
    let steps = c
        .get("steps")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    if steps.is_empty() {
        failures.push(format!("{id}: no steps"));
    }
    for (si, step) in steps.iter().enumerate() {
        let repeat = n(step, "repeat", 1);
        let advance = i64::try_from(n(step, "advance_ms", step_ms)).unwrap_or(0);
        let expect = s(step, "expect");
        let wall = s(step, "wall");
        for r in 0..repeat {
            run.advance(advance);
            let answer = run.submit(step, r);
            last_denied_as_named = false;
            match (expect, answer) {
                ("allow", Ok(())) => {}
                ("allow", Err(closed)) => failures.push(format!(
                    "{id} step {si} repeat {r}: expected allow, closed {closed:?}"
                )),
                ("deny", Ok(())) => failures.push(format!(
                    "{id} step {si} repeat {r}: expected deny by {wall}, allowed"
                )),
                ("deny", Err(closed)) => {
                    if wall.is_empty() || closed.iter().any(|w| w == wall) {
                        last_denied_as_named = true;
                    } else {
                        failures.push(format!(
                            "{id} step {si} repeat {r}: expected deny by {wall}, closed {closed:?}"
                        ));
                    }
                }
                (other, _) => failures.push(format!("{id} step {si}: unknown expect {other}")),
            }
        }
    }
    (failures, last_denied_as_named)
}

#[test]
fn cc35_every_multi_step_attack_is_denied() {
    let corpus = corpus();
    assert_eq!(s(&corpus, "format"), "aep-redteam-multistep");
    assert_eq!(n(&corpus, "format_version", 0), 1);
    assert_eq!(s(&corpus, "check"), "CC-35");
    let lattice = corpus.get("lattice").cloned().unwrap_or(Value::Null);
    let clock = corpus.get("clock").cloned().unwrap_or(Value::Null);
    let start_ms = i64::try_from(n(&clock, "start_ms", 1_000_000)).unwrap_or(1_000_000);
    let step_ms = n(&clock, "step_ms", 250);
    let cases = corpus
        .get("cases")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(
        cases.len() >= MIN_CASES,
        "the corpus holds {} cases and needs at least {MIN_CASES}",
        cases.len()
    );
    let mut ids = std::collections::BTreeSet::new();
    let mut failures = Vec::new();
    let mut denied = 0usize;
    for c in &cases {
        let id = s(c, "id");
        if !ids.insert(id.to_string()) {
            failures.push(format!("{id}: repeated case id"));
        }
        let steps = c
            .get("steps")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default();
        let total: u64 = steps.iter().map(|st| n(st, "repeat", 1)).sum();
        if total < 2 {
            failures.push(format!(
                "{id}: a multi-step case needs at least two actions"
            ));
        }
        if steps.last().map(|st| s(st, "expect")) != Some("deny")
            || steps
                .last()
                .map(|st| s(st, "wall"))
                .unwrap_or("")
                .is_empty()
        {
            failures.push(format!(
                "{id}: the last step must be the denied forbidden outcome with a named wall"
            ));
        }
        let (mut f, last_denied) = run_chain(c, &lattice, start_ms, step_ms);
        if last_denied {
            denied += 1;
        } else if f.is_empty() {
            f.push(format!("{id}: the forbidden outcome was not denied"));
        }
        failures.extend(f);
    }
    println!(
        "CC-35 red team: {denied} of {} multi-step cases denied",
        cases.len()
    );
    assert!(
        failures.is_empty(),
        "red team failures:\n{}",
        failures.join("\n")
    );
    assert_eq!(denied, cases.len());
}

#[test]
fn cc35_control_chains_are_allowed() {
    let corpus = corpus();
    let lattice = corpus.get("lattice").cloned().unwrap_or(Value::Null);
    let clock = corpus.get("clock").cloned().unwrap_or(Value::Null);
    let start_ms = i64::try_from(n(&clock, "start_ms", 1_000_000)).unwrap_or(1_000_000);
    let step_ms = n(&clock, "step_ms", 250);
    let controls = corpus
        .get("controls")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(!controls.is_empty(), "the corpus needs control chains");
    let mut failures = Vec::new();
    for c in &controls {
        let id = s(c, "id");
        let steps = c
            .get("steps")
            .and_then(|x| x.as_array())
            .cloned()
            .unwrap_or_default();
        if steps.iter().any(|st| s(st, "expect") != "allow") {
            failures.push(format!("{id}: every control step expects allow"));
        }
        let (f, _) = run_chain(c, &lattice, start_ms, step_ms);
        failures.extend(f);
    }
    assert!(
        failures.is_empty(),
        "control failures:\n{}",
        failures.join("\n")
    );
}
