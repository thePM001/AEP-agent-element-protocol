//! Memory never changes a verdict.
//!
//! Every chain of the multi-step red team corpus and every one of its control chains
//! is judged three times through the Admit entry of the Base Node: once without
//! memory and twice with one memory that lives across all chains. In the second run
//! with memory every text was judged before, so the rows of the pure writing family
//! are replayed from the memo. Every step must answer with the same verdict and the
//! same deny report in all three runs, and the counters of the memory are checked
//! after each run.
//!
//! A second test does the same with generated proposals: texts with and without
//! writing violations, known and unknown action paths and several agents, in an
//! order a fixed generator picks.
//!
//! The same corpus through the whole dock, sealed frames through the pulse on a node
//! with memory and on a node without it, is the test
//! `the_corpus_through_the_dock_gets_the_same_answers_with_and_without_memory` of the
//! Base Node crate, which holds the clock of the pulse.
use aep_admit_live_dock::{LiveDockContext, MemoryView, PureWallMemo};
use aep_base_node::envelope_admit::{
    admit_sealed_payload_report, admit_sealed_payload_report_in_view,
};
use aep_base_node::lattice_memory::{MemoryCounters, VerdictMemory, VerdictNote};
use aep_base_node::{AdmitWall, DenyReport};
use aep_live_entry::LiveEntry;
use serde_json::{json, Value};
use std::time::Duration;

mod redteam_support;
use redteam_support::{clock_of, corpus, n, steps_of, Run};

type Verdict = Result<(), DenyReport>;

/// Judge one opened event with memory: Admit reads the memo, and the verdict is handed
/// to the memory after it.
fn judge_with_memory(
    memory: &VerdictMemory,
    live: &mut LiveEntry,
    bytes: &[u8],
    dock: &LiveDockContext,
    entry_id: &str,
) -> Verdict {
    let (verdict, trace) = {
        let view = memory.view();
        admit_sealed_payload_report_in_view(live, bytes, dock, &mut || Ok(()), &view)
    };
    let closed: Vec<String> = match &verdict {
        Ok(()) => Vec::new(),
        Err(report) => report.closed.iter().map(|w| w.id.clone()).collect(),
    };
    memory.note_verdict(
        &VerdictNote {
            entry_id,
            agent_id: &dock.agent_id,
            docking_port: &dock.docking_port,
            contract_id: &dock.contract_id,
            plaintext: bytes,
            accepted: verdict.is_ok(),
            at_unix: 1_795_000_000,
            closed: &closed,
        },
        trace,
    );
    // The writer takes the note before the next step, so the counters of the memory
    // are the same on every run of this test.
    assert!(memory.wait_idle(Duration::from_secs(30)));
    verdict
}

/// Judge every step of one chain. `memory` is None for the run without memory.
fn judge_chain(
    chain: &Value,
    lattice: &Value,
    start_ms: i64,
    step_ms: u64,
    memory: Option<(&VerdictMemory, &str)>,
) -> Vec<Verdict> {
    let mut run = Run::new(lattice, start_ms);
    let mut verdicts = Vec::new();
    for (si, step) in steps_of(chain).iter().enumerate() {
        let repeat = n(step, "repeat", 1);
        let advance = i64::try_from(n(step, "advance_ms", step_ms)).unwrap_or(0);
        for r in 0..repeat {
            run.advance(advance);
            let (bytes, dock) = run.event(step, r);
            let verdict = match memory {
                None => admit_sealed_payload_report(&mut run.live, &bytes, &dock),
                Some((memory, tag)) => {
                    let entry_id = format!("{tag}-{si}-{r}");
                    judge_with_memory(memory, &mut run.live, &bytes, &dock, &entry_id)
                }
            };
            verdicts.push(verdict);
        }
    }
    verdicts
}

fn memory() -> std::sync::Arc<VerdictMemory> {
    match VerdictMemory::in_memory() {
        Ok(memory) => memory,
        Err(e) => panic!("memory does not start: {e}"),
    }
}

/// What the counters of a memory moved by since `before`.
fn moved(memory: &VerdictMemory, before: &MemoryCounters) -> MemoryCounters {
    let now = memory.counters();
    MemoryCounters {
        enqueued: now.enqueued - before.enqueued,
        recorded: now.recorded - before.recorded,
        dropped: now.dropped - before.dropped,
        failed: now.failed - before.failed,
        hot: now.hot - before.hot,
        cold: now.cold - before.cold,
        memo_replayed: now.memo_replayed - before.memo_replayed,
        memo_stored: now.memo_stored - before.memo_stored,
        records_at_start: now.records_at_start,
    }
}

