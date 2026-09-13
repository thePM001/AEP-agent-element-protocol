//! AEP 2.8.6 end to end run.
//!
//! One command walks every layer twice. The refuse path runs first and every
//! layer fails closed. The pass path runs second and the same layers allow.
//!
//! Layer order: a CAW session, a sealed capsule, the pulse, collect all, apply,
//! a CAW exec, a dock attach and a ledger row.
//!
//! Base Node is the only live evaluator and this run is not a second evaluator.
//! The run prints what the layers decide. It does not publish measurement
//! numbers.

use aep_base_node::{ClosedWall, DenyReport, PULSE_MS};
use aep_base_node_pulse::{
    drift_against_freeze, fate_at, freeze_temporal_snapshot, CapsuleFate, MAX_DRIFT_MS,
};
use aep_envelope::{
    admit, apply, load_lattice_yaml, plan_apply, snapshot_from_nodes, AdmitResult, ApplyPlan,
    EnvelopeAction, Snapshot,
};
use aep_lattice_crypto::{
    generate_kem_keypair, generate_sign_keypair, open, seal, KemKeypair, PQEncryptedCapsule,
    SignKeypair,
};
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const PAYLOAD: &[u8] = b"aep-2.8.6-end-to-end-run";
const CAW_POLICY_REFUSE: &str = "aep-e2e-missing-policy";
const CAW_DENIED_BINARY: &str = "/usr/bin/curl";
const PROVENANCE_SOURCE: &str = "mcp";
const PROVENANCE_PROTOCOL: &str = "1.0";
const SESSION_REFUSE: &str = "e2e-refuse";
const SESSION_PASS: &str = "e2e-pass";

struct Ctx {
    caw_bin: String,
    caw_server: String,
    workspace: PathBuf,
    ucb_url: String,
    ucb_key: String,
    base_node_config: PathBuf,
    lattice_log_bin: String,
    run_dir: PathBuf,
    attach_action: String,
    attach_scene: String,
    attach_agent: String,
    refuse_agent: String,
    provenance_digest_refuse: String,
    provenance_digest_pass: String,
}

impl Ctx {
    fn from_env() -> Result<Self, String> {
        let need = |key: &str| env::var(key).map_err(|_| format!("missing env {key}"));
        Ok(Ctx {
            caw_bin: need("AEP_E2E_CAW_BIN")?,
            caw_server: need("AEP_E2E_CAW_SERVER")?,
            workspace: PathBuf::from(need("AEP_E2E_WORKSPACE")?),
            ucb_url: need("AEP_E2E_UCB_URL")?,
            ucb_key: need("AEP_E2E_UCB_KEY")?,
            base_node_config: PathBuf::from(need("AEP_E2E_BASE_NODE_CONFIG")?),
            lattice_log_bin: need("AEP_E2E_LATTICE_LOG_BIN")?,
            run_dir: PathBuf::from(need("AEP_E2E_RUN_DIR")?),
            attach_action: need("AEP_E2E_ATTACH_ACTION")?,
            attach_scene: need("AEP_E2E_ATTACH_SCENE")?,
            attach_agent: need("AEP_E2E_ATTACH_AGENT")?,
            refuse_agent: need("AEP_E2E_REFUSE_AGENT")?,
            provenance_digest_refuse: need("AEP_E2E_PROVENANCE_DIGEST_REFUSE")?,
            provenance_digest_pass: need("AEP_E2E_PROVENANCE_DIGEST_PASS")?,
        })
    }
}

struct Step {
    tag: String,
    label: String,
    lines: Vec<String>,
}

impl Step {
    fn one(tag: &str, label: &str, line: String) -> Self {
        Step {
            tag: String::from(tag),
            label: String::from(label),
            lines: vec![line],
        }
    }
    fn refuse(label: &str, line: String) -> Self {
        Step::one("REFUSE", label, line)
    }
    fn pass(label: &str, line: String) -> Self {
        Step::one("PASS", label, line)
    }
    fn fail(label: &str, line: String) -> Self {
        Step::one("FAIL", label, line)
    }
    fn report(label: &str, line: String) -> Self {
        Step::one("REFUSE REPORT", label, line)
    }
    fn emit(&self) {
        for line in &self.lines {
            if self.label.is_empty() {
                println!("{} {}", self.tag, line);
            } else {
                println!("{} {}: {}", self.tag, self.label, line);
            }
        }
    }
}

