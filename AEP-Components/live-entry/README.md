# Live entry

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`.

The crate is the live entry of the kernel in Rust: it loads the action lattice, runs the envelope Admit in the same process, applies the allowed change and issues the event id. A missing or unreadable lattice and an empty action path are denied.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-live-entry` |

Run its tests from the repository root with `cargo test -p aep-live-entry`.