#[test]
fn verdict_identical_with_and_without_memory() {
    let corpus = corpus();
    let lattice = corpus.get("lattice").cloned().unwrap_or(Value::Null);
    let (start_ms, step_ms) = clock_of(&corpus);
    let mut chains: Vec<Value> = Vec::new();
    for group in ["cases", "controls"] {
        chains.extend(
            corpus
                .get(group)
                .and_then(|x| x.as_array())
                .cloned()
                .unwrap_or_default(),
        );
    }
    assert!(
        chains.len() >= 50,
        "the corpus holds {} chains",
        chains.len()
    );
    let memory = memory();
    let mut steps = 0u64;
    let mut allowed = 0u64;
    let mut denied = 0u64;
    for (index, chain) in chains.iter().enumerate() {
        let id = redteam_support::s(chain, "id");
        let cold = judge_chain(chain, &lattice, start_ms, step_ms, None);
        let before = memory.counters();
        let first = judge_chain(
            chain,
            &lattice,
            start_ms,
            step_ms,
            Some((&memory, &format!("a{index}"))),
        );
        let first_run = moved(&memory, &before);
        let before = memory.counters();
        let second = judge_chain(
            chain,
            &lattice,
            start_ms,
            step_ms,
            Some((&memory, &format!("b{index}"))),
        );
        let second_run = moved(&memory, &before);
        assert!(!cold.is_empty(), "{id}: no steps");
        // The counters of each run with memory: every verdict was taken and written,
        // none was dropped and none failed.
        let chain_steps = cold.len() as u64;
        let chain_allowed = cold.iter().filter(|verdict| verdict.is_ok()).count() as u64;
        for (run, counters) in [("first", &first_run), ("second", &second_run)] {
            assert_eq!(counters.enqueued, chain_steps, "{id} {run} run");
            assert_eq!(counters.recorded, chain_steps, "{id} {run} run");
            assert_eq!(counters.dropped + counters.failed, 0, "{id} {run} run");
            assert_eq!(counters.hot + counters.cold, chain_steps, "{id} {run} run");
        }
        // Each text of the first run was computed once or replayed, and the second
        // run found every text in the memo and computed none.
        assert_eq!(
            first_run.memo_replayed + first_run.memo_stored,
            chain_steps,
            "{id} first run"
        );
        assert_eq!(second_run.memo_replayed, chain_steps, "{id} second run");
        assert_eq!(second_run.memo_stored, 0, "{id} second run");
        // The writer knew every shape the first run saw accepted.
        assert!(
            second_run.hot >= chain_allowed,
            "{id} second run: {second_run:?}"
        );
        for (step, verdict) in cold.iter().enumerate() {
            assert_eq!(
                verdict, &first[step],
                "{id} step {step}: first run with memory"
            );
            assert_eq!(
                verdict, &second[step],
                "{id} step {step}: second run with memory"
            );
            if verdict.is_ok() {
                allowed += 1;
            } else {
                denied += 1;
            }
        }
        assert_eq!(cold.len(), first.len(), "{id}");
        assert_eq!(cold.len(), second.len(), "{id}");
        steps += cold.len() as u64;
    }
    let counters = memory.counters();
    println!(
        "memory identity: {} chains, {steps} steps, {allowed} allowed, {denied} denied, {counters:?}",
        chains.len()
    );
    // The corpus holds both verdicts, so the comparison covered both.
    assert!(allowed > 0 && denied > 0);
    // The memory took every verdict of both runs with memory and lost none.
    assert_eq!(counters.enqueued, 2 * steps);
    assert_eq!(counters.recorded, 2 * steps);
    assert_eq!(counters.dropped, 0);
    assert_eq!(counters.failed, 0);
    assert_eq!(memory.records(), 2 * steps);
    // The memo was used and the writer counted every record as hot or cold.
    assert!(counters.memo_replayed >= steps, "{counters:?}");
    assert!(counters.memo_stored > 0, "no memo entry");
    assert!(counters.hot >= allowed, "{counters:?}");
    assert_eq!(counters.hot + counters.cold, 2 * steps);
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let mut x = self.0;
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
        x ^= x >> 33;
        x
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[(self.next() % items.len() as u64) as usize]
    }
}

fn generated_lattice() -> &'static str {
    "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_permission: [\"agent-a\", \"agent-b\"]\n  action:read:\n    category: agent_action\n    parents: []\n    children: []\n    agent_permission: [\"agent-a\"]\n"
}

/// Texts with and without writing violations. Few texts, so they repeat often.
fn texts() -> Vec<String> {
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
        String::new(),
        String::from("How are you?I am here."),
    ]
}

