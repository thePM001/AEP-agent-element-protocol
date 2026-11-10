use super::*;
use std::path::PathBuf;

fn policy_source(window_ms: u64, agent_volume: u64) -> String {
    format!(
        r#"{{
  "address": {{ "domain": "test.budget", "id": "budget.v1" }},
  "pattern": {{
    "guard": "true",
    "constraints": [
      "hard: agent.volume_bytes <= budget.agent.volume_bytes",
      "hard: agent.sensitivity <= budget.agent.sensitivity",
      "hard: agent.novelty <= budget.agent.novelty",
      "hard: wrap.volume_bytes <= budget.wrap.volume_bytes",
      "hard: wrap.sensitivity <= budget.wrap.sensitivity",
      "hard: wrap.novelty <= budget.wrap.novelty"
    ]
  }},
  "action": {{ "type": "template", "content": "budget test" }},
  "metadata": {{ "version": "1.0.0" }},
  "extensions": {{ "aep": {{ "budget": {{
    "window_ms": {window_ms},
    "known_targets_max": 4,
    "agent": {{ "volume_bytes": {agent_volume}, "sensitivity": 10, "novelty": 3 }},
    "wrap": {{ "volume_bytes": 5000, "sensitivity": 30, "novelty": 6 }},
    "sensitivity_paths": [ {{ "prefix": "records", "weight": 4 }}, {{ "prefix": "records:secret", "weight": 9 }} ],
    "sensitivity_classes": {{ "pii": 5, "network": 1 }}
  }} }} }}
}}"#
    )
}

fn policy() -> BudgetPolicy {
    match parse_budget_policy("reference/budget.gap", &policy_source(1000, 1000)) {
        Ok(p) => p,
        Err(e) => panic!("policy parses: {e}"),
    }
}

fn input(agent: &str, wrap: &str, path: &str, target: &str, bytes: u64, now: i64) -> BudgetInput {
    BudgetInput {
        agent_id: agent.to_string(),
        wrap: wrap.to_string(),
        action_path: path.to_string(),
        tool: String::new(),
        target_id: target.to_string(),
        text: String::from("plain text"),
        event_bytes: bytes,
        now_ms: now,
    }
}

fn closed_ids(walls: &[AdmitWall]) -> Vec<String> {
    walls
        .iter()
        .filter(|w| w.closed)
        .map(|w| w.id.clone())
        .collect()
}

fn spend(ledger: &mut BudgetLedger, p: &BudgetPolicy, i: &BudgetInput) -> Vec<String> {
    let charge = measure(p, i);
    let walls = compile_budget_walls(p, ledger, &charge);
    let closed = closed_ids(&walls);
    if closed.is_empty() {
        ledger.commit(&charge);
    }
    closed
}

#[test]
fn reference_budget_policy_parses() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../AEP-Policy-System");
    let loaded = load_budget_policy(&root);
    let p = match loaded {
        Some(Ok(p)) => p,
        Some(Err(e)) => panic!("reference budget.gap does not parse: {e}"),
        None => panic!("reference budget.gap missing"),
    };
    assert_eq!(p.items.len(), 6);
    assert!(p.window_ms > 0);
    assert!(p.agent.volume_bytes < p.wrap.volume_bytes);
    let ids: Vec<String> = p.items.iter().map(|i| i.wall_id()).collect();
    assert!(ids.contains(&String::from("policy:budget:agent_volume_bytes")));
    assert!(ids.contains(&String::from("policy:budget:wrap_novelty")));
}

#[test]
fn volume_slices_close_the_agent_wall_inside_the_window() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    for n in 0..3 {
        let closed = spend(
            &mut ledger,
            &p,
            &input("a", "w", "work:read", "t", 300, 10 + n),
        );
        assert!(closed.is_empty(), "slice {n} passes");
    }
    let closed = spend(&mut ledger, &p, &input("a", "w", "work:read", "t", 300, 20));
    assert_eq!(
        closed,
        vec![String::from("policy:budget:agent_volume_bytes")]
    );
}

