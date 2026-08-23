//! Live action_path admit for Base Node docks.
//! @PAD: aep28-env-024-live-wire-v1
//! @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c
use aep_live_entry::{LiveEntry, ProcessOut};
use serde_json::Value;
use std::path::Path;

pub fn load_live_entry(data_dir: &Path) -> LiveEntry {
    if let Ok(p) = std::env::var("AEP_LATTICE_YAML") {
        if p.is_empty() == false {
            if let Ok(le) = LiveEntry::from_yaml_file(Path::new(&p)) {
                return le;
            }
        }
    }
    let p = data_dir.join("lattice.yaml");
    if p.is_file() {
        if let Ok(le) = LiveEntry::from_yaml_file(&p) {
            return le;
        }
    }
    LiveEntry::new()
}

pub fn admit_sealed_payload(live: &mut LiveEntry, plaintext: &[u8]) -> Result<(), String> {
    let value: Value = match serde_json::from_slice(plaintext) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let action_path = value
        .get("action_path")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if action_path.is_empty() {
        return Ok(());
    }
    match live.process_event(value) {
        ProcessOut::Event(_) => Ok(()),
        ProcessOut::Reject(r) => Err(r.error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn yaml() -> &'static str {
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    trust_floor: 1\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    trust_floor: 2\n"
    }
    #[test]
    fn skips_non_json() {
        let mut le = LiveEntry::new();
        assert!(admit_sealed_payload(&mut le, b"not-json").is_ok());
    }
    #[test]
    fn skips_without_action_path() {
        let mut le = LiveEntry::new();
        assert!(admit_sealed_payload(&mut le, br#"{"type":"PING"}"#).is_ok());
    }
    #[test]
    fn denies_unknown_path() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let body = br#"{"type":"CUSTOM","action_path":"bogus:path","trust_tier":3,"payload":{"ok":true},"timestamp":1000000}"#;
        let err = admit_sealed_payload(&mut le, body).expect_err("deny");
        assert!(err.contains("Admit collect-all walls then Apply"));
    }
    #[test]
    fn allows_known_path() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        le.snapshot.satisfied_actions.insert(String::from("root:ping"));
        let body = br#"{"type":"CUSTOM","action_path":"action:write","agent_id":"agent-a","trust_tier":3,"payload":{"ok":true},"timestamp":1000000}"#;
        assert!(admit_sealed_payload(&mut le, body).is_ok());
    }
}
