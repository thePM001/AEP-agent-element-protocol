# Admit temporal bounds

This folder belongs to component 04 (Admit Gate) and the README of the whole component is `AEP-Components/admit/README.md`.

The crate parses the time bounds written for an action and compiles them into walls of the Admit pass. The walls are judged in the same collect-all pass as every other wall.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-admit-temporal-bounds` |

Run its tests from the repository root with `cargo test -p aep-admit-temporal-bounds`.