#[test]
fn spend_leaves_the_window_after_window_ms() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    for n in 0..3 {
        assert!(spend(&mut ledger, &p, &input("a", "w", "work:read", "t", 300, n)).is_empty());
    }
    let full = spend(
        &mut ledger,
        &p,
        &input("a", "w", "work:read", "t", 300, 999),
    );
    assert_eq!(full, vec![String::from("policy:budget:agent_volume_bytes")]);
    let late = spend(
        &mut ledger,
        &p,
        &input("a", "w", "work:read", "t", 300, 2000),
    );
    assert!(
        late.is_empty(),
        "spend older than the window no longer counts"
    );
    assert_eq!(ledger.spent("agent:a", 2000, 1000).0, 300);
}

#[test]
fn denied_action_spends_nothing() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    let closed = spend(&mut ledger, &p, &input("a", "w", "work:read", "t", 2000, 1));
    assert_eq!(
        closed,
        vec![String::from("policy:budget:agent_volume_bytes")]
    );
    assert_eq!(ledger.scope_count(), 0);
}

#[test]
fn wrap_budget_counts_every_agent_of_the_wrap() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    let agents = ["a1", "a2", "a3", "a4", "a5", "a6"];
    let mut closed_at = None;
    for (i, a) in agents.iter().enumerate() {
        let closed = spend(&mut ledger, &p, &input(a, "w", "work:read", "t", 900, 5));
        if !closed.is_empty() {
            assert_eq!(
                closed,
                vec![String::from("policy:budget:wrap_volume_bytes")]
            );
            closed_at = Some(i);
            break;
        }
    }
    assert_eq!(
        closed_at,
        Some(5),
        "the sixth 900 byte action passes 5000 bytes"
    );
}

#[test]
fn sensitivity_adds_path_weight_and_content_classes() {
    let p = policy();
    assert_eq!(p.sensitivity_of("records:list", "plain"), 4);
    assert_eq!(p.sensitivity_of("records:secret:read", "plain"), 9);
    assert_eq!(
        p.sensitivity_of("work:read", "reach me at someone@example.org"),
        5
    );
    assert_eq!(p.sensitivity_of("records:list", "host 10.20.30.40"), 5);
    assert_eq!(p.sensitivity_of("recordsx", "plain"), 0);
}

#[test]
fn sensitivity_budget_closes_on_weighted_reads() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    assert!(spend(
        &mut ledger,
        &p,
        &input("a", "w", "records:list", "t", 10, 1)
    )
    .is_empty());
    assert!(spend(
        &mut ledger,
        &p,
        &input("a", "w", "records:list", "t", 10, 2)
    )
    .is_empty());
    let closed = spend(
        &mut ledger,
        &p,
        &input("a", "w", "records:list", "t", 10, 3),
    );
    assert_eq!(
        closed,
        vec![String::from("policy:budget:agent_sensitivity")]
    );
    let plain = spend(&mut ledger, &p, &input("a", "w", "work:read", "t", 10, 4));
    assert!(
        plain.is_empty(),
        "an action without sensitivity is not held by the spent sensitivity budget"
    );
}

#[test]
fn novelty_counts_new_targets_only() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    for t in ["t1", "t2", "t3"] {
        assert!(spend(&mut ledger, &p, &input("a", "w", "work:read", t, 10, 1)).is_empty());
    }
    let again = spend(&mut ledger, &p, &input("a", "w", "work:read", "t1", 10, 2));
    assert!(again.is_empty(), "a known target is not new");
    let fresh = spend(&mut ledger, &p, &input("a", "w", "work:read", "t4", 10, 3));
    assert_eq!(fresh, vec![String::from("policy:budget:agent_novelty")]);
}

#[test]
fn unwrapped_actions_share_one_wrap_bucket() {
    let p = policy();
    let a = measure(&p, &input("a", "", "work:read", "t", 1, 1));
    let b = measure(&p, &input("b", "  ", "work:read", "t", 1, 1));
    assert_eq!(a.wrap_key, "wrap:unwrapped");
    assert_eq!(a.wrap_key, b.wrap_key);
}