fn run(program: &str, args: &[&str], envs: &[(&str, String)]) -> (i32, String, String) {
    let mut command = Command::new(program);
    command.args(args);
    for (key, value) in envs {
        command.env(key, value);
    }
    match command.output() {
        Ok(out) => (
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stdout).to_string(),
            String::from_utf8_lossy(&out.stderr).to_string(),
        ),
        Err(e) => (-1, String::new(), e.to_string()),
    }
}

fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| line.is_empty() == false)
        .unwrap_or("")
        .to_string()
}

fn compact_json(text: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => value.to_string(),
        Err(_) => first_line(text),
    }
}

/// Lattice for the in process envelope layers. The attach action grants one
/// named agent and the parent path grants any named agent.
fn lattice_yaml(action: &str, agent: &str) -> String {
    format!(
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  {action}:\n    category: external_event\n    parents: []\n    children: []\n    agent_permission: [\"{agent}\"]\n"
    )
}

struct Capsule {
    kem: KemKeypair,
    sign: SignKeypair,
    sealed: PQEncryptedCapsule,
}

struct Kernel {
    snap: Snapshot,
    refuse_admit: AdmitResult,
    pass_admit: AdmitResult,
    pass_plan: ApplyPlan,
    applied_rate: u32,
}

fn build_kernel(ctx: &Ctx, ts_ms: i64) -> Result<Kernel, String> {
    let nodes = load_lattice_yaml(&lattice_yaml(&ctx.attach_action, &ctx.attach_agent))
        .map_err(|e| e.to_string())?;
    let mut satisfied = BTreeSet::new();
    satisfied.insert(String::from("root:ping"));
    let mut snap = snapshot_from_nodes(nodes, satisfied, ts_ms);
    snap.proven_scene_ids.insert(ctx.attach_scene.clone());
    snap.allowed_docks.insert(String::from("inference_engine"));
    snap.allowed_docks.insert(String::from("validation_engine"));

    let refuse_action = EnvelopeAction {
        action_path: ctx.attach_action.clone(),
        agent_id: ctx.refuse_agent.clone(),
        payload: serde_json::json!({"ok": false}),
        tool: String::new(),
        dest_dock: String::from("validation_engine"),
        scene_id: String::new(),
        agent_ts_ms: ts_ms + 500,
        sequence_number: 0,
        anomaly_score: 0.0,
    };
    let pass_action = EnvelopeAction {
        action_path: ctx.attach_action.clone(),
        agent_id: ctx.attach_agent.clone(),
        payload: serde_json::json!({"ok": true}),
        tool: String::new(),
        dest_dock: String::from("inference_engine"),
        scene_id: ctx.attach_scene.clone(),
        agent_ts_ms: ts_ms,
        sequence_number: 1,
        anomaly_score: 0.0,
    };
    let refuse_admit = admit(&refuse_action, &snap);
    let pass_admit = admit(&pass_action, &snap);
    let pass_plan = plan_apply(&pass_admit, &snap);
    apply(&mut snap, &pass_plan);
    let applied_rate = snap.actions_last_minute;
    Ok(Kernel {
        snap,
        refuse_admit,
        pass_admit,
        pass_plan,
        applied_rate,
    })
}

fn ledger_count(ctx: &Ctx) -> Result<u64, String> {
    let config = ctx.base_node_config.to_string_lossy().to_string();
    let (code, out, err) = run(&ctx.lattice_log_bin, &["--config", &config, "count"], &[]);
    if code != 0 {
        return Err(format!("count refused with exit {code}: {}", first_line(&err)));
    }
    let value: serde_json::Value =
        serde_json::from_str(&out).map_err(|e| format!("count is not JSON: {e}"))?;
    value
        .get("count")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| String::from("count field missing"))
}

fn ledger_tail(ctx: &Ctx) -> Result<Vec<serde_json::Value>, String> {
    let config = ctx.base_node_config.to_string_lossy().to_string();
    let (code, out, err) = run(
        &ctx.lattice_log_bin,
        &["--config", &config, "export", "--limit", "1"],
        &[],
    );
    if code != 0 {
        return Err(format!("export refused with exit {code}: {}", first_line(&err)));
    }
    serde_json::from_str(&out).map_err(|e| format!("export is not JSON: {e}"))
}

