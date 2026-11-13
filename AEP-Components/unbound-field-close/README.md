# Unbound field close

This folder belongs to component 03 (One Validation Envelope) and the README of the whole component is `AEP-Components/envelope/README.md`.

The crate is a source check on the envelope. It fails when an action without a bound scene, channel, time or sequence number could pass. One exception exists: the destination dock may be taken from the docking port of the opened capsule.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-unbound-field-close` |

Run its tests from the repository root with `cargo test -p aep-unbound-field-close`.
