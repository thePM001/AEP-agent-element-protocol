# Dock line reader

This folder belongs to component 02 (UCB) and the README of the whole component is `AEP-Base-Node/AEP-Docks/ucb/README.md`.

The crate reads one line from a dock connection in buffered chunks with a size cap. Its source check fails when the dock code of the Base Node goes back to reading one byte at a time.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-dock-line-reader` |

Run its tests from the repository root with `cargo test -p aep-dock-line-reader`.
