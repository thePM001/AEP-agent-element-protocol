# Admit channel order walls

This folder belongs to component 04 (Admit Gate) and the README of the whole component is `AEP-Components/admit/README.md`.

The crate turns two kinds of rule into walls of the Admit pass: the lattice channel a message must use and the partial order, meaning which actions must come before others. Both are judged in the same collect-all pass as every other wall.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-admit-channel-order-walls` |

Run its tests from the repository root with `cargo test -p aep-admit-channel-order-walls`.
