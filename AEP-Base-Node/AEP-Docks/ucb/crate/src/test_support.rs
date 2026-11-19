//! Test fixtures shared by the unit tests of the crate: a stand-in for
//! aep-lattice-log that records every call and a dock that allows every frame.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

/// A stand-in aep-lattice-log in `dir`. Every call appends its subcommand to
/// `calls.log` and its standard input as one line to `inputs.log`. build-frame
/// answers a fixture frame and record answers a ledger row.
pub fn recording_lattice_log(dir: &Path) -> PathBuf {
    let path = dir.join("recording-lattice-log");
    let calls = dir.join("calls.log");
    let inputs = dir.join("inputs.log");
    let d = char::from(36);
    let q = char::from(39);
    let mut s = String::from("#!/bin/sh\ncmd=\n");
    s.push_str(&format!("for a in \"{d}@\"; do\n"));
    s.push_str(&format!("  case \"{d}a\" in\n"));
    s.push_str("    build-frame) cmd=build-frame ;;\n");
    s.push_str("    record) cmd=record ;;\n");
    s.push_str("  esac\ndone\n");
    s.push_str(&format!("echo \"{d}cmd\" >> {q}{}{q}\n", calls.display()));
    s.push_str(&format!("cat >> {q}{}{q}\n", inputs.display()));
    s.push_str(&format!("echo >> {q}{}{q}\n", inputs.display()));
    s.push_str(&format!("if [ \"{d}cmd\" = build-frame ]; then\n"));
    s.push_str(&format!(
        "  printf {q}%s\\n{q} {q}{{\"frame\":{{\"kind\":\"fixture\"}},\"digest\":\"abc\",\"signer_public_hex\":\"ab\"}}{q}\n"
    ));
    s.push_str("  exit 0\nfi\n");
    s.push_str(&format!("if [ \"{d}cmd\" = record ]; then\n"));
    s.push_str(&format!(
        "  printf {q}%s\\n{q} {q}{{\"ok\":true,\"event_id\":11,\"frame_digest\":\"abc\"}}{q}\n"
    ));
    s.push_str("  exit 0\nfi\nexit 1\n");
    std::fs::write(&path, s).expect("write stand-in lattice log");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .expect("stand-in lattice log mode");
    path
}

/// The hex ML-DSA-65 signature of `manifest` as an operator makes it with aep-ml-dsa.
pub fn sign_task(
    manifest: &crate::store::TaskManifestV1,
    key: &aep_lattice_crypto::SignKeypair,
) -> String {
    let digest = crate::manifest::compute_manifest_digest(manifest);
    let message = aep_ucb_perimeter_v1::manifest_signing_message(&digest);
    hex::encode(aep_lattice_crypto::mldsa65_sign_detached(&message, key).expect("sign"))
}

/// Sign a complete provided manifest in place. The manifest must already carry
/// agent_id and session_id so that UCB fills nothing that the signature misses.
pub fn sign_provided(raw: &mut serde_json::Value, key: &aep_lattice_crypto::SignKeypair) {
    raw["signature"] = serde_json::Value::String(String::from("00"));
    let compiled = crate::gap_manifest::compile_provided_json(raw.clone()).expect("compile");
    raw["signature"] = serde_json::Value::String(sign_task(&compiled, key));
}

/// Signers with one fresh key registered for `agent_id`.
pub fn signers_for(
    agent_id: &str,
) -> (
    aep_ucb_perimeter_v1::ManifestSigners,
    aep_lattice_crypto::SignKeypair,
) {
    let key = aep_lattice_crypto::generate_sign_keypair();
    let mut signers = aep_ucb_perimeter_v1::ManifestSigners::new();
    signers.insert(agent_id, key.public.clone());
    (signers, key)
}

/// The subcommands the stand-in received, in order.
pub fn lattice_calls(dir: &Path) -> Vec<String> {
    std::fs::read_to_string(dir.join("calls.log"))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// The events the stand-in received on standard input, in order.
pub fn lattice_inputs(dir: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join("inputs.log"))
        .unwrap_or_default()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// A dock at `socket` that answers every frame with an Admit allow and event id 7
/// until the returned task is aborted.
pub fn allowing_dock(socket: &Path) -> tokio::task::JoinHandle<()> {
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent).expect("socket folder");
    }
    let listener = tokio::net::UnixListener::bind(socket).expect("bind dock fixture");
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                return;
            };
            let (reader, mut writer) = stream.into_split();
            let mut reader = tokio::io::BufReader::new(reader);
            let mut line = String::new();
            if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
                continue;
            }
            let mut out =
                serde_json::json!({"ok": true, "event_id": 7, "digest": "abc"}).to_string();
            out.push('\n');
            let _ = writer.write_all(out.as_bytes()).await;
        }
    })
}