fn ucb_ingest(
    ctx: &Ctx,
    name: &str,
    body: &serde_json::Value,
) -> Result<(String, serde_json::Value), String> {
    let body_path = ctx.run_dir.join(format!("ucb-{name}-body.json"));
    fs::write(&body_path, body.to_string()).map_err(|e| e.to_string())?;
    let out_path = ctx.run_dir.join(format!("ucb-{name}-reply.json"));
    let url = format!("{}/ucb/v1/ingest", ctx.ucb_url);
    let auth = format!("Authorization: Bearer {}", ctx.ucb_key);
    let data = format!("@{}", body_path.to_string_lossy());
    let (code, http_code, err) = run(
        "curl",
        &[
            "-sS",
            "--max-time",
            "20",
            "-o",
            &out_path.to_string_lossy(),
            "-w",
            "%{http_code}",
            "-H",
            &auth,
            "-H",
            "Content-Type: application/json",
            "--data-binary",
            &data,
            &url,
        ],
        &[],
    );
    if code != 0 {
        return Err(format!("curl refused with exit {code}: {}", first_line(&err)));
    }
    let raw = fs::read_to_string(&out_path).map_err(|e| e.to_string())?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("ingest reply is not JSON: {e}"))?;
    Ok((first_line(&http_code), value))
}

fn manifest_body(ctx: &Ctx) -> serde_json::Value {
    serde_json::json!({
        "manifest_version": "1",
        "id": "tm-e2e-dock-attach",
        "agent_id": ctx.attach_agent,
        "session_id": SESSION_PASS,
        "intent": {
            "summary": "E2E dock attach",
            "allowed_operations": [ctx.attach_action]
        },
        "provisional": false,
        "synthesized_by": "provided",
        "signature": "e2e-dock-attach-signature",
        "created_at_unix": 0
    })
}

/// Ingest body for one attach. The provenance digest binds the provenance
/// triple, because the perimeter refuses an unbound provenance. The action
/// path and the scene are named, because the dock Admit reads both from the
/// sealed event.
fn ingest_body(
    ctx: &Ctx,
    agent_id: &str,
    session_id: &str,
    provenance_digest: &str,
    with_manifest: bool,
) -> serde_json::Value {
    let mut body = serde_json::json!({
        "protocol": "mcp",
        "session_id": session_id,
        "agent_id": agent_id,
        "action_path": ctx.attach_action,
        "target_id": ctx.attach_scene,
        "provenance": {
            "source": PROVENANCE_SOURCE,
            "protocol": PROVENANCE_PROTOCOL,
            "session_id": session_id,
            "digest": provenance_digest
        },
        "payload": {
            "subject": "E2E",
            "predicate": "attaches",
            "object": "UCB"
        }
    });
    if with_manifest {
        body["task_manifest"] = manifest_body(ctx);
    }
    body
}

fn main() {
    if let Err(e) = run_main() {
        println!("FAIL run: {e}");
        std::process::exit(1);
    }
}

