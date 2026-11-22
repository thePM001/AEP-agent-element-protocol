//! The proposal corpus of the conformance suite through the dock, with memory and
//! without it.
//!
//! Every step of the multi-step red team corpus and a set of writing proposals is one
//! sealed frame. Each frame takes the whole path of the Base Node: the dock opens and
//! checks it, the pulse holds it, a beat runs Admit, the record step and Apply and the
//! agent collects the answer.
//!
//! Two things are proven here:
//!
//! - `the_corpus_through_the_dock_gets_the_same_answers_with_and_without_memory`: a
//!   node with memory and a node without it give the same answer to every frame, on a
//!   fresh store and on a store that already holds the corpus.
//! - `admit_latency_memory_on_vs_off`: the bench of the dock path. It times every frame
//!   on a node without memory, on a node with memory and on a node whose store already
//!   holds the corpus, and prints the median and the mean per proposal. With
//!   `AEP_LATENCY_GATE=1` it fails when the median of a node with memory is above the
//!   median of a node without it by more than the resolution of the measure, and when
//!   the mean with memory is not below the mean without it. A plain test
//!   run takes the first proposals of the corpus once and compares the answers.
//!   `AEP_LATENCY_ROUNDS` names the rounds of a full run over the whole corpus, which
//!   is run with `--release` and one test thread.

use super::*;
use crate::docking_fixtures::*;
use crate::lattice_memory::{memory_dir, MemoryCounters, MEMORY_DIR};
use aep_base_node_pulse::PULSE_MS;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::{Duration, Instant};

const PORT: DockingPort = DockingPort::ValidationEngine;
const CONTRACT: &str = "dynaep-action-lattice";
const SESSION: &str = "sess-1";
/// The corpus, seen from the folder of this crate.
const CORPUS_REL: &str = "../../AEP-Components/conformance/redteam/multistep-v1.json";
/// Time between two chains. It is longer than every sliding window of the budget
/// policy, so one chain does not spend the budget of the next.
const CHAIN_GAP_MS: i64 = 180_000;

/// One proposal of the corpus: who sends it, when and what.
struct Proposal {
    agent: String,
    at_ms: i64,
    payload: Vec<u8>,
}

struct Corpus {
    /// The lattice of the corpus as the node reads it.
    lattice: String,
    /// The hub policy that permits every agent of the corpus what its lattice permits.
    hub_gap: String,
    agents: Vec<String>,
    proposals: Vec<Proposal>,
}

fn text_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn number_of(value: &Value, key: &str, default: u64) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(default)
}

/// Plain filler text of an exact byte length.
fn filler(len: usize) -> String {
    let mut out = String::with_capacity(len + 5);
    while out.len() < len {
        out.push_str("data ");
    }
    out.truncate(len);
    out
}

/// Texts with and without writing violations.
fn writing_texts() -> Vec<String> {
    let mut with_em_dash = String::from("the plan");
    with_em_dash.push('\u{2014}');
    with_em_dash.push_str("as agreed");
    let mut with_en_dash = String::from("pages 4");
    with_en_dash.push('\u{2013}');
    with_en_dash.push('9');
    vec![
        String::from("rename the parser module"),
        String::from("update the changelog for the release"),
        String::from("read the build log"),
        String::from("red, white, and blue"),
        String::from("first -- second"),
        with_em_dash,
        with_en_dash,
        String::from("How are you?I am here."),
    ]
}

/// Builds the proposals of the corpus on one clock with one sequence per agent.
struct Builder {
    now_ms: i64,
    seq: BTreeMap<String, i64>,
    proposals: Vec<Proposal>,
}

impl Builder {
    fn push(&mut self, agent: &str, advance_ms: i64, mut event: Value) {
        // A frame is held for one pulse, so the clock of the next frame starts after it.
        self.now_ms += PULSE_MS + advance_ms;
        let seq = self.seq.entry(agent.to_string()).or_insert(0);
        *seq += 1;
        event["timestamp"] = json!(self.now_ms);
        event["_sequenceNumber"] = json!(*seq);
        self.proposals.push(Proposal {
            agent: agent.to_string(),
            at_ms: self.now_ms,
            payload: event.to_string().into_bytes(),
        });
    }
}

