# Evaluation Chain

Reference component. AEP 2.8 is a reference protocol library. This crate is not a factory.

## What it is

Derived 15-row ledger. Crate `aep-evaluation-chain` at `AEP-Components/evaluation-chain/crate`. Not a second live combinator.

All 15 walls are judged together. If two fail, both are listed. Order of walls does not change yes/no. Skip is not used.

## How to attach

1. Carry the action on a sealed lattice frame (`AEP-Components/lattice-channels/`).
2. Open the frame. Freeze the clock at seal and wait 1000 ms. That wait is compiled Base Node `PULSE_MS`. It is not a dynAEP yaml key.
3. Run collect-all Admit then Apply (`aep-envelope` via `aep-live-entry`).
4. Derive the 15-row ledger with `meet_named` / `run_meet_ledger`. Those helpers are not a second live combinator.

TypeScript runner files are removed.

- **Component ID:** `evaluation-chain`
- **Path:** `evaluation-chain/crate`
- **Crate:** `aep-evaluation-chain`