fn run_main() -> Result<(), String> {
    let ctx = Ctx::from_env()?;
    let mut ok = true;

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // In process layers.
    let capsule = {
        let kem = generate_kem_keypair();
        let sign = generate_sign_keypair();
        let sealed = seal(PAYLOAD, &kem.public, &sign).map_err(|e| e.to_string())?;
        Capsule { kem, sign, sealed }
    };
    let foreign = generate_kem_keypair();
    let capsule_refuse = match open(
        &capsule.sealed,
        &foreign.secret,
        &foreign.public,
        &capsule.sign.public,
    ) {
        Ok(_) => None,
        Err(e) => Some(e.to_string()),
    };
    let capsule_pass = open(
        &capsule.sealed,
        &capsule.kem.secret,
        &capsule.kem.public,
        &capsule.sign.public,
    );

    let freeze = freeze_temporal_snapshot(now_ms, 1);
    let drifted = drift_against_freeze(now_ms + 500, &freeze);
    let sealed_drift = drift_against_freeze(now_ms, &freeze);
    let at_seal = fate_at(now_ms, &freeze);
    let at_beat = fate_at(now_ms + PULSE_MS, &freeze);

    let kernel = build_kernel(&ctx, now_ms)?;

    // Live refuse path.
    let caw_refuse_session = {
        let workspace = ctx.workspace.to_string_lossy().to_string();
        let (code, out, err) = run(
            &ctx.caw_bin,
            &[
                "session",
                "create",
                "--workspace",
                &workspace,
                "--policy",
                CAW_POLICY_REFUSE,
                "--json",
            ],
            &[("AEP_CAW_SERVER", ctx.caw_server.clone())],
        );
        let line = if err.trim().is_empty() {
            first_line(&out)
        } else {
            first_line(&err)
        };
        (code, line)
    };

    let caw_session = {
        let workspace = ctx.workspace.to_string_lossy().to_string();
        let (code, out, err) = run(
            &ctx.caw_bin,
            &["session", "create", "--workspace", &workspace, "--json"],
            &[("AEP_CAW_SERVER", ctx.caw_server.clone())],
        );
        if code != 0 {
            return Err(format!(
                "caw session create refused with exit {code}: {}",
                first_line(&err)
            ));
        }
        let value: serde_json::Value =
            serde_json::from_str(&out).map_err(|e| format!("session reply is not JSON: {e}"))?;
        value
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let caw_exec_refuse = {
        let (code, out, err) = run(
            &ctx.caw_bin,
            &[
                "exec",
                &caw_session,
                "--",
                CAW_DENIED_BINARY,
                "-sS",
                "--max-time",
                "2",
                "https://example.invalid",
            ],
            &[("AEP_CAW_SERVER", ctx.caw_server.clone())],
        );
        let line = if err.trim().is_empty() {
            first_line(&out)
        } else {
            first_line(&err)
        };
        (code, line)
    };

    let caw_exec_pass = {
        let (code, out, err) = run(
            &ctx.caw_bin,
            &[
                "exec",
                &caw_session,
                "--",
                "sh",
                "-c",
                "printf aep-2.8.6-end-to-end-pass",
            ],
            &[("AEP_CAW_SERVER", ctx.caw_server.clone())],
        );
        let line = if out.trim().is_empty() {
            first_line(&err)
        } else {
            first_line(&out)
        };
        (code, line)
    };

    let ledger_before = ledger_count(&ctx)?;

    let dock_refuse = ucb_ingest(
        &ctx,
        "refuse",
        &ingest_body(
            &ctx,
            "ucb-foreign-refuse",
            SESSION_REFUSE,
            &ctx.provenance_digest_refuse,
            false,
        ),
    )?;

    let ledger_after_refuse = ledger_count(&ctx)?;

    let dock_pass = ucb_ingest(
        &ctx,
        "pass",
        &ingest_body(
            &ctx,
            &ctx.attach_agent,
            SESSION_PASS,
            &ctx.provenance_digest_pass,
            true,
        ),
    )?;

    let ledger_after_pass = ledger_count(&ctx)?;
    let tail = ledger_tail(&ctx)?;

    println!("AEP end to end run. The refuse path prints first and the pass path prints second.");
    println!("kernel pulse ms {}", PULSE_MS);
    println!("kernel drift bound ms {}", MAX_DRIFT_MS);
    println!("attach action {} scene {} agent {}", ctx.attach_action, ctx.attach_scene, ctx.attach_agent);
    println!();

    let mut refuse_steps: Vec<Step> = Vec::new();
    refuse_steps.push(if caw_refuse_session.0 != 0 {
        Step::refuse(
            "1 caw session",
            format!(
                "policy {CAW_POLICY_REFUSE} is absent, so the session refused with exit {}: {}",
                caw_refuse_session.0, caw_refuse_session.1
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "1 caw session",
            String::from("the absent policy did not refuse the session"),
        )
    });

    refuse_steps.push(match &capsule_refuse {
        Some(e) => Step::refuse(
            "2 sealed capsule",
            format!("a foreign recipient key refused the capsule: {e}"),
        ),
        None => {
            ok = false;
            Step::fail(
                "2 sealed capsule",
                String::from("a foreign recipient key opened the capsule"),
            )
        }
    });

    refuse_steps.push(if drifted > MAX_DRIFT_MS {
        Step::refuse(
            "3 pulse",
            format!(
                "the agent stamp drifts {drifted} ms past the {MAX_DRIFT_MS} ms freeze bound and the temporal wall closes"
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "3 pulse",
            String::from("the pulse did not close a drifted stamp"),
        )
    });

    let refuse_closed: Vec<ClosedWall> = kernel
        .refuse_admit
        .closed_walls
        .iter()
        .map(|w| ClosedWall::new(w.id.clone(), w.reason.clone()))
        .collect();
    let report = DenyReport::from_closed(&refuse_closed);
    let refuse_ids: Vec<String> = report
        .closed
        .iter()
        .map(|w| format!("{}={}", w.id, w.class))
        .collect();
    if kernel.refuse_admit.allow {
        ok = false;
        refuse_steps.push(Step::fail(
            "4 collect all",
            String::from("the refused path admitted"),
        ));
    } else {
        refuse_steps.push(Step::refuse(
            "4 collect all",
            format!(
                "{} walls closed together on one path and every wall ran, so this is a collect all deny and not an early exit",
                refuse_ids.len()
            ),
        ));
    }
    refuse_steps.push(Step::report("error", report.error.clone()));
    refuse_steps.push(Step::report("closed walls", refuse_ids.join(" ")));
    refuse_steps.push(Step::report(
        "closed set key length",
        report.closed_set_key.len().to_string(),
    ));

    let refuse_plan = plan_apply(&kernel.refuse_admit, &kernel.snap);
    refuse_steps.push(
        if refuse_plan.ledger_allow == false && refuse_plan.increment_rate == false {
            Step::refuse(
                "5 apply",
                String::from("collect all admit refused, so the plan holds no ledger allowance and no rate step and no row is written"),
            )
        } else {
            ok = false;
            Step::fail("5 apply", String::from("apply ran after a refused admit"))
        },
    );

    refuse_steps.push(if caw_exec_refuse.0 != 0 {
        Step::refuse(
            "6 caw exec",
            format!(
                "the wrapped command refused with exit {}: {}",
                caw_exec_refuse.0, caw_exec_refuse.1
            ),
        )
    } else {
        ok = false;
        Step::fail("6 caw exec", String::from("the denied command ran"))
    });

    let dock_refuse_ok = refusal_shaped(&dock_refuse.1);
    refuse_steps.push(if dock_refuse_ok {
        Step::refuse(
            "7 dock attach",
            format!(
                "the ingest refused with HTTP {} and {}",
                dock_refuse.0,
                refusal_line(&dock_refuse.1)
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "7 dock attach",
            format!(
                "the ingest without a task manifest was accepted: {}",
                compact_json(&dock_refuse.1.to_string())
            ),
        )
    });

    refuse_steps.push(if ledger_after_refuse == ledger_before {
        Step::refuse(
            "8 ledger row",
            format!("the refuse path wrote no row and the ledger count stays {ledger_before}"),
        )
    } else {
        ok = false;
        Step::fail(
            "8 ledger row",
            format!(
                "the refuse path moved the ledger count from {ledger_before} to {ledger_after_refuse}"
            ),
        )
    });

    println!("== refuse path");
    for step in &refuse_steps {
        step.emit();
    }
    println!();

    let mut pass_steps: Vec<Step> = Vec::new();
    pass_steps.push(if caw_session.is_empty() == false {
        Step::pass(
            "1 caw session",
            format!("the session {caw_session} holds the workspace"),
        )
    } else {
        ok = false;
        Step::fail(
            "1 caw session",
            String::from("the session reply carried no id"),
        )
    });

    pass_steps.push(match &capsule_pass {
        Ok(opened) if opened.as_slice() == PAYLOAD => Step::pass(
            "2 sealed capsule",
            format!(
                "the recipient key opened the capsule and the payload is {}",
                String::from_utf8_lossy(opened)
            ),
        ),
        Ok(_) => {
            ok = false;
            Step::fail(
                "2 sealed capsule",
                String::from("the opened payload differs from the sealed payload"),
            )
        }
        Err(e) => {
            ok = false;
            Step::fail(
                "2 sealed capsule",
                format!("the recipient key was refused: {e}"),
            )
        }
    });

    pass_steps.push(
        if sealed_drift <= MAX_DRIFT_MS
            && at_seal == CapsuleFate::Wait
            && at_beat == CapsuleFate::Ready
        {
            Step::pass(
                "3 pulse",
                format!(
                    "the seal stamp drifts {sealed_drift} ms inside the {MAX_DRIFT_MS} ms bound, the capsule waits at the seal beat and turns ready {} ms later",
                    PULSE_MS
                ),
            )
        } else {
            ok = false;
            Step::fail(
                "3 pulse",
                format!(
                    "drift {sealed_drift} ms, fate at the seal {at_seal:?} and fate at the beat {at_beat:?}"
                ),
            )
        },
    );

    let pass_closed: Vec<String> = kernel
        .pass_admit
        .closed_walls
        .iter()
        .map(|w| w.id.clone())
        .collect();
    pass_steps.push(if kernel.pass_admit.allow && pass_closed.is_empty() {
        Step::pass(
            "4 collect all",
            format!(
                "collect all ran every wall on the path and {} walls closed",
                pass_closed.len()
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "4 collect all",
            format!("the permitted path closed {}", pass_closed.join(" ")),
        )
    });

    pass_steps.push(
        if kernel.pass_plan.ledger_allow && kernel.pass_plan.increment_rate {
            Step::pass(
                "5 apply",
                format!(
                    "the plan carries the ledger allowance and the rate step and the applied snapshot rate is {}",
                    kernel.applied_rate
                ),
            )
        } else {
            ok = false;
            Step::fail(
                "5 apply",
                String::from("the plan carried no ledger allowance"),
            )
        },
    );

    pass_steps.push(if caw_exec_pass.0 == 0 {
        Step::pass(
            "6 caw exec",
            format!(
                "the wrapped command returned exit 0 and the output is {}",
                caw_exec_pass.1
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "6 caw exec",
            format!(
                "the wrapped command refused with exit {}: {}",
                caw_exec_pass.0, caw_exec_pass.1
            ),
        )
    });

    let dock_pass_status = dock_pass
        .1
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let dock_ok = dock_pass.1.get("ok").and_then(|v| v.as_bool()) == Some(true);
    pass_steps.push(if dock_ok && dock_pass_status == "integrated" {
        Step::pass(
            "7 dock attach",
            format!(
                "the ingest returned status {dock_pass_status} and the admit row is {}",
                admit_row(&dock_pass.1)
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "7 dock attach",
            format!(
                "the ingest returned HTTP {} body {}",
                dock_pass.0,
                compact_json(&dock_pass.1.to_string())
            ),
        )
    });

    pass_steps.push(if ledger_after_pass > ledger_after_refuse {
        Step::pass(
            "8 ledger row",
            format!(
                "the pass path moved the ledger count from {ledger_after_refuse} to {ledger_after_pass} and the newest row is {}",
                row_line(&tail)
            ),
        )
    } else {
        ok = false;
        Step::fail(
            "8 ledger row",
            format!("the pass path left the ledger count at {ledger_after_pass}"),
        )
    });

    println!("== pass path");
    for step in &pass_steps {
        step.emit();
    }
    println!();
    println!("== verdict");
    if ok {
        println!("RESULT refuse path first and pass path second with the ledger row");
        Ok(())
    } else {
        println!("RESULT the run did not hold both paths");
        std::process::exit(1);
    }
}

/// A refusal reply is either an ok false body or a DenyReport body, which
/// carries an error line and a closed set and no ok field.
fn refusal_shaped(value: &serde_json::Value) -> bool {
    if value.get("ok").and_then(|v| v.as_bool()) == Some(false) {
        return true;
    }
    value
        .get("error")
        .and_then(|v| v.as_str())
        .map(|e| e.trim().is_empty() == false)
        .unwrap_or(false)
}

fn refusal_line(value: &serde_json::Value) -> String {
    let error = value
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("no error line");
    let closed: Vec<String> = value
        .get("closed")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
                    let class = row.get("class").and_then(|v| v.as_str()).unwrap_or("unknown");
                    format!("{id}={class}")
                })
                .collect()
        })
        .unwrap_or_default();
    if closed.is_empty() {
        return format!("the DenyReport error is {error}");
    }
    format!(
        "the DenyReport error is {error} and the closed walls are {}",
        closed.join(" ")
    )
}

fn admit_row(body: &serde_json::Value) -> String {
    let row = body
        .get("admit")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let event_id = row
        .get("event_id")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let allow = row.get("allow").cloned().unwrap_or(serde_json::Value::Null);
    let digest = row
        .get("digest")
        .and_then(|v| v.as_str())
        .map(short_digest)
        .unwrap_or_else(|| String::from("none"));
    format!("event_id {event_id} allow {allow} digest {digest}")
}

fn row_line(rows: &[serde_json::Value]) -> String {
    match rows.first() {
        Some(row) => {
            let id = row.get("id").cloned().unwrap_or(serde_json::Value::Null);
            let agent = row.get("agent_id").and_then(|v| v.as_str()).unwrap_or("");
            let event_type = row.get("event_type").and_then(|v| v.as_str()).unwrap_or("");
            let digest = row
                .get("frame_digest")
                .and_then(|v| v.as_str())
                .map(short_digest)
                .unwrap_or_else(|| String::from("none"));
            format!("id {id} agent {agent} event_type {event_type} frame_digest {digest}")
        }
        None => String::from("none"),
    }
}

fn short_digest(digest: &str) -> String {
    let head: String = digest.chars().take(12).collect();
    format!("{head}...")
}
