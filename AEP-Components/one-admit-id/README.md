# One admit id

This folder belongs to component 04 (Admit Gate) and the README of the whole component is `AEP-Components/admit/README.md`.

The crate `aep-one-admit-id` keeps one Admit function and one vocabulary of wall ids in the tree. Its source check fails when a second collect-all function or a conversion between two kinds of wall appears. The crate is not a member of the root workspace, so the workspace build and `cargo test --workspace` do not compile it.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-one-admit-id` |
