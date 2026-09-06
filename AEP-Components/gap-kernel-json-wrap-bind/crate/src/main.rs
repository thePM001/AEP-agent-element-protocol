// @PAD: gap-285-p5-kernel-json-wrap-bind-cli
// @GCDE: gaplune.policy.v1
// GAP-285-P5 CLI. source= then wrap= action_path=.

use aep_gap_kernel_json_wrap_bind::{live_admit_json_kernel, AdmitResult, BindRequest};
use std::io::{self, Read, Write};

fn emit(out: &mut impl Write, s: &str) {
    let _ = out.write_all(s.as_bytes());
}

fn main() {
    let mut buf = String::new();
    let _ = io::stdin().read_to_string(&mut buf);
    let mut source = String::new();
    let mut req = BindRequest::default();
    for raw in buf.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("#") {
            continue;
        }
        if let Some(v) = line.strip_prefix("source=") {
            source = v.to_string();
            continue;
        }
        if let Some(v) = line.strip_prefix("wrap=") {
            req.wrap = v.to_string();
            continue;
        }
        if let Some(v) = line.strip_prefix("action_path=") {
            req.action_path = v.to_string();
            continue;
        }
    }
    let mut result = AdmitResult::default();
    let mut err = String::new();
    live_admit_json_kernel(&source, &req, &mut result, &mut err);
    let mut out = io::stdout();
    if err.is_empty() == false {
        emit(&mut out, "allow=false\napplies=false\nerror=");
        emit(&mut out, &err);
        emit(&mut out, "\n");
        return;
    }
    emit(&mut out, "allow=");
    if result.allow {
        emit(&mut out, "true\n");
    } else {
        emit(&mut out, "false\n");
    }
    emit(&mut out, "applies=");
    if result.applies {
        emit(&mut out, "true\n");
    } else {
        emit(&mut out, "false\n");
    }
    emit(&mut out, "stem=");
    emit(&mut out, &result.stem);
    emit(&mut out, "\nskin=");
    emit(&mut out, &result.skin);
    emit(&mut out, "\n");
    let mut i = 0usize;
    while i < result.closed.len() {
        emit(&mut out, "closed=");
        emit(&mut out, &result.closed[i].id);
        emit(&mut out, "|");
        emit(&mut out, &result.closed[i].reason);
        emit(&mut out, "\n");
        i += 1;
    }
}
