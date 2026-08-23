// @PAD: aep-admit-trust-floor-cli-v1
// @GCDE: gaplune-decode hmac-sha256:7f6eb29fac57fc4450572d98316368025a841db3100e3f9cdd24db8400d79292
// CLI: trust_tier=<n> trust_floor=<n> plus optional extra walls. Collect-all.

use aep_admit::{admit_collect_all, compile_trust_floor_wall, AdmitWall};
use std::io::{self, Read};

fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

fn parse_u32(raw: &str) -> Option<u32> {
    raw.trim().parse::<u32>().ok()
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let mut trust_tier: Option<u32> = None;
    let mut trust_floor: Option<u32> = None;
    let mut extra: Vec<AdmitWall> = Vec::new();
    for raw in buf.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        if let Some(v) = line.strip_prefix("trust_tier=") {
            trust_tier = parse_u32(v);
            continue;
        }
        if let Some(v) = line.strip_prefix("trust_floor=") {
            trust_floor = parse_u32(v);
            continue;
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
            continue;
        }
        if closed {
            extra.push(AdmitWall::close(id, reason));
        } else {
            extra.push(AdmitWall::open(id));
        }
    }
    let mut walls: Vec<AdmitWall> = Vec::new();
    if let (Some(tier), Some(floor)) = (trust_tier, trust_floor) {
        walls.push(compile_trust_floor_wall(tier, floor));
    }
    walls.extend(extra);
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
