# Graph engine admit check

This folder belongs to component 05 (Graph Engine) and the README of the whole component is `AEP-Components/graph-engine/README.md`.

The crate is a source check on the Graph Engine. It fails when the engine code runs a node without asking the admit function first, when the default is not deny or when the local step counter ticks before an allow.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-graph-engine-admit-gate` |

Run its tests from the repository root with `cargo test -p aep-graph-engine-admit-gate`.
