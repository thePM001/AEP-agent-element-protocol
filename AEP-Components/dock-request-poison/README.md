# Dock request poison

This folder belongs to component 02 (UCB) and the README of the whole component is `AEP-Base-Node/AEP-Docks/ucb/README.md`.

The crate makes sure a dock request answers with an error when a crashed thread left an internal lock poisoned, because the other outcome would be an abort of the whole process. Its source check fails when the dock code of the Base Node unwraps such a lock.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-dock-request-poison` |

Run its tests from the repository root with `cargo test -p aep-dock-request-poison`.
