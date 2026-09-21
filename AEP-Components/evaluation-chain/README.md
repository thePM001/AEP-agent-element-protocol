# Evaluation Chain

Reference component. AEP 2.8 is a reference protocol library. This crate is not a factory.

## What it is

Derived 15-row meet result. Crate `aep-evaluation-chain` at `AEP-Components/evaluation-chain/crate`. Not a second live combinator and not the runtime ledger.

The named runtime ledger is the SQLite lattice log in Base Node (`AEP-Base-Node/AEP-Crate/src/lattice_log.rs` over the `action-lattice.db` store). The meet result is a derived view over the live closer and it keeps the `MeetResult` name that callers read.

All 15 walls are judged together. If two fail, both are listed. Order of walls does not change yes/no. Skip is not used.

## How to attach

1. Carry the action on a sealed lattice frame (`AEP-Components/lattice-channels/`).
2. Open the frame. Freeze the clock at seal and wait 1000 ms. That wait is compiled Base Node `PULSE_MS`. It is not a dynAEP yaml key.
3. Run collect-all Admit then Apply (`aep-envelope` via `aep-live-entry`).
4. Derive the 15-row meet result with `meet_named` / `run_meet_ledger`. Those helpers are not a second live combinator. The helper name is kept because callers read it and the standing is a derived view.

TypeScript runner files are removed.

- **Component ID:** `evaluation-chain`
- **Path:** `evaluation-chain/crate`
- **Crate:** `aep-evaluation-chain`