/// The corpus as `passes` runs of every chain one after the other, followed by the
/// writing proposals of each pass.
fn corpus(passes: usize) -> Corpus {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(CORPUS_REL);
    let raw = std::fs::read_to_string(&path).expect("the red team corpus is in the tree");
    let corpus: Value = serde_json::from_str(&raw).expect("the corpus is JSON");
    let lattice = corpus.get("lattice").cloned().unwrap_or(Value::Null);
    let clock = corpus.get("clock").cloned().unwrap_or(Value::Null);
    let step_ms = number_of(&clock, "step_ms", 250);
    let mut chains: Vec<Value> = Vec::new();
    for group in ["cases", "controls"] {
        chains.extend(
            corpus
                .get(group)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        );
    }
    assert!(
        chains.len() >= 50,
        "the corpus holds {} chains",
        chains.len()
    );

    let mut agents: BTreeSet<String> = BTreeSet::new();
    let mut builder = Builder {
        now_ms: number_of(&clock, "start_ms", 1_000_000) as i64,
        seq: BTreeMap::new(),
        proposals: Vec::new(),
    };
    for _ in 0..passes {
        for chain in &chains {
            builder.now_ms += CHAIN_GAP_MS;
            let steps = chain
                .get("steps")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            for step in &steps {
                let agent = text_of(step, "agent").to_string();
                agents.insert(agent.clone());
                let advance = number_of(step, "advance_ms", step_ms) as i64;
                for index in 0..number_of(step, "repeat", 1) {
                    let target = text_of(step, "target").replace("{n}", &index.to_string());
                    let tool = text_of(step, "tool").replace("{n}", &index.to_string());
                    let mut event = json!({
                        "type": "CUSTOM",
                        "action_path": text_of(step, "path"),
                        "agent_id": agent,
                        "target_id": if target.is_empty() { "scene-rt" } else { target.as_str() },
                        "payload": {
                            "body": filler(number_of(step, "fill", 0) as usize),
                            "note": text_of(step, "text"),
                        },
                    });
                    if !tool.is_empty() {
                        event["tool"] = Value::from(tool);
                    }
                    builder.push(&agent, advance, event);
                }
            }
        }
        // The note of these proposals is outside the payload. The entry check of the
        // dock reads the payload alone, so the writing walls of Admit judge the note.
        builder.now_ms += CHAIN_GAP_MS;
        for round in 0..3 {
            for (index, text) in writing_texts().iter().enumerate() {
                let agent = if (round + index) % 2 == 0 {
                    "writer"
                } else {
                    "writer-2"
                };
                agents.insert(agent.to_string());
                let event = json!({
                    "type": "PING",
                    "action_path": "root:ping",
                    "target_id": "scene-a",
                    "note": text,
                    "payload": {"ok": true},
                });
                builder.push(agent, 250, event);
            }
        }
    }

    // The hub permits each agent the actions the lattice permits it.
    let mut hub_gap = String::from("metadata:\n  wrap: caw\n  agent_permission:\n");
    let actions = lattice
        .get("actions")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (action, node) in &actions {
        let named: Vec<String> = node
            .get("agent_permission")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();
        let permitted: Vec<String> = if named.iter().any(|name| name == "*") {
            agents.iter().cloned().collect()
        } else {
            named
        };
        for agent in permitted {
            hub_gap.push_str(&format!(
                "    - agent_id: {agent}\n      action: {action}\n"
            ));
        }
    }
    Corpus {
        lattice: lattice.to_string(),
        hub_gap,
        agents: agents.into_iter().collect(),
        proposals: builder.proposals,
    }
}

fn copy_folder(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).expect("folder");
    for entry in std::fs::read_dir(from).expect("read folder") {
        let entry = entry.expect("entry");
        if entry.file_type().expect("type").is_file() {
            std::fs::copy(entry.path(), to.join(entry.file_name())).expect("copy");
        }
    }
}

