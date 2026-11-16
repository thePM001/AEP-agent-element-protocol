//! Kernel dock client of the CAW of AEP.
//!
//! No command starts while the Base Node is silent. Before every run the gate of the
//! CAW asks this client, and the client proves a live kernel the only way the docks
//! allow: with one sealed frame.
//!
//! 1. It reads the public key of the dock and the sign key of the agent
//!    `caw-kernel-dock` from the data folder of the Base Node. It never creates a
//!    key: a missing key means the Base Node never booted here.
//! 2. It seals one `root:ping` to the validation dock and signs it as
//!    `caw-kernel-dock`.
//! 3. It sends the frame as one line to the validation socket and reads one answer
//!    line. A pending answer carries a digest. The client collects with that digest
//!    and the dock answers after its pulse.
//! 4. Only an admitted answer admits the run.
//!
//! Every other outcome is a refusal with its reason: no socket, a refused ping, an
//! answer that is not a dock answer and an answer that comes too late. The gate
//! reports each of them under the rule `kernel-dock-silent`.
//!
//! The identity grants nothing by itself. The lattice and a hub policy of the Base
//! Node must grant `root:ping` to `caw-kernel-dock`, or the dock refuses the ping.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aep_base_node::caw_kernel_dock::{
    CAW_KERNEL_DOCK_AGENT, CAW_KERNEL_DOCK_CHANNEL, CAW_KERNEL_DOCK_SESSION,
};
use aep_base_node::dock_keys::{dock_kem_path, try_load_or_create_dock_kem, AgentSignKeyStore};
use aep_base_node::{DockFrameResponse, DockVerdict, PULSE_MS};
use aep_caw_runtime::session::{GateRequest, KernelGate};
use aep_lattice_channel::{build_frame_for_dock, DockingPort};
use serde_json::json;

/// Contract the ping travels under.
pub const CONTRACT: &str = "dynaep-action-lattice";
/// Largest answer line the client reads.
const MAX_ANSWER_BYTES: u64 = 1024 * 1024;

/// The client of the validation dock of one Base Node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockClient {
    /// Data folder of the Base Node. It holds the keys.
    pub data_dir: PathBuf,
    /// Path of the validation socket.
    pub socket: PathBuf,
    /// Longest wait for one answer line. The default covers the pulse of the dock.
    pub answer_timeout: Duration,
}

impl DockClient {
    /// A client with the default wait: three pulses of the dock plus two seconds.
    pub fn new(data_dir: &Path, socket: &Path) -> Self {
        Self {
            data_dir: data_dir.to_path_buf(),
            socket: socket.to_path_buf(),
            answer_timeout: Duration::from_millis(3 * PULSE_MS as u64 + 2000),
        }
    }

    /// Seals the ping of one run and returns the request line for the dock.
    fn request_line(&self) -> Result<String, String> {
        if !dock_kem_path(&self.data_dir).exists() {
            return Err(format!(
                "the Base Node has no dock key under {}",
                self.data_dir.display()
            ));
        }
        let kem = try_load_or_create_dock_kem(&self.data_dir)
            .map_err(|e| format!("the dock key cannot be read: {e}"))?;
        let sign = AgentSignKeyStore::load(&self.data_dir)
            .get(CAW_KERNEL_DOCK_AGENT)
            .map_err(|e| format!("the sign key of {CAW_KERNEL_DOCK_AGENT} cannot be read: {e}"))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        // The payload names the action, the stamp of the caller and its sequence
        // number. Admit needs both: a ping with no stamp or with the sequence zero
        // is refused. The session and the plan digest stay out of the payload,
        // because the text walls of Admit read a long run of digits as a card
        // number. The stamp itself is moved past any value those walls would read
        // that way.
        let stamp = wall_safe_stamp(i64::try_from(now.as_millis()).unwrap_or(i64::MAX));
        let payload = json!({
            "type": "PING",
            "action_path": "root:ping",
            "payload": {"ok": true},
            "timestamp": stamp,
            "target_id": "caw",
            "_sequenceNumber": stamp,
        });
        let frame = build_frame_for_dock(
            CAW_KERNEL_DOCK_CHANNEL,
            CAW_KERNEL_DOCK_AGENT,
            CAW_KERNEL_DOCK_SESSION,
            DockingPort::ValidationEngine,
            CONTRACT,
            payload.to_string().as_bytes(),
            &kem.public,
            &sign,
            now.as_secs(),
        )
        .map_err(|e| format!("the ping cannot be sealed: {e}"))?;
        Ok(json!({"frame": frame, "signer_public_hex": hex::encode(&sign.public)}).to_string())
    }

