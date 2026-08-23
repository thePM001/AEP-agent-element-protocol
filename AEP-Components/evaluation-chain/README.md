# Evaluation Chain

Reference component. AEP 2.8 is a reference protocol library. This crate is not a factory.

## What it is

Rust meet of 15 walls. Crate `aep-evaluation-chain` at `AEP-Components/evaluation-chain/crate`.

All 15 walls are judged together. If two fail, both are listed. Order of walls does not change yes/no. Skip is not used.

## How to attach

1. Carry the action on a sealed lattice frame (`AEP-Components/lattice-channels/`).
2. Open the frame.
3. Run `aep_evaluation_chain::meet` (or `meet_named` / `run_meet_ledger`) on the 15 named walls.
4. For action-path collect-all Admit walls then Apply, use `aep-envelope` via `aep-live-entry`.

TypeScript runner files are removed.

- **Component ID:** `evaluation-chain`
- **Path:** `evaluation-chain/crate`
- **Crate:** `aep-evaluation-chain`