/// A node on the lattice of the corpus. `with_memory` false gives a node that judges
/// without memory. `store` is a memory folder the node starts with.
fn corpus_runtime(
    corpus: &Corpus,
    with_memory: bool,
    store: Option<&Path>,
) -> (tempfile::TempDir, DockingRuntime) {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("lattice.yaml"), &corpus.lattice).expect("lattice");
    let hub = dir.path().join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&hub).expect("hub folder");
    std::fs::write(hub.join("caw-corpus.gap"), &corpus.hub_gap).expect("hub policy");
    if let Some(store) = store {
        copy_folder(store, &memory_dir(dir.path()));
    }
    let (dir, mut rt) = runtime_in(dir);
    if !with_memory {
        if let Some(memory) = rt.record.memory.take() {
            memory.stop();
        }
        rt.record.memory_status = "off";
    }
    for agent in &corpus.agents {
        install_agent_manifest(&rt, agent, SESSION);
    }
    // The frame limits of the dock count frames per minute of the clock of the host.
    // The corpus runs on a clock of its own and far faster, so these limits are set
    // out of reach. The walls of Admit that judge rates stand as they are.
    for limiter in [&rt.defence.rate_limiter, &rt.defence.global_rate_limiter] {
        *limiter.lock().expect("limiter") =
            aep_lattice_channel::RateLimiter::new(u32::MAX, Duration::from_secs(60));
    }
    (dir, rt)
}

/// What a node answered to one proposal and how long the dock path took.
#[derive(Debug, Clone, PartialEq)]
struct Answer {
    ok: bool,
    has_event: bool,
    error: Option<String>,
    deny: Option<DenyReport>,
}

/// Send the proposals `range` of the corpus through the dock and the pulse. The time
/// of a proposal covers the arrival of its frame, the beat that judges it and the
/// collect of its answer. Sealing the frame is the work of the agent and is not timed.
fn run(
    rt: &DockingRuntime,
    corpus: &Corpus,
    range: std::ops::Range<usize>,
) -> Vec<(Answer, Duration)> {
    let mut out = Vec::with_capacity(range.len());
    for proposal in &corpus.proposals[range] {
        let (_frame, line) = build_test_frame(
            rt,
            "ch-corpus",
            &proposal.agent,
            SESSION,
            PORT,
            CONTRACT,
            &proposal.payload,
            1,
        );
        // More than one second lies between two proposals. The node clears its count
        // of events per second on every beat of its pulse, so it is cleared here.
        super::pulse::pulse_decay_rate(rt);
        set_pulse_clock(rt, proposal.at_ms);
        let start = Instant::now();
        let mut answer = process_request(rt, &PORT, &line);
        let mut spent = start.elapsed();
        if answer.pending == Some(true) {
            let collect = format!(
                "{{\"collect\":\"{}\"}}",
                answer.digest.clone().unwrap_or_default()
            );
            set_pulse_clock(rt, proposal.at_ms + PULSE_MS);
            let start = Instant::now();
            let _ = pulse_beat(rt);
            answer = process_request(rt, &PORT, &collect);
            spent += start.elapsed();
        }
        out.push((
            Answer {
                ok: answer.ok,
                has_event: answer.event_id.is_some(),
                error: answer.error,
                deny: answer.deny,
            },
            spent,
        ));
    }
    out
}

fn counters_of(rt: &DockingRuntime) -> MemoryCounters {
    let memory = rt.record.memory.as_deref().expect("memory");
    assert!(memory.wait_idle(Duration::from_secs(120)));
    memory.counters()
}