    /// Sends one line and reads one answer line.
    fn ask(&self, stream: &mut BufReader<UnixStream>, line: &str) -> Result<String, String> {
        let io = |what: &str, e: std::io::Error| match e.kind() {
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => format!(
                "the validation dock did not answer within {} ms",
                self.answer_timeout.as_millis()
            ),
            _ => format!("{what} the validation dock: {e}"),
        };
        stream
            .get_mut()
            .write_all(format!("{line}\n").as_bytes())
            .map_err(|e| io("write to", e))?;
        let mut answer = String::new();
        let read = std::io::Read::take(&mut *stream, MAX_ANSWER_BYTES)
            .read_line(&mut answer)
            .map_err(|e| io("read from", e))?;
        if read == 0 {
            return Err("the validation dock closed the connection with no answer".to_string());
        }
        Ok(answer)
    }
}

/// True when a run of digits passes the card number check of the text walls of
/// Admit: 13 to 19 digits with a valid Luhn sum.
fn reads_as_card_number(digits: &str) -> bool {
    if !(13..=19).contains(&digits.len()) {
        return false;
    }
    let mut sum = 0u32;
    for (i, byte) in digits.bytes().rev().enumerate() {
        let mut n = u32::from(byte - b'0');
        if i % 2 == 1 {
            n *= 2;
            if n > 9 {
                n -= 9;
            }
        }
        sum += n;
    }
    sum.is_multiple_of(10)
}

/// The first stamp at or after `ms` that the text walls of Admit do not read as a
/// card number. One in ten stamps reads as one, so this moves a stamp by a few
/// milliseconds at most and keeps the order of stamps.
fn wall_safe_stamp(ms: i64) -> i64 {
    let mut stamp = ms.max(1);
    while reads_as_card_number(&stamp.to_string()) {
        stamp += 1;
    }
    stamp
}

/// The reason a dock gave for a refusal, as far as the answer names one.
fn refusal_of(answer: &str) -> String {
    match serde_json::from_str::<DockFrameResponse>(answer.trim()) {
        Ok(resp) => {
            let mut reason = resp.error.unwrap_or_else(|| "no reason given".to_string());
            if let Some(deny) = resp.deny {
                let walls: Vec<String> = deny.closed.iter().map(|w| format!("{w:?}")).collect();
                if !walls.is_empty() {
                    reason.push_str(&format!(" (closed walls: {})", walls.join(", ")));
                }
            }
            format!("the validation dock refused the ping: {reason}")
        }
        Err(_) => "the validation dock refused the ping".to_string(),
    }
}