#[test]
fn known_targets_are_bounded() {
    let p = policy();
    let mut ledger = BudgetLedger::new();
    for (n, t) in ["t1", "t2", "t3"].iter().enumerate() {
        assert!(spend(&mut ledger, &p, &input("a", "w", "x", t, 1, n as i64)).is_empty());
    }
    let late = 5000;
    for (n, t) in ["t4", "t5"].iter().enumerate() {
        assert!(spend(
            &mut ledger,
            &p,
            &input("a", "w", "x", t, 1, late + n as i64)
        )
        .is_empty());
    }
    let first = measure(&p, &input("a", "w", "x", "t1", 1, late + 9));
    assert!(
        ledger.is_novel("agent:a", &first.target),
        "the oldest target was evicted at the cap"
    );
}

#[test]
fn parse_item_reads_scope_and_dimension() {
    let item = match parse_item("hard: wrap.sensitivity <= budget.wrap.sensitivity") {
        Ok(i) => i,
        Err(e) => panic!("{e}"),
    };
    assert_eq!(item.scope, Scope::Wrap);
    assert_eq!(item.dimension, Dimension::Sensitivity);
    assert_eq!(item.wall_id(), "policy:budget:wrap_sensitivity");
    assert!(parse_item("hard: agent.volume_bytes <= budget.wrap.volume_bytes").is_err());
    assert!(parse_item("hard: team.volume_bytes <= budget.team.volume_bytes").is_err());
    assert!(parse_item("hard: agent.speed <= budget.agent.speed").is_err());
    assert!(parse_item("no comparison here").is_err());
}

#[test]
fn bad_parameters_are_refused() {
    let src = policy_source(0, 10);
    assert!(parse_budget_policy("reference/budget.gap", &src).is_err());
    let bad_class = policy_source(10, 10).replace("\"network\": 1", "\"no-such-class\": 1");
    assert!(parse_budget_policy("reference/budget.gap", &bad_class).is_err());
    let no_ext = policy_source(10, 10).replace("\"budget\"", "\"other\"");
    assert!(parse_budget_policy("reference/budget.gap", &no_ext).is_err());
    let repeat = policy_source(10, 10).replace(
        "hard: wrap.novelty <= budget.wrap.novelty",
        "hard: agent.novelty <= budget.agent.novelty",
    );
    assert!(parse_budget_policy("reference/budget.gap", &repeat).is_err());
}

#[test]
fn unreadable_policy_closes_the_parameters_wall() {
    let dir = std::env::temp_dir().join(format!("aep-budget-bad-{}", std::process::id()));
    let reference = dir.join("reference");
    if let Err(e) = fs::create_dir_all(&reference) {
        panic!("temp dir: {e}");
    }
    if let Err(e) = fs::write(reference.join("budget.gap"), "{ not a gap") {
        panic!("write: {e}");
    }
    let (walls, charge) = compile_live_budget(
        Some(&dir),
        &BudgetLedger::new(),
        &input("a", "w", "x", "t", 1, 1),
    );
    let _ = fs::remove_file(reference.join("budget.gap"));
    let _ = fs::remove_dir(&reference);
    let _ = fs::remove_dir(&dir);
    assert_eq!(closed_ids(&walls), vec![String::from(WALL_PARAMETERS)]);
    assert!(charge.is_none());
}

#[test]
fn missing_policy_directory_adds_no_wall() {
    let (walls, charge) =
        compile_live_budget(None, &BudgetLedger::new(), &input("a", "w", "x", "t", 1, 1));
    assert!(walls.is_empty());
    assert!(charge.is_none());
}

#[test]
fn input_reads_event_fields() {
    let event = serde_json::json!({
        "action_path": "records:read",
        "tool": "fetch",
        "target_id": "scene-a",
        "payload": {"row": 1}
    });
    let i = BudgetInput::from_event(&event, "agent-a", "records", "text", 42);
    assert_eq!(i.action_path, "records:read");
    assert_eq!(i.tool, "fetch");
    assert_eq!(i.target_id, "scene-a");
    assert_eq!(i.now_ms, 42);
    assert_eq!(i.event_bytes, event.to_string().len() as u64);
}
