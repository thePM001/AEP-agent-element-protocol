//! Live action_path admit for Base Node docks.
//! @PAD: aep28-env-035-deny-before-apply-v1
//! @GCDE: gaplune-decode hmac-sha256:46457904cdfc05cde59672f9e4882546ccd3815135b3464b1a962c5eff8ae626
//! AEP28-ENV-025: fail-closed Admit on live dock. No skip for non-JSON or missing action_path.
//! AEP28-ENV-031: Product live path is Rust LiveEntry. TypeScript processEvent is not a second product Admit.
//! AEP28-ENV-034: missing lattice, unreadable lattice YAML and empty action_path on an empty lattice are Deny.
//! AEP28-ENV-035: collect-all Deny for empty action_path runs before Apply. process_event must not mutate LiveEntry then return Event.
//! AEP28-ENV-037: one Admit function. attach_live_walls then process_event. live_collect_all is not a second combinator.
//! AEP28-ENV-042: empty lattice closes dag.membership and gap.agent_may. Do not reopen AEP28-ENV-034.
//! AEP28-ENV-066: unbound scene, channel, time and sequence close. dest_dock may bind from the opened frame docking port.
//! AEP28-ENV-065: Admit collect-all then Apply runs on the Base Node pulse beat against the frozen seal snapshot.
//! AEP28-ENV-044: aep-lattice-log Record must call admit_sealed_payload_on_live_dock before kernel INSERT.
//! AEP28-ENV-076: every ClosedWall construction sets class. Writing walls stay on the Admit pass.
use aep_admit_live_dock::LiveDockContext;
use aep_one_live_evaluation::attach_live_walls;
use aep_live_entry::{Element, LiveEntry, ProcessOut};
use aep_wall_set_backpressure::{classify_wall, ClosedWall, DenyReport, CLASS_STRUCTURAL, CLASS_WRITING, CLASS_CAPABILITY};
use serde_json::Value;
use std::path::Path;
use crate::BaseNodeError;

pub fn load_live_entry(data_dir: &Path) -> LiveEntry {
    let env_path = std::env::var("AEP_LATTICE_YAML").ok().filter(|p| p.is_empty() == false);
    load_live_entry_from_paths(env_path.as_deref().map(Path::new), data_dir)
}

/// AEP28-ENV-034: a set env path that is missing or unreadable is Deny. Do not fall through to data_dir.
pub fn load_live_entry_from_paths(env_yaml: Option<&Path>, data_dir: &Path) -> LiveEntry {
    if let Some(p) = env_yaml {
        return match LiveEntry::from_yaml_file(p) {
            Ok(le) => le,
            Err(_) => LiveEntry::new(),
        };
    }
    let p = data_dir.join("lattice.yaml");
    if p.is_file() {
        return match LiveEntry::from_yaml_file(&p) {
            Ok(le) => le,
            Err(_) => LiveEntry::new(),
        };
    }
    LiveEntry::new()
}

pub fn admit_sealed_payload(live: &mut LiveEntry, plaintext: &[u8]) -> Result<(), BaseNodeError> {
    match admit_sealed_payload_report(live, plaintext, &LiveDockContext::unit_open()) {
        Ok(()) => Ok(()),
        Err(r) => Err(BaseNodeError::from(r)),
    }
}

pub fn admit_sealed_payload_on_live_dock(
    live: &mut LiveEntry,
    plaintext: &[u8],
    dock: &LiveDockContext,
)-> Result<(), BaseNodeError> {
    match admit_sealed_payload_report(live, plaintext, dock) {
        Ok(()) => Ok(()),
        Err(r) => Err(BaseNodeError::from(r)),
    }
}