impl KernelGate for DockClient {
    fn admit(&self, _request: &GateRequest<'_>) -> Result<(), String> {
        let line = self.request_line()?;
        let stream = UnixStream::connect(&self.socket)
            .map_err(|e| format!("no validation dock at {}: {e}", self.socket.display()))?;
        stream
            .set_read_timeout(Some(self.answer_timeout))
            .and_then(|()| stream.set_write_timeout(Some(self.answer_timeout)))
            .map_err(|e| format!("the socket takes no time limit: {e}"))?;
        let mut stream = BufReader::new(stream);
        let first = self.ask(&mut stream, &line)?;
        let answer = match DockFrameResponse::verdict_of_line(&first) {
            DockVerdict::Pending => {
                let digest = serde_json::from_str::<DockFrameResponse>(first.trim())
                    .ok()
                    .and_then(|r| r.digest)
                    .unwrap_or_default();
                self.ask(&mut stream, &json!({"collect": digest}).to_string())?
            }
            _ => first,
        };
        match DockFrameResponse::verdict_of_line(&answer) {
            DockVerdict::Admitted => Ok(()),
            DockVerdict::Pending => {
                Err("the validation dock still holds the ping after its pulse".to_string())
            }
            DockVerdict::Refused => Err(refusal_of(&answer)),
            DockVerdict::Malformed => {
                Err("the answer of the validation dock is not a dock answer".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_base_node::dock_keys::provision_agent_sign_key;
    use std::os::unix::net::UnixListener;
    use std::sync::mpsc::{channel, Receiver};

    /// A data folder with the two keys and a stand-in dock that answers each
    /// request line with the next canned line. `None` means no answer at all.
    struct Fixture {
        dir: PathBuf,
        client: DockClient,
        seen: Receiver<String>,
    }

    fn fixture(name: &str, answers: Vec<Option<&'static str>>) -> Fixture {
        let dir = std::env::temp_dir().join(format!("caw-dock-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        try_load_or_create_dock_kem(&dir).expect("dock key");
        provision_agent_sign_key(&dir, CAW_KERNEL_DOCK_AGENT).expect("sign key");
        let socket = dir.join("validation");
        let listener = UnixListener::bind(&socket).expect("bind");
        let (sender, seen) = channel();
        std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut reader = BufReader::new(stream);
            for answer in answers {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return;
                }
                let _ = sender.send(line);
                match answer {
                    Some(text) => {
                        let _ = reader.get_mut().write_all(format!("{text}\n").as_bytes());
                    }
                    None => std::thread::sleep(Duration::from_secs(3)),
                }
            }
        });
        let mut client = DockClient::new(&dir, &socket);
        client.answer_timeout = Duration::from_millis(800);
        Fixture { dir, client, seen }
    }

    fn request() -> (Vec<String>, &'static str) {
        (vec!["sh".to_string()], "sha256:plan")
    }

    fn admit(f: &Fixture) -> Result<(), String> {
        let (args, plan) = request();
        let result = f.client.admit(&GateRequest {
            session_id: "s1",
            plan_digest: plan,
            args: &args,
        });
        let _ = std::fs::remove_dir_all(&f.dir);
        result
    }

    #[test]
    fn an_admitted_ping_admits_the_run_and_the_frame_is_sealed_as_the_caw_agent() {
        let f = fixture("admitted", vec![Some(r#"{"ok":true,"event_id":7}"#)]);
        assert_eq!(admit(&f), Ok(()));
        let line = f.seen.recv().expect("request line");
        let value: serde_json::Value = serde_json::from_str(&line).expect("json");
        assert_eq!(value["frame"]["agent_id"], CAW_KERNEL_DOCK_AGENT);
        assert_eq!(value["frame"]["session_id"], CAW_KERNEL_DOCK_SESSION);
        assert_eq!(value["frame"]["channel_id"], CAW_KERNEL_DOCK_CHANNEL);
        assert_eq!(value["frame"]["contract_id"], CONTRACT);
        assert!(value["signer_public_hex"]
            .as_str()
            .is_some_and(|h| !h.is_empty()));
        assert!(!line.contains("root:ping"), "the payload travels sealed");
    }

    #[test]
    fn a_stamp_never_reads_as_a_card_number_and_keeps_its_order() {
        assert!(reads_as_card_number("4539578763621486"));
        assert!(reads_as_card_number("0000000000000"));
        assert!(!reads_as_card_number("4539578763621487"));
        assert!(!reads_as_card_number("123456789012"));
        let mut moved = 0;
        let mut last = 0;
        for ms in 1_794_860_000_000i64..1_794_860_002_000 {
            let stamp = wall_safe_stamp(ms);
            assert!(!reads_as_card_number(&stamp.to_string()), "{stamp}");
            assert!(stamp >= ms && stamp - ms <= 2, "{ms} became {stamp}");
            assert!(stamp >= last);
            last = stamp;
            if stamp != ms {
                moved += 1;
            }
        }
        assert!(moved > 100, "about one stamp in ten is moved, saw {moved}");
        assert_eq!(wall_safe_stamp(0), 1);
    }

    #[test]
    fn a_pending_ping_is_collected_with_its_digest() {
        let f = fixture(
            "pending",
            vec![
                Some(r#"{"ok":true,"pending":true,"digest":"abc123"}"#),
                Some(r#"{"ok":true,"event_id":9,"digest":"abc123"}"#),
            ],
        );
        assert_eq!(admit(&f), Ok(()));
        let _frame = f.seen.recv().expect("frame line");
        let collect = f.seen.recv().expect("collect line");
        assert_eq!(collect.trim(), r#"{"collect":"abc123"}"#);
    }

    #[test]
    fn a_ping_that_is_still_pending_after_the_collect_refuses_the_run() {
        let f = fixture(
            "still-pending",
            vec![
                Some(r#"{"ok":true,"pending":true,"digest":"abc123"}"#),
                Some(r#"{"ok":true,"pending":true,"digest":"abc123"}"#),
            ],
        );
        assert!(admit(&f).is_err_and(|e| e.contains("still holds the ping")));
    }

    #[test]
    fn a_refused_ping_refuses_the_run_with_the_reason_of_the_dock() {
        let f = fixture(
            "refused",
            vec![Some(
                r#"{"ok":false,"error":"agent has no permission for root:ping"}"#,
            )],
        );
        assert_eq!(
            admit(&f),
            Err(
                "the validation dock refused the ping: agent has no permission for root:ping"
                    .to_string()
            )
        );
        let no_id = fixture("no-event", vec![Some(r#"{"ok":true}"#)]);
        assert!(admit(&no_id).is_err_and(|e| e.contains("refused the ping")));
        let no_digest = fixture("no-digest", vec![Some(r#"{"ok":true,"pending":true}"#)]);
        assert!(admit(&no_digest).is_err_and(|e| e.contains("refused the ping")));
    }

    #[test]
    fn an_answer_that_is_not_a_dock_answer_refuses_the_run() {
        for (name, text) in [
            ("text", "pong"),
            ("no-ok", r#"{"event_id":7}"#),
            ("list", "[]"),
        ] {
            let f = fixture(name, vec![Some(text)]);
            assert_eq!(
                admit(&f),
                Err("the answer of the validation dock is not a dock answer".to_string()),
                "{text}"
            );
        }
    }

    #[test]
    fn a_dock_that_does_not_answer_in_time_refuses_the_run() {
        let silent = fixture("silent", vec![None]);
        assert!(admit(&silent).is_err_and(|e| e.contains("did not answer within 800 ms")));
        let late = fixture(
            "late",
            vec![Some(r#"{"ok":true,"pending":true,"digest":"d"}"#), None],
        );
        assert!(admit(&late).is_err_and(|e| e.contains("did not answer within")));
    }

    #[test]
    fn a_dock_that_closes_the_connection_refuses_the_run() {
        let f = fixture("closed", vec![]);
        assert!(admit(&f)
            .is_err_and(|e| e.contains("closed the connection") || e.contains("validation dock")));
    }

    #[test]
    fn no_socket_and_no_keys_refuse_the_run_and_no_key_is_created() {
        let f = fixture("no-socket", vec![]);
        let mut gone = f.client.clone();
        gone.socket = f.dir.join("absent");
        let (args, plan) = request();
        let gate = GateRequest {
            session_id: "s1",
            plan_digest: plan,
            args: &args,
        };
        assert!(gone
            .admit(&gate)
            .is_err_and(|e| e.contains("no validation dock at")));

        let empty = std::env::temp_dir().join(format!("caw-dock-{}-empty", std::process::id()));
        let _ = std::fs::remove_dir_all(&empty);
        std::fs::create_dir_all(&empty).expect("temp dir");
        let no_keys = DockClient::new(&empty, &f.client.socket);
        assert!(no_keys
            .admit(&gate)
            .is_err_and(|e| e.contains("has no dock key")));
        assert_eq!(
            std::fs::read_dir(&empty).expect("list").count(),
            0,
            "the client creates no key"
        );

        try_load_or_create_dock_kem(&empty).expect("dock key");
        assert!(no_keys
            .admit(&gate)
            .is_err_and(|e| e.contains("sign key of caw-kernel-dock")));
        let _ = std::fs::remove_dir_all(&empty);
        let _ = std::fs::remove_dir_all(&f.dir);
    }
}