#[test]
fn generated_proposals_get_the_same_verdict_with_and_without_memory() {
    let paths = ["root:ping", "action:write", "action:read", "bogus:path", ""];
    let agents = ["agent-a", "agent-b", "agent-c"];
    let texts = texts();
    let lattice = generated_lattice();
    let mut cold = LiveEntry::from_yaml(lattice).expect("lattice");
    let mut warm = LiveEntry::from_yaml(lattice).expect("lattice");
    let memory = VerdictMemory::in_memory().expect("memory");
    let mut rng = Lcg(2026);
    let mut now_ms = 1_000_000i64;
    let mut seq = [0i64; 3];
    let mut allowed = 0;
    let mut denied = 0;
    for step in 0..1500u64 {
        now_ms += (rng.next() % 900) as i64;
        if now_ms / 1000 != (now_ms - 900) / 1000 {
            cold.snapshot.event_rate = 0;
            warm.snapshot.event_rate = 0;
        }
        cold.set_clock_ms(now_ms);
        warm.set_clock_ms(now_ms);
        let agent_index = (rng.next() % 3) as usize;
        let agent = agents[agent_index];
        // Most stamps follow the clock and the sequence. Some do not, so the walls of
        // time and order close as well.
        let stamp = match rng.next() % 12 {
            0 => now_ms - 90_000,
            1 => now_ms + 90_000,
            _ => now_ms,
        };
        if !rng.next().is_multiple_of(9) {
            seq[agent_index] += 1;
        }
        let mut event = json!({
            "type": "CUSTOM",
            "action_path": *rng.pick(&paths),
            "timestamp": stamp,
            "target_id": "scene-a",
            "_sequenceNumber": seq[agent_index],
            "payload": {"note": rng.pick(&texts), "n": rng.next() % 4},
        });
        match rng.next() % 6 {
            0 => event["agent_id"] = json!("someone-else"),
            1 => event["agent_id"] = json!(agent),
            _ => {}
        }
        let mut dock = LiveDockContext::unit_open();
        dock.agent_id = String::from(agent);
        let bytes = event.to_string().into_bytes();
        let without = admit_sealed_payload_report(&mut cold, &bytes, &dock);
        let with = judge_with_memory(&memory, &mut warm, &bytes, &dock, &format!("g{step}"));
        assert_eq!(without, with, "step {step}: {event}");
        if without.is_ok() {
            allowed += 1;
        } else {
            denied += 1;
        }
    }
    let counters = memory.counters();
    println!("generated identity: {allowed} allowed, {denied} denied, {counters:?}");
    assert!(allowed > 50, "only {allowed} proposals were allowed");
    assert!(denied > 50, "only {denied} proposals were denied");
    assert!(counters.hot > 0 && counters.memo_replayed > 0);
    assert_eq!(counters.recorded, 1500);
    assert_eq!(counters.dropped + counters.failed, 0);
}

/// A memo that answers every lookup with rows that are not a writing block.
struct WrongForm;

impl PureWallMemo for WrongForm {
    fn replay(&self, _family: &str, _input: &str) -> Option<Vec<AdmitWall>> {
        Some(vec![AdmitWall::open("writing:no_em_dashes")])
    }
}

#[test]
fn stored_rows_of_the_wrong_form_never_reach_a_verdict() {
    let texts = texts();
    let lattice = generated_lattice();
    let mut cold = LiveEntry::from_yaml(lattice).expect("lattice");
    let mut warm = LiveEntry::from_yaml(lattice).expect("lattice");
    let view = MemoryView { memo: &WrongForm };
    for (index, text) in texts.iter().enumerate() {
        let now_ms = 1_000_000 + index as i64 * 1500;
        cold.set_clock_ms(now_ms);
        warm.set_clock_ms(now_ms);
        cold.snapshot.event_rate = 0;
        warm.snapshot.event_rate = 0;
        let event = json!({
            "type": "PING",
            "action_path": "root:ping",
            "timestamp": now_ms,
            "target_id": "scene-a",
            "_sequenceNumber": index as i64 + 1,
            "payload": {"note": text},
        });
        let bytes = event.to_string().into_bytes();
        let dock = LiveDockContext::unit_open();
        let without = admit_sealed_payload_report(&mut cold, &bytes, &dock);
        let (with, trace) =
            admit_sealed_payload_report_in_view(&mut warm, &bytes, &dock, &mut || Ok(()), &view);
        assert_eq!(without, with, "text {index}");
        // The rows were computed, not taken from the memo.
        assert_eq!(trace.map(|t| t.replayed), Some(false));
    }
}
