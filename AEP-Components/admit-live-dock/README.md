# Admit live dock

This folder belongs to component 04 (Admit Gate) and the README of the whole component is `AEP-Components/admit/README.md`.

The crate joins the wall crates of the Admit Gate into the one live pass of the kernel, so writing, channel order, time bounds, window budgets, envelope walls and policy files are judged together. Its time walls measure a drift of 50 ms against the clock frozen at the seal and it closes a wall when an event states an agent other than the signer of its capsule.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-admit-live-dock` |

Run its tests from the repository root with `cargo test -p aep-admit-live-dock`.