pub fn admit_sealed_payload_report(
    live: &mut LiveEntry,
    plaintext: &[u8],
    dock: &LiveDockContext,
) -> Result<(), DenyReport> {
    let value: Value = match serde_json::from_slice(plaintext) {
        Ok(v) => v,
        Err(_) => {
            return Err(DenyReport::from_error_and_closed(
                "Admit collect-all walls then Apply: plaintext is not JSON",
                &[ClosedWall::with_class("payload.json", "plaintext is not JSON", CLASS_STRUCTURAL)],
            ));
        }
    };
    let action_path = value
        .get("action_path")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // AEP28-ENV-035: empty action_path is collect-all Deny before Apply.
    if action_path.is_empty() {
        return Err(DenyReport::from_error_and_closed(
            "Admit collect-all walls then Apply: missing action_path",
            &[ClosedWall::with_class("action.path", "missing action_path", CLASS_STRUCTURAL)],
        ));
    }
    attach_live_walls(live, &value, dock);
    match live.process_event(value) {
        ProcessOut::Event(_) => Ok(()),
        ProcessOut::Reject(r) => {
            let closed: Vec<ClosedWall> = r
                .closed
                .iter()
                .map(|w| ClosedWall::with_class(
                    w.id.clone(),
                    w.reason.clone(),
                    classify_wall(&w.id, &w.reason),
                ))
                .collect();
            Err(DenyReport::from_error_and_closed(&r.error, &closed))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn yaml() -> &'static str {
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_may: []\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_may: [\"agent-a\"]\n"
    }
    #[test]
    fn denies_non_json() {
        let mut le = LiveEntry::new();
        let err = admit_sealed_payload(&mut le, b"not-json").expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
    }
    #[test]
    fn denies_without_action_path() {
        let mut le = LiveEntry::new();
        let err = admit_sealed_payload(&mut le, br#"{"type":"PING"}"#).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
    }
    #[test]
    fn ping_meets_admit() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let err = admit_sealed_payload(&mut le, br#"{"type":"PING"}"#).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
    }
    #[test]
    fn ping_with_action_path_allows() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let body = br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":1}"#;
        assert!(admit_sealed_payload(&mut le, body).is_ok());
    }
    #[test]
    fn denies_unknown_path() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let body = br#"{"type":"CUSTOM","action_path":"bogus:path","payload":{"ok":true},"timestamp":1000000}"#;
        let err = admit_sealed_payload(&mut le, body).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
    }
    #[test]
    fn allows_known_path() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        le.snapshot.satisfied_actions.insert(String::from("root:ping"));
        let body = br#"{"type":"CUSTOM","action_path":"action:write","agent_id":"agent-a","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":1}"#;
        assert!(admit_sealed_payload(&mut le, body).is_ok());
    }
    #[test]
    fn skip_tests_are_gone() {
        let src = include_str!("envelope_admit.rs");
        let a = ["skips", "_non_json"].concat();
        let b = ["skips", "_without_action_path"].concat();
        let c = ["Err(_) => return Ok", "(())"].concat();
        assert_eq!(src.contains(&a), false);
        assert_eq!(src.contains(&b), false);
        assert_eq!(src.contains(&c), false);
    }
    #[test]
    fn live_dock_is_on_path() {
        let src = include_str!("envelope_admit.rs");
        assert_eq!(src.contains("aep_admit_live_dock"), true);
        assert_eq!(src.contains("aep_one_live_evaluation"), true);
        assert_eq!(src.contains("attach_live_walls"), true);
        assert_eq!(src.contains("process_event"), true);
        let start = src
            .find("pub fn admit_sealed_payload_report")
            .expect("fn");
        let rest = &src[start..];
        let brace = rest.find("{").expect("brace");
        let bytes = rest.as_bytes();
        let mut i = brace;
        let mut depth: i32 = 0;
        let mut end = rest.len();
        while i < bytes.len() {
            if bytes[i] == b"{"[0] {
                depth += 1;
            } else if bytes[i] == b"}"[0] {
                depth -= 1;
                if depth == 0 {
                    end = i + 1;
                    break;
                }
            }
            i += 1;
        }
        let fn_body = &rest[..end];
        let compact: String = fn_body.chars().filter(|c| c.is_whitespace() == false).collect();
        assert_eq!(compact.contains("attach_live_walls"), true);
        assert_eq!(compact.contains("process_event"), true);
        assert_eq!(compact.contains("live_collect_all"), false);
    }
    #[test]
    fn non_json_report_has_payload_wall() {
        let mut le = LiveEntry::new();
        let err = admit_sealed_payload_report(&mut le, b"not-json", &LiveDockContext::unit_open())
            .expect_err("deny");
        assert!(err.closed.iter().any(|w| w.id == "payload.json"));
        assert!(err.closed.iter().any(|w| w.id == "payload.json" && w.class == "structural"));
        assert_eq!(err.reseal_required, true);
        assert!(err.repairs.iter().any(|h| h.kind == "reseal_new_capsule"));
    }
    #[test]
    fn missing_action_path_report_has_action_path_wall() {
        let mut le = LiveEntry::new();
        let err = admit_sealed_payload_report(
            &mut le,
            br#"{"type":"PING"}"#,
            &LiveDockContext::unit_open(),
        )
        .expect_err("deny");
        assert!(err.closed.iter().any(|w| w.id == "action.path"));
        assert!(err.closed.iter().any(|w| w.id == "action.path" && w.class == "structural"));
        assert!(err.repairs.iter().any(|h| h.field == "action_path"));
    }
    #[test]
    fn empty_lattice_agent_may_is_capability_class() {
        let mut le = LiveEntry::new();
        let mut map = serde_json::Map::new();
        map.insert(String::from("type"), Value::String(String::from("PING")));
        map.insert(String::from("action_path"), Value::String(String::from("root:ping")));
        let body = serde_json::to_vec(&Value::Object(map)).expect("body");
        let err = admit_sealed_payload_report(&mut le, &body, &LiveDockContext::unit_open())
            .expect_err("deny");
        assert!(err.closed.iter().any(|w| w.id == "gap.agent_may" && w.class == CLASS_CAPABILITY));
        assert!(err.closed.iter().any(|w| w.id == "dag.membership" && w.class == CLASS_STRUCTURAL));
    }
    #[test]
    fn writing_wall_maps_to_writing_class() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let mut map = serde_json::Map::new();
        map.insert(String::from("type"), Value::String(String::from("PING")));
        map.insert(String::from("action_path"), Value::String(String::from("root:ping")));
        map.insert(String::from("timestamp"), Value::from(1000000));
        map.insert(String::from("target_id"), Value::String(String::from("scene-a")));
        map.insert(String::from("_sequenceNumber"), Value::from(1));
        let mut payload = serde_json::Map::new();
        let mut note = String::from("hello");
        note.push('\u{2014}');
        note.push_str("world");
        payload.insert(String::from("note"), Value::String(note));
        map.insert(String::from("payload"), Value::Object(payload));
        let body = serde_json::to_vec(&Value::Object(map)).expect("body");
        let err = admit_sealed_payload_report(&mut le, &body, &LiveDockContext::unit_open())
            .expect_err("deny");
        assert!(err.closed.iter().any(|w| w.id == "writing:no_em_dashes" && w.class == CLASS_WRITING));
    }
    fn deny_empty_lattice(le: &mut LiveEntry, body: &[u8]) {
        let err = admit_sealed_payload(le, body).expect_err("deny");
        assert!(
            err.to_string().contains("Admit collect-all walls then Apply")
                || err.to_string().contains("Lattice required")
        );
    }
    #[test]
    fn missing_lattice_is_deny() {
        let dir = tempfile::tempdir().expect("tmp");
        let mut le = load_live_entry(dir.path());
        deny_empty_lattice(&mut le, br#"{"type":"STATE_DELTA"}"#);
        deny_empty_lattice(&mut le, br#"{"type":"PING"}"#);
        match le.process_event(serde_json::from_str(r#"{"type":"STATE_DELTA"}"#).unwrap()) {
            ProcessOut::Reject(r) => assert!(r.error.contains("Lattice required")),
            ProcessOut::Event(_) => panic!("missing lattice must Deny"),
        }
    }
    #[test]
    fn unreadable_lattice_yaml_is_deny() {
        let dir = tempfile::tempdir().expect("tmp");
        std::fs::write(dir.path().join("lattice.yaml"), "{{ not a lattice").expect("bad yaml");
        let mut le = load_live_entry(dir.path());
        deny_empty_lattice(&mut le, br#"{"type":"PING","action_path":"root:ping"}"#);
        match le.process_event(serde_json::from_str(r#"{"type":"PING"}"#).unwrap()) {
            ProcessOut::Reject(r) => assert!(r.error.contains("Lattice required")),
            ProcessOut::Event(_) => panic!("unreadable lattice must Deny"),
        }
    }
    #[test]
    fn env_yaml_unreadable_does_not_fall_through() {
        let dir = tempfile::tempdir().expect("tmp");
        std::fs::write(dir.path().join("lattice.yaml"), yaml()).expect("good yaml");
        let bad = dir.path().join("bad.yaml");
        std::fs::write(&bad, "{{ not a lattice").expect("bad yaml");
        let mut le = load_live_entry_from_paths(Some(&bad), dir.path());
        match le.process_event(serde_json::from_str(r#"{"type":"PING","action_path":"root:ping"}"#).unwrap()) {
            ProcessOut::Reject(r) => assert!(r.error.contains("Lattice required")),
            ProcessOut::Event(_) => panic!("unreadable env lattice must Deny"),
        }
    }
    #[test]
    fn empty_action_path_on_empty_lattice_is_deny() {
        let mut le = LiveEntry::new();
        deny_empty_lattice(&mut le, br#"{"type":"STATE_DELTA"}"#);
    }

    #[test]
    fn non_empty_action_path_on_empty_lattice_is_deny() {
        let mut le = LiveEntry::new();
        deny_empty_lattice(&mut le, br#"{"type":"PING","action_path":"root:ping"}"#);
    }

    fn seed_component(le: &mut LiveEntry) {
        le.seed_shell();
        le.live.insert(
            String::from("CP-00001"),
            Element {
                id: String::from("CP-00001"),
                kind: String::from("component"),
                z: 20,
                parent: Some(String::from("SH-00001")),
                children: Vec::new(),
                visible: true,
                layout: Value::Object(serde_json::Map::new()),
            },
        );
    }
    #[test]
    fn empty_action_path_is_deny_with_no_live_entry_mutation() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        seed_component(&mut le);
        let before_ts = le.snapshot.bridge_ts_ms;
        let body = br#"{"type":"STATE_DELTA","delta":[{"op":"replace","path":"/elements/CP-00001/z","value":21}]}"#;
        let err = admit_sealed_payload(&mut le, body).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
        assert!(err.to_string().contains("missing action_path"));
        assert_eq!(le.live.get("CP-00001").unwrap().z, 20);
        assert_eq!(le.snapshot.bridge_ts_ms, before_ts);
        assert_eq!(le.forecast.contains_key("CP-00001"), false);
    }
    #[test]
    fn forecast_without_action_path_does_not_write_coordinates() {
        let mut le = LiveEntry::from_yaml(yaml()).expect("yaml");
        le.set_clock_ms(1000000);
        let before_ts = le.snapshot.bridge_ts_ms;
        let body = br#"{"type":"CUSTOM","dynaep_type":"AEP_RUNTIME_COORDINATES","target_id":"CP-00001","coordinates":{"x":1,"y":2}}"#;
        let err = admit_sealed_payload(&mut le, body).expect_err("deny");
        assert!(err.to_string().contains("Admit collect-all walls then Apply"));
        assert_eq!(le.forecast.contains_key("CP-00001"), false);
        assert_eq!(le.snapshot.bridge_ts_ms, before_ts);
    }
    #[test]
    fn process_event_must_not_mutate_then_envelope_admit_err() {
        let mut pe_live = LiveEntry::from_yaml(yaml()).expect("yaml");
        pe_live.set_clock_ms(1000000);
        seed_component(&mut pe_live);
        let mut admit_live = LiveEntry::from_yaml(yaml()).expect("yaml");
        admit_live.set_clock_ms(1000000);
        seed_component(&mut admit_live);
        let body = br#"{"type":"STATE_DELTA","delta":[{"op":"replace","path":"/elements/CP-00001/z","value":21}]}"#;
        let ev: Value = serde_json::from_slice(body).unwrap();
        let pe = pe_live.process_event(ev);
        let admit = admit_sealed_payload(&mut admit_live, body);
        assert!(admit.is_err());
        match pe {
            ProcessOut::Event(_) => panic!("process_event returned Event then envelope_admit Err"),
            ProcessOut::Reject(_) => {}
        }
        assert_eq!(pe_live.live.get("CP-00001").unwrap().z, 20);
        assert_eq!(admit_live.live.get("CP-00001").unwrap().z, 20);
        assert_eq!(pe_live.snapshot.bridge_ts_ms, 1000000);
        assert_eq!(admit_live.snapshot.bridge_ts_ms, 1000000);
        assert_eq!(pe_live.forecast.contains_key("CP-00001"), false);
        assert_eq!(admit_live.forecast.contains_key("CP-00001"), false);
    }
    #[test]
    fn collect_all_deny_runs_before_process_event() {
        let src = include_str!("envelope_admit.rs");
        let start = src
            .find("pub fn admit_sealed_payload_on_live_dock")
            .expect("fn");
        let body = &src[start..];
        let empty = body.find("action_path.is_empty()").expect("empty check");
        let pe = body.find("live.process_event").expect("process_event");
        assert!(empty < pe, "empty action_path Deny must run before process_event");
        let compact: String = src.chars().filter(|c| c.is_whitespace() == false).collect();
        let a = ["ProcessOut::Event(_)=>", "{ifaction_path.is_empty()}"].concat();
        assert_eq!(compact.contains(&a), false);
    }
}