#[test]
fn the_corpus_through_the_dock_gets_the_same_answers_with_and_without_memory() {
    let corpus = corpus(2);
    let half = corpus.proposals.len() / 2;
    let (_off_dir, off) = corpus_runtime(&corpus, false, None);
    let (on_dir, on) = corpus_runtime(&corpus, true, None);
    assert!(on_dir.path().join(MEMORY_DIR).is_dir());

    // The first pass is the whole corpus on fresh nodes. The second pass sends the
    // start of the corpus once more: the memo and the store hold all of it by then.
    let again = half..half + SECOND_PASS.min(half);
    let mut before = MemoryCounters::default();
    for (pass, range) in [(1, 0..half), (2, again)] {
        let without = run(&off, &corpus, range.clone());
        let with = run(&on, &corpus, range.clone());
        let mut allowed = 0u64;
        let mut denied = 0u64;
        let mut judged = 0u64;
        let mut closed: BTreeMap<String, u64> = BTreeMap::new();
        for (index, ((a, _), (b, _))) in without.iter().zip(with.iter()).enumerate() {
            assert_eq!(a, b, "pass {pass} proposal {}", range.start + index);
            if let Some(first) = a.deny.as_ref().and_then(|deny| deny.closed.first()) {
                *closed.entry(first.id.clone()).or_insert(0) += 1;
            }
            if a.ok {
                assert!(a.has_event);
                allowed += 1;
            } else {
                denied += 1;
            }
            // A frame the dock or the pulse refuses before Admit is no verdict.
            let before_admit = a.deny.as_ref().is_some_and(|deny| {
                deny.closed.first().is_some_and(|wall| {
                    wall.id.starts_with("pulse.") || wall.id.starts_with("dock.")
                })
            });
            if a.ok || (a.deny.is_some() && !before_admit) {
                judged += 1;
            }
        }
        // The corpus holds both verdicts, so the comparison covered both.
        assert!(allowed > 100, "pass {pass}: {allowed} allowed");
        assert!(denied > 0, "pass {pass}: {denied} denied");
        if pass == 1 {
            assert!(denied > 20, "pass {pass}: {denied} denied");
        }
        let counters = counters_of(&on);
        println!("corpus through the dock, pass {pass}: {allowed} allowed, {denied} denied, {judged} judged, {counters:?}");
        println!("first closed wall of each deny: {closed:?}");
        // The memory took every verdict of this pass and lost none.
        assert_eq!(counters.enqueued - before.enqueued, judged, "pass {pass}");
        assert_eq!(counters.recorded - before.recorded, judged, "pass {pass}");
        assert_eq!(counters.dropped, 0);
        assert_eq!(counters.failed, 0);
        assert_eq!(
            counters.hot + counters.cold - before.hot - before.cold,
            judged,
            "pass {pass}"
        );
        if pass == 2 {
            // Every text of the second pass was judged in the first one, so every
            // judged proposal took its writing rows from the memo, and the writer
            // knew every accepted shape.
            assert_eq!(
                counters.memo_replayed - before.memo_replayed,
                judged,
                "pass {pass}"
            );
            assert_eq!(counters.memo_stored, before.memo_stored, "pass {pass}");
            assert!(counters.hot - before.hot >= allowed, "pass {pass}");
        }
        before = counters;
    }
    // The health answer of the node with memory carries the counters of both passes.
    let report = crate::lattice_memory::MemoryReport::of_runtime(&on.record);
    assert_eq!(report.status, "ok");
    assert_eq!(report.records, before.recorded);
    assert_eq!(report.memo_replayed, before.memo_replayed);
    assert_eq!((report.hot, report.cold), (before.hot, before.cold));
    assert_eq!(
        (report.dropped, report.failed, report.queue_depth),
        (0, 0, 0)
    );
    // Every verdict has its row in the Evidence Ledger and its record in the memory.
    assert_eq!(report.ledger_gap, Some(0));
    // The node without memory wrote no record.
    assert!(off.record.memory.is_none());
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

/// Proposals of the second pass of the identity test.
const SECOND_PASS: usize = 400;

/// The share of the median that this measure cannot tell apart on a shared host.
const RESOLUTION: f64 = 0.05;

/// Proposals of the short form of the bench.
const SHORT_FORM: usize = 300;

/// The modes of the bench in the order they are printed.
const MODES: [&str; 3] = ["memory off", "memory on", "memory on a warm store"];

#[test]
fn admit_latency_memory_on_vs_off() {
    let asked: Option<usize> = std::env::var("AEP_LATENCY_ROUNDS")
        .ok()
        .and_then(|text| text.parse().ok());
    let rounds = asked.unwrap_or(1).max(1);
    let gate = std::env::var("AEP_LATENCY_GATE").is_ok_and(|value| value == "1");
    let corpus = corpus(1);
    // A plain test run takes a short form: the first proposals of the corpus.
    let count = match asked {
        Some(_) => corpus.proposals.len(),
        None => corpus.proposals.len().min(SHORT_FORM),
    };

    // The warm store: a node with memory judged the whole corpus once before.
    let seed_dir = {
        let (dir, rt) = corpus_runtime(&corpus, true, None);
        run(&rt, &corpus, 0..count);
        let memory = rt.record.memory.clone().expect("memory");
        memory.stop();
        drop(rt);
        dir
    };
    let seed_store = memory_dir(seed_dir.path());

    // Microseconds of every proposal in every round, per mode.
    let mut spent: [Vec<Vec<f64>>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    let mut answers: Option<Vec<Answer>> = None;
    // Proposals of one round whose writing rows came from the memo, per mode.
    let mut replayed = [0u64; 3];
    for _ in 0..rounds {
        for (mode, times) in spent.iter_mut().enumerate() {
            let (_dir, rt) = match mode {
                0 => corpus_runtime(&corpus, false, None),
                1 => corpus_runtime(&corpus, true, None),
                _ => corpus_runtime(&corpus, true, Some(&seed_store)),
            };
            let ran = run(&rt, &corpus, 0..count);
            times.push(
                ran.iter()
                    .map(|(_, spent)| spent.as_secs_f64() * 1e6)
                    .collect(),
            );
            // Every mode of every round answers every proposal the same.
            let these: Vec<Answer> = ran.into_iter().map(|(answer, _)| answer).collect();
            match &answers {
                None => answers = Some(these),
                Some(first) => {
                    for (index, (a, b)) in first.iter().zip(these.iter()).enumerate() {
                        assert_eq!(a, b, "{} proposal {index}", MODES[mode]);
                    }
                }
            }
            if let Some(memory) = rt.record.memory.as_deref() {
                assert!(memory.wait_idle(Duration::from_secs(120)));
                let counters = memory.counters();
                assert_eq!(counters.dropped + counters.failed, 0, "{counters:?}");
                replayed[mode] = counters.memo_replayed;
            }
        }
    }

    // Per mode: the median and the mean over the proposals of the quietest round of
    // each proposal, and the median of each round.
    let mut quiet = [0f64; 3];
    let mut quiet_mean = [0f64; 3];
    let mut round_medians: [Vec<f64>; 3] = [Vec::new(), Vec::new(), Vec::new()];
    for mode in 0..3 {
        let mut best: Vec<f64> = (0..count)
            .map(|index| {
                spent[mode]
                    .iter()
                    .map(|round| round[index])
                    .fold(f64::INFINITY, f64::min)
            })
            .collect();
        quiet_mean[mode] = best.iter().sum::<f64>() / count as f64;
        quiet[mode] = median(&mut best);
        for round in &spent[mode] {
            let mut copy = round.clone();
            round_medians[mode].push(median(&mut copy));
        }
    }
    println!("admit_latency_memory_on_vs_off: {count} proposals, {rounds} rounds, microseconds per proposal");
    println!(
        "mode                      median of quietest   mean of quietest   median of each round"
    );
    for mode in 0..3 {
        let each: Vec<String> = round_medians[mode]
            .iter()
            .map(|value| format!("{value:.1}"))
            .collect();
        println!(
            "{:<25} {:>18.1} {:>18.1}   {}",
            MODES[mode],
            quiet[mode],
            quiet_mean[mode],
            each.join(" ")
        );
    }
    println!(
        "median, memory on against off: {:+.1} us, warm store against off: {:+.1} us",
        quiet[1] - quiet[0],
        quiet[2] - quiet[0]
    );
    println!(
        "mean, memory on against off: {:+.1} us, warm store against off: {:+.1} us",
        quiet_mean[1] - quiet_mean[0],
        quiet_mean[2] - quiet_mean[0]
    );
    println!(
        "writing rows taken from the memo in one round: {} of {count} with memory on, {} on a warm store",
        replayed[1], replayed[2]
    );
    if gate {
        // Never slower: the median of a node with memory lies within the resolution
        // of this measure of the median of a node without it. On a shared host two
        // runs of one mode differ by a few percent, so that is the resolution.
        for mode in [1, 2] {
            assert!(
                quiet[mode] <= quiet[0] * (1.0 + RESOLUTION),
                "{} costs {:.1} us per proposal in the median, memory off {:.1} us",
                MODES[mode],
                quiet[mode],
                quiet[0]
            );
        }
        // A gain: the texts the memo answered were not judged a second time, so the
        // mean over all proposals is lower with memory than without it.
        for mode in [1, 2] {
            assert!(
                quiet_mean[mode] < quiet_mean[0],
                "{} shows no gain: {:.1} us per proposal in the mean, memory off {:.1} us",
                MODES[mode],
                quiet_mean[mode],
                quiet_mean[0]
            );
        }
    }
}
