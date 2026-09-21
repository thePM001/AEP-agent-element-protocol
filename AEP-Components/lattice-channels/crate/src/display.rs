use serde::{Deserialize, Serialize};
use crate::ChannelError;
pub const DISPLAY_CONTRACT_ID: &str = "aep-display-surface";
pub const DISPLAY_SURFACE_CONTRACT_ID: &str = "aep-display-surface";
pub const DISPLAY_PLAINTEXT_KIND: &str = "display";
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DisplayPlaintext {
    pub kind: String,
    pub action_path: String,
    pub view: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sector: Option<String>,
}
impl DisplayPlaintext {
    pub fn new(action_path: impl Into<String>, view: impl Into<String>) -> Result<Self, ChannelError> {
        let body = Self { kind: DISPLAY_PLAINTEXT_KIND.to_string(), action_path: action_path.into(), view: view.into(), source: None, sector: None };
        body.validate()?;
        Ok(body)
    }
    fn validate(&self) -> Result<(), ChannelError> {
        if self.kind != DISPLAY_PLAINTEXT_KIND { return Err(ChannelError::DisplayPlaintext("kind must be display".to_string())); }
        if self.action_path.trim().is_empty() { return Err(ChannelError::DisplayPlaintext("empty action_path".to_string())); }
        if self.view.trim().is_empty() { return Err(ChannelError::DisplayPlaintext("empty view".to_string())); }
        Ok(())
    }
}
pub fn encode_display_plaintext(body: &DisplayPlaintext) -> Result<Vec<u8>, ChannelError> {
    body.validate()?;
    serde_json::to_vec(body).map_err(|err| ChannelError::DisplayPlaintext(err.to_string()))
}
pub fn decode_display_plaintext(bytes: &[u8]) -> Result<DisplayPlaintext, ChannelError> {
    let body: DisplayPlaintext = serde_json::from_slice(bytes).map_err(|_| {
        ChannelError::DisplayPlaintext("ad-hoc bytes are not DISPLAY JSON".to_string())
    })?;
    body.validate()?;
    Ok(body)
}

#[cfg(test)]
mod tests {
use super::*;
use crate::{build_frame, open_frame, ContractRegistry, DockingPort};
use aep_lattice_crypto::generate_sign_keypair;
#[test]
fn display_json_roundtrip() {
let body = DisplayPlaintext::new("demo.action", "demo.view").unwrap();
let bytes = encode_display_plaintext(&body).unwrap();
let got = decode_display_plaintext(&bytes).unwrap();
assert_eq!(got, body);
assert_eq!(got.kind, DISPLAY_PLAINTEXT_KIND);
assert_eq!(got.action_path, "demo.action");
assert_eq!(got.view, "demo.view");
}
#[test]
fn empty_action_path_denied() {
let err = DisplayPlaintext::new("", "demo.view").unwrap_err();
match err { ChannelError::DisplayPlaintext(_) => {} _ => panic!("empty action_path must deny") }
}
#[test]
fn empty_view_denied() {
let err = DisplayPlaintext::new("demo.action", "").unwrap_err();
match err { ChannelError::DisplayPlaintext(_) => {} _ => panic!("empty view must deny") }
}
#[test]
fn wrong_kind_denied() {
let raw = br#"{"kind":"other","action_path":"demo.action","view":"demo.view"}"#;
let err = decode_display_plaintext(raw).unwrap_err();
match err { ChannelError::DisplayPlaintext(_) => {} _ => panic!("wrong kind must deny") }
}
#[test]
fn ad_hoc_bytes_denied() {
let err = decode_display_plaintext(b"not-json").unwrap_err();
match err { ChannelError::DisplayPlaintext(_) => {} _ => panic!("ad-hoc bytes must deny") }
}
#[test]
fn seal_open_display_surface_contract() {
let kem = aep_lattice_crypto::generate_kem_keypair();
let sign = generate_sign_keypair();
let body = DisplayPlaintext::new("demo.action", "demo.view").unwrap();
let plaintext = encode_display_plaintext(&body).unwrap();
let frame = build_frame("ch-display", "AG-00001", "sess-display", DockingPort::DisplaySurface, DISPLAY_SURFACE_CONTRACT_ID, &plaintext, &kem, &sign, 1).unwrap();
let mut contracts = ContractRegistry::default();
contracts.register(DISPLAY_SURFACE_CONTRACT_ID);
let opened = open_frame(&frame, &kem, &sign.public, &contracts).unwrap();
let got = decode_display_plaintext(&opened).unwrap();
assert_eq!(got, body);
assert_eq!(frame.contract_id, DISPLAY_SURFACE_CONTRACT_ID);
assert_eq!(frame.docking_port, DockingPort::DisplaySurface);
}
}
