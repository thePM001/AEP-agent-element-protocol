//! Provisional staging of the host change of a promoted draft.
//!
//! A promote that changes a host carries a deploy manifest in its scanned tree. The
//! verbs work on the promoted draft and read the manifest and every source from the git
//! tree that the scan judged, never from the working folder:
//!
//! - stage <draft> <manifest>: judge the targets against the stage targets of
//!   operator.conf and the protected places, build in an export of the scanned tree,
//!   save every old target with owner, group and mode in the record root, create the
//!   users the manifest needs, put the new files in place and run the check. A failed
//!   check or a failed step puts everything back at once.
//! - stage-check <draft>: run the check again inside the deadline.
//! - stage-revert <draft>: put every saved target back and remove what the stage added.
//! - stage-confirm <draft>: only the operator (a caller without an agent identity whose
//!   user id operator.conf lists in stage_confirm_uids) makes a checked stage permanent.
//! - The sweep reverts every stage that passes its deadline unconfirmed.
//!
//! An agent stages with the grant ede.stage of its profile. Every action is a sealed
//! stage record and an entry of the chained ledger, and every verb asks the EDE wall of
//! dynAEP (ede.stage, ede.check, ede.confirm, ede.revert).

pub mod core;

use self::core::{
    all_records, apply, clear_copies, holds, host_lock, id_in, judge, parse_manifest, plain,
    read_record, rel_ok, revert, run_timed, write_record, Limits, Manifest, StageRecord, UserTools,
};
use crate::operator::Operator;
use crate::store::{self, Record, State};
use crate::{git, identity, privilege, profile, seal, Ctx, Report};
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::process::Command;

pub const MANIFEST_SCHEMA: &str = "aep.ede.deploy-manifest.v1";
pub const RECORD_SCHEMA: &str = "aep.ede.stage-record.v1";

/// The places a stage may write and never writes: the operator folder, the record and
/// state roots, the lattice of the wall and the binary of aep-ede itself.
pub fn limits(op: &Operator) -> Limits {
    let mut refused = vec![
        op.dir.clone(),
        op.record_root.clone(),
        op.state_root.clone(),
    ];
    if let Some(l) = &op.lattice {
        refused.push(l.clone());
    }
    if let Ok(me) = std::env::current_exe() {
        refused.push(me);
    }
    Limits {
        allowed: op.stage_targets.clone(),
        refused,
        refused_names: Vec::new(),
    }
}

fn tools(op: &Operator) -> UserTools {
    UserTools {
        dir: op.user_tool_dir.clone(),
        passwd: op.passwd_file.clone(),
        group: op.group_file.clone(),
        path: crate::child_path(),
    }
}

/// Who calls a stage verb.
#[derive(PartialEq, Eq)]
enum Who {
    Agent,
    Operator,
}

/// An agent proves itself with its signed frame, owns the draft and holds the grant
/// ede.stage. A caller without an agent identity is the operator when its user id is
/// listed in stage_confirm_uids.
fn who(ctx: &Ctx, r: &Record, verb: &str) -> Result<Who, Report> {
    let named = std::env::var("AEP_AGENT_ID")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    if !named {
        if ctx.op.stage_confirm_uids.contains(&privilege::caller_uid()) {
            return Ok(Who::Operator);
        }
        return Err(Report::deny(
            "identity",
            &r.draft_id,
            "no agent identity and no operator user id",
        ));
    }
    let agent = identity::caller(&ctx.op, verb, &r.draft_id, &r.repo, ctx.now)
        .map_err(|e| Report::deny("identity", &r.draft_id, &e))?;
    if agent != r.agent {
        return Err(Report::deny(
            "draft_foreign_agent",
            &r.draft_id,
            &format!("the draft belongs to the agent {}", r.agent),
        ));
    }
    let prof = profile::load(&ctx.op, &agent)
        .map_err(|e| Report::deny("profile_missing", &r.draft_id, &e))?;
    prof.allow("stage", &r.repo)
        .map_err(|e| Report::deny("profile_refused", &r.draft_id, &e))?;
    Ok(Who::Agent)
}

