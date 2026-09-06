// @PAD: aep-admit-cli-v1
// @GCDE: gaplune.policy.v1
// CLI: one wall per line id=<id> closed=<true|false> reason=<text>
// writing_text=<prose> compiles writing.gap into Admit walls on this pass.
// agent_id= action= grant=agent:action compile the GAP agent-may wall on this pass.
// Prints allow= and closed=<id>|<reason> lines. Closed set is sorted.

use aep_admit::{
    admit_collect_all, compile_agent_may_wall, compile_writing_walls, AdmitWall, AgentMayGrant,
};
use std::io::{self, Read};

fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

fn parse_line(line: &str) -> Vec<AdmitWall> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }
    if line.starts_with('#') || line.starts_with('@') {
        return Vec::new();
    }
    if let Some(text) = line.strip_prefix("writing_text=") {
        return compile_writing_walls(text);
    }
    let mut id = String::new();
    let mut closed = false;
    let mut reason = String::new();
    for part in line.split('\t') {
        if let Some((k, v)) = part.split_once('=') {
            match k.trim() {
                "id" => id = v.trim().to_string(),
                "closed" => closed = parse_bool(v),
                "reason" => reason = v.trim().to_string(),
                _ => {}
            }
        }
    }
    if id.is_empty() {
        return Vec::new();
    }
    if closed {
        vec![AdmitWall::close(id, reason)]
    } else {
        vec![AdmitWall::open(id)]
    }
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let mut walls: Vec<AdmitWall> = Vec::new();
    let mut agent_id = String::new();
    let mut action = String::new();
    let mut grants: Vec<AgentMayGrant> = Vec::new();
    for line in buf.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("agent_id=") {
            agent_id = v.trim().to_string();
            continue;
        }
        if let Some(v) = t.strip_prefix("action=") {
            action = v.trim().to_string();
            continue;
        }
        if let Some(v) = t.strip_prefix("grant=") {
            if let Some((a, act)) = v.split_once(':') {
                grants.push(AgentMayGrant {
                    agent_id: a.trim().to_string(),
                    action: act.trim().to_string(),
                });
            }
            continue;
        }
        walls.extend(parse_line(line));
    }
    if action.is_empty() == false {
        walls.push(compile_agent_may_wall(&agent_id, &action, &grants));
    }
    let result = admit_collect_all(&walls);
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    print!("{}", out);
}
