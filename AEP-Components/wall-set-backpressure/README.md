# Wall set back pressure

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`.

The crate builds the deny report of a dock. The report lists the ids of the closed walls with a class each (writing, security, temporal, capability, poison or structural) and a mechanical repair for missing fields and writing. Grant lists never appear in a repair.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-wall-set-backpressure` |

Run its tests from the repository root with `cargo test -p aep-wall-set-backpressure`.