/// Ask the EDE wall of dynAEP about a stage verb.
fn wall(ctx: &Ctx, verb: &str, state: &str, staged: u64) -> Result<(), String> {
    let mut satisfied: BTreeSet<String> = ["ede.seed", "ede.scan", "ede.verify", "ede.promote"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if holds(state) {
        satisfied.insert("ede.stage".into());
    }
    if state == "checked" {
        satisfied.insert("ede.check".into());
    }
    let req = aep_dynaep::ede::EdeRequest {
        verb: verb.to_string(),
        state: state.to_string(),
        satisfied,
        now: ctx.now,
        seeded: 0,
        scanned: 0,
        sealed: 0,
        draft_max: ctx.op.draft_max_age_secs,
        scan_max: ctx.op.scan_max_age_secs,
        seal_max: ctx.op.seal_max_age_secs,
        staged,
        stage_max: ctx.op.stage_max_age_secs,
    };
    let result = aep_dynaep::ede::ede_wall(&ctx.lattice()?, &req);
    if result.allow {
        Ok(())
    } else {
        Err(format!(
            "the dynAEP lifecycle wall refused ede.{}: {}",
            verb,
            result
                .closed
                .iter()
                .map(|w| format!("{} {}", w.id, w.reason))
                .collect::<Vec<_>>()
                .join(" | ")
        ))
    }
}

/// The promoted draft a stage verb works on, under its lock, with its caller.
fn open(ctx: &Ctx, draft: &str, verb: &str) -> Result<(Record, store::DraftLock, Who), Report> {
    let lock = store::lock(&ctx.op, draft).map_err(|e| Report::deny("draft_busy", draft, &e))?;
    let r = store::load(&ctx.op, draft).map_err(|e| Report::deny(e.code(), draft, ""))?;
    let w = who(ctx, &r, verb)?;
    if r.state != State::Promoted {
        return Err(Report::deny(
            "stage_needs_promote",
            draft,
            "only the promoted tree of a draft is staged",
        ));
    }
    if !r.git_dir().is_dir() {
        return Err(Report::deny(
            "stage_folder_gone",
            draft,
            "the folder of the draft is gone: seed, scan and promote again",
        ));
    }
    Ok((r, lock, w))
}

fn shell(command: &str, dir: &Path) -> Result<Command, String> {
    privilege::assert_lowered("a stage command")?;
    let mut c = Command::new("/bin/sh");
    c.arg("-c")
        .arg(command)
        .current_dir(dir)
        .env_clear()
        .env("PATH", crate::child_path());
    Ok(c)
}

/// The scanned tree of a draft written into a new folder through an index of its own.
fn export(r: &Record, dest: &Path) -> Result<(), String> {
    let _ = fs::remove_dir_all(dest);
    fs::create_dir_all(dest).map_err(|e| format!("{}: {}", dest.display(), e))?;
    let index = r.git_dir().join("aep-ede-stage.index");
    let _ = fs::remove_file(&index);
    let env = vec![("GIT_INDEX_FILE".to_string(), index.display().to_string())];
    git::git_env(r, &env, &["read-tree", &r.scan_tree])?;
    let prefix = format!("--prefix={}/", dest.display());
    let res = git::git_env(r, &env, &["checkout-index", "-a", "-f", &prefix]);
    let _ = fs::remove_file(&index);
    res.map(|_| ())
}

fn manifest_of(ctx: &Ctx, r: &Record, rel: &str) -> Result<(Manifest, String), String> {
    if !rel_ok(rel) {
        return Err(format!("{} is not a path inside the promoted tree", rel));
    }
    crate::restore(ctx, r)?;
    let entry = git::git(r, &["ls-tree", &r.scan_tree, "--", rel])?;
    let id = entry
        .split_whitespace()
        .nth(2)
        .ok_or_else(|| format!("the promoted tree holds no {}", rel))?
        .to_string();
    let bytes = git::blob(r, &id)?;
    let text = String::from_utf8(bytes).map_err(|_| format!("{} is not UTF-8 text", rel))?;
    Ok((
        parse_manifest(&text, MANIFEST_SCHEMA)?,
        seal::sha256_hex(text.as_bytes()),
    ))
}

fn detail(rec: &StageRecord) -> String {
    let mut s = format!(
        "manifest {} sha {}",
        rec.manifest,
        &rec.manifest_sha[..16.min(rec.manifest_sha.len())]
    );
    for t in rec.targets.iter().take(20) {
        s.push_str(&format!(
            " {}={}",
            t.path.display(),
            &t.new_sha[..12.min(t.new_sha.len())]
        ));
    }
    for u in &rec.users {
        s.push_str(&format!(" user={}", u.name));
    }
    s
}

/// End a stage with a way back: reverted when every target is back, failed (holding its
/// targets for the operator) when not.
fn end_reverted(
    ctx: &Ctx,
    r: &Record,
    mut rec: StageRecord,
    why: &str,
) -> (StageRecord, Vec<String>) {
    let mut errs = revert(&ctx.op.record_root, &rec.draft_id, &rec.targets);
    errs.extend(tools(&ctx.op).remove(&rec.users));
    rec.ended_unix = ctx.now;
    if errs.is_empty() {
        rec.state = "reverted".into();
        rec.note = why.to_string();
        clear_copies(&ctx.op.record_root, &rec.draft_id);
    } else {
        rec.state = "failed".into();
        rec.note = format!("{}; the way back left: {}", why, errs.join(" | "));
    }
    let _ = write_record(&ctx.op, &ctx.op.record_root, &rec, RECORD_SCHEMA);
    ctx.event(
        if errs.is_empty() {
            "stage-revert"
        } else {
            "stage-failed"
        },
        r,
        &format!("{} | {}", why, detail(&rec)),
    );
    (rec, errs)
}

fn fail(ctx: &Ctx, r: &Record, rec: StageRecord, code: &str, why: &str) -> Report {
    let (rec, _) = end_reverted(ctx, r, rec, why);
    Report::deny(code, &r.draft_id, &format!("{} | stage {}", why, rec.state))
}

fn check(ctx: &Ctx, r: &Record, mut rec: StageRecord, m: &Manifest) -> Report {
    let c = match shell(&m.check, Path::new("/")) {
        Ok(c) => c,
        Err(e) => return fail(ctx, r, rec, "stage_check", &e),
    };
    let (code, last) = run_timed(c, ctx.op.stage_check_timeout_secs).unwrap_or_else(|e| (-1, e));
    rec.check_exit = code as i64;
    if code != 0 {
        ctx.event(
            "stage-check",
            r,
            &format!("check failed with exit {}: {}", code, last),
        );
        return fail(
            ctx,
            r,
            rec,
            "stage_check_failed",
            &format!("the check failed with exit {}: {}", code, last),
        );
    }
    rec.state = "checked".into();
    rec.note = "the check passed".into();
    if let Err(e) = write_record(&ctx.op, &ctx.op.record_root, &rec, RECORD_SCHEMA) {
        return fail(ctx, r, rec, "stage_record", &e);
    }
    ctx.event("stage-check", r, "check passed");
    Report::allow(
        "stage_checked",
        &r.draft_id,
        &format!(
            "provisional until {}: the operator confirms with aep-ede stage-confirm {}; aep-ede stage-revert {} puts every target back; the sweep reverts it after the deadline",
            rec.deadline_unix, r.draft_id, r.draft_id
        ),
    )
}

/// Stage the host change of a promoted draft.
pub fn stage(draft: &str, manifest_rel: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, _who) = match open(&ctx, draft, "stage") {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    let rr = ctx.op.record_root.clone();
    let _host = match host_lock(&rr) {
        Ok(h) => h,
        Err(e) => return Report::deny("stage_lock", draft, &e),
    };
    let prior = match read_record(&ctx.op, &rr, draft, RECORD_SCHEMA) {
        Ok(p) => p,
        Err(e) => return Report::deny("stage_record_forged", draft, &e),
    };
    let prior_state = prior
        .as_ref()
        .map(|p| p.state.clone())
        .unwrap_or_else(|| "none".into());
    if !matches!(prior_state.as_str(), "none" | "reverted") {
        return Report::deny(
            "stage_exists",
            draft,
            &format!("the draft holds a stage in the state {}", prior_state),
        );
    }
    if let Err(e) = wall(&ctx, "stage", &prior_state, 0) {
        return Report::deny("lifecycle_wall", draft, &e);
    }
    let (m, msha) = match manifest_of(&ctx, &r, manifest_rel) {
        Ok(x) => x,
        Err(e) => return Report::deny("stage_manifest", draft, &e),
    };
    let findings = judge(&m, &limits(&ctx.op));
    if !findings.is_empty() {
        return Report::deny("stage_targets", draft, &findings.join(" | "));
    }
    for other in all_records(&rr) {
        if other == draft {
            continue;
        }
        if let Ok(Some(o)) = read_record(&ctx.op, &rr, &other, RECORD_SCHEMA) {
            if !holds(&o.state) {
                continue;
            }
            for f in &m.files {
                if o.targets
                    .iter()
                    .any(|t| Some(&t.path) == plain(&f.target).as_ref())
                {
                    return Report::deny(
                        "stage_target_held",
                        draft,
                        &format!(
                            "target {} belongs to the open stage of {}",
                            f.target.display(),
                            other
                        ),
                    );
                }
            }
        }
    }
    let work = r.folder.join("stage-work");
    if let Err(e) = export(&r, &work) {
        return Report::deny("stage_export", draft, &e);
    }
    if !m.build.is_empty() {
        let c = match shell(&m.build, &work) {
            Ok(c) => c,
            Err(e) => return Report::deny("stage_build", draft, &e),
        };
        match run_timed(c, ctx.op.stage_build_timeout_secs) {
            Ok((0, _)) => {}
            Ok((code, last)) => {
                return Report::deny(
                    "stage_build",
                    draft,
                    &format!("the build failed with exit {}: {}", code, last),
                )
            }
            Err(e) => return Report::deny("stage_build", draft, &e),
        }
    }
    let base = match fs::canonicalize(&work) {
        Ok(b) => b,
        Err(e) => return Report::deny("stage_export", draft, &e.to_string()),
    };
    let mut artifacts = Vec::new();
    for f in &m.files {
        let src = work.join(&f.source);
        let ok = fs::symlink_metadata(&src)
            .map(|x| x.file_type().is_file())
            .unwrap_or(false)
            && fs::canonicalize(&src)
                .map(|c| c.starts_with(&base))
                .unwrap_or(false);
        if !ok {
            return Report::deny(
                "stage_source",
                draft,
                &format!("{} is no plain file of the export", f.source),
            );
        }
        match fs::read(&src) {
            Ok(b) => artifacts.push(b),
            Err(e) => return Report::deny("stage_source", draft, &format!("{}: {}", f.source, e)),
        }
    }
    let mut rec = StageRecord {
        draft_id: draft.to_string(),
        owner: r.agent.clone(),
        manifest: manifest_rel.to_string(),
        manifest_sha: msha,
        state: "staged".into(),
        staged_unix: ctx.now,
        deadline_unix: ctx.now + ctx.op.stage_max_age_secs,
        ..Default::default()
    };
    if let Err(e) = write_record(&ctx.op, &rr, &rec, RECORD_SCHEMA) {
        return Report::deny("stage_record", draft, &e);
    }
    let t = tools(&ctx.op);
    let mut created = Vec::new();
    let made = t.create(&m.users, &|_| false, &mut created);
    rec.users = created;
    if let Err(e) = made {
        return fail(&ctx, &r, rec, "stage_users", &format!("users: {}", e));
    }
    let (passwd, group) = t.tables();
    let mut plan = Vec::new();
    for (f, bytes) in m.files.iter().zip(artifacts) {
        let (uid, gid) = match (id_in(&passwd, &f.owner), id_in(&group, &f.group)) {
            (Some(u), Some(g)) => (u, g),
            _ => {
                return fail(
                    &ctx,
                    &r,
                    rec,
                    "stage_owner",
                    &format!(
                        "owner {} or group {} of {} does not exist",
                        f.owner,
                        f.group,
                        f.target.display()
                    ),
                )
            }
        };
        plan.push((
            plain(&f.target).unwrap_or_else(|| f.target.clone()),
            bytes,
            uid,
            gid,
            f.mode,
        ));
    }
    let mut targets = Vec::new();
    let put = apply(&rr, draft, &plan, &mut targets);
    rec.targets = targets;
    if let Err(e) = put {
        return fail(&ctx, &r, rec, "stage_apply", &e);
    }
    if let Err(e) = write_record(&ctx.op, &rr, &rec, RECORD_SCHEMA) {
        return fail(&ctx, &r, rec, "stage_record", &e);
    }
    ctx.event("stage", &r, &detail(&rec));
    let _ = fs::remove_dir_all(&work);
    check(&ctx, &r, rec, &m)
}

fn open_stage(ctx: &Ctx, draft: &str) -> Result<StageRecord, Report> {
    match read_record(&ctx.op, &ctx.op.record_root, draft, RECORD_SCHEMA) {
        Ok(Some(rec)) => Ok(rec),
        Ok(None) => Err(Report::deny("stage_missing", draft, "")),
        Err(e) => Err(Report::deny("stage_record_forged", draft, &e)),
    }
}

/// Run the check of a stage again inside its deadline.
pub fn stage_check(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, _who) = match open(&ctx, draft, "stage-check") {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    let _host = match host_lock(&ctx.op.record_root) {
        Ok(h) => h,
        Err(e) => return Report::deny("stage_lock", draft, &e),
    };
    let rec = match open_stage(&ctx, draft) {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    if !matches!(rec.state.as_str(), "staged" | "checked") {
        return Report::deny("stage_state", draft, &format!("the stage is {}", rec.state));
    }
    if ctx.now > rec.deadline_unix {
        return Report::deny(
            "stage_deadline",
            draft,
            "the stage passed its deadline: revert it",
        );
    }
    if let Err(e) = wall(&ctx, "check", &rec.state, rec.staged_unix) {
        return Report::deny("lifecycle_wall", draft, &e);
    }
    let m = match manifest_of(&ctx, &r, &rec.manifest) {
        Ok((m, sha)) if sha == rec.manifest_sha => m,
        Ok(_) => {
            return Report::deny(
                "stage_manifest",
                draft,
                "the manifest differs from the staged one",
            )
        }
        Err(e) => return Report::deny("stage_manifest", draft, &e),
    };
    check(&ctx, &r, rec, &m)
}

/// Put every target of a stage back.
pub fn stage_revert(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, who) = match open(&ctx, draft, "stage-revert") {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    let _host = match host_lock(&ctx.op.record_root) {
        Ok(h) => h,
        Err(e) => return Report::deny("stage_lock", draft, &e),
    };
    let rec = match open_stage(&ctx, draft) {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    if !holds(&rec.state) {
        return Report::deny("stage_state", draft, &format!("the stage is {}", rec.state));
    }
    if let Err(e) = wall(&ctx, "revert", &rec.state, rec.staged_unix) {
        return Report::deny("lifecycle_wall", draft, &e);
    }
    let by = if who == Who::Operator {
        "the operator"
    } else {
        "its agent"
    };
    let (rec, errs) = end_reverted(&ctx, &r, rec, &format!("reverted by {}", by));
    if errs.is_empty() {
        Report::allow(
            "stage_reverted",
            draft,
            &format!("{} targets back in their old state", rec.targets.len()),
        )
    } else {
        Report::deny("stage_revert_incomplete", draft, &errs.join(" | "))
    }
}

/// The operator makes a checked stage permanent.
pub fn stage_confirm(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    let (r, _lock, who) = match open(&ctx, draft, "stage-confirm") {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    if who != Who::Operator {
        return Report::deny(
            "stage_confirm_operator_only",
            draft,
            "only the operator confirms a stage",
        );
    }
    let _host = match host_lock(&ctx.op.record_root) {
        Ok(h) => h,
        Err(e) => return Report::deny("stage_lock", draft, &e),
    };
    let mut rec = match open_stage(&ctx, draft) {
        Ok(x) => x,
        Err(rep) => return rep,
    };
    if rec.state != "checked" {
        return Report::deny(
            "stage_state",
            draft,
            &format!(
                "only a checked stage is confirmed; this one is {}",
                rec.state
            ),
        );
    }
    if ctx.now > rec.deadline_unix {
        return Report::deny(
            "stage_deadline",
            draft,
            "the stage passed its deadline: revert it and stage again",
        );
    }
    if let Err(e) = wall(&ctx, "confirm", &rec.state, rec.staged_unix) {
        return Report::deny("lifecycle_wall", draft, &e);
    }
    rec.state = "confirmed".into();
    rec.ended_unix = ctx.now;
    rec.note = "confirmed by the operator".into();
    if let Err(e) = write_record(&ctx.op, &ctx.op.record_root, &rec, RECORD_SCHEMA) {
        return Report::deny("stage_record", draft, &e);
    }
    clear_copies(&ctx.op.record_root, draft);
    ctx.event("stage-confirm", &r, &detail(&rec));
    Report::allow(
        "stage_confirmed",
        draft,
        &format!("{} targets are permanent", rec.targets.len()),
    )
}

/// The state of the stage of a draft.
pub fn stage_status(draft: &str) -> Report {
    let ctx = Ctx::load();
    if let Err(r) = ctx.preamble() {
        return r;
    }
    match read_record(&ctx.op, &ctx.op.record_root, draft, RECORD_SCHEMA) {
        Ok(Some(rec)) => Report::allow(
            &format!("stage_{}", rec.state),
            draft,
            &format!(
                "staged {} deadline {} targets {} users {} check_exit {} | {}",
                rec.staged_unix,
                rec.deadline_unix,
                rec.targets.len(),
                rec.users.len(),
                rec.check_exit,
                rec.note
            ),
        ),
        Ok(None) => Report::deny("stage_missing", draft, ""),
        Err(e) => Report::deny("stage_record_forged", draft, &e),
    }
}

/// The sweep: every stage that holds its targets past its deadline goes back.
pub fn sweep_deadlines(ctx: &Ctx) -> Vec<String> {
    let mut out = Vec::new();
    let rr = ctx.op.record_root.clone();
    let _host = match host_lock(&rr) {
        Ok(h) => h,
        Err(e) => {
            out.push(format!("stage lock {}", e));
            return out;
        }
    };
    for id in all_records(&rr) {
        let rec = match read_record(&ctx.op, &rr, &id, RECORD_SCHEMA) {
            Ok(Some(r)) => r,
            Ok(None) => continue,
            Err(e) => {
                out.push(format!("stage record {} {}", id, e));
                continue;
            }
        };
        if !holds(&rec.state) || ctx.now <= rec.deadline_unix {
            continue;
        }
        let _lock = match store::lock(&ctx.op, &id) {
            Ok(l) => l,
            Err(_) => {
                out.push(format!("busy stage {}", id));
                continue;
            }
        };
        let r = match store::load(&ctx.op, &id) {
            Ok(r) => r,
            Err(e) => {
                out.push(format!("stage {} without a draft record {}", id, e.code()));
                continue;
            }
        };
        let (rec, errs) = end_reverted(ctx, &r, rec, "past the stage deadline without a confirm");
        if errs.is_empty() {
            out.push(format!("reverted the stage of {} past its deadline", id));
        } else {
            out.push(format!(
                "the stage of {} is {}: {}",
                id,
                rec.state,
                errs.join(" | ")
            ));
        }
    }
    out
}
