# Envelope

Status: reference. Stability: evolving. The Rust crate `aep-envelope` is the specification; `lib/admit.mjs` mirrors its walls in JavaScript.

`admit(action, snap)` evaluates every envelope wall of one action against a lattice snapshot and collects all of them: Action Lattice membership and parents, scene membership, GAP agent permission, GAP writing, covenant tools, channel dock, time authority, session rate, the scanner bundle and the Rego walls for restricted actions, forbidden sequences and the output ceiling. `planApply` and `applySnapshot` turn an open result into the next snapshot.

| Path | Role |
|------|------|
| `crate/` | `aep-envelope` walls and the lattice YAML reader |
| `lib/admit.mjs` | the JavaScript form of the envelope walls |
| `tests/` | vitest suites for every wall family with the writing kernel switched off |

The writing walls ask the kernel binary `aep-lattice-log`; without it they close.

## Evaluation chain

To attach: open a sealed capsule, freeze the clock at seal, then run every check together and only then carry out the allowed action. Fifteen named rows are a derived ledger of that evaluation, a record written from the check rather than a second pass. All fifteen rows are judged together. If two fail, both are listed with wall ids, reasons and a prescribed repair for missing fields and writing. Grant lists stay off that repair and a retry must seal a new capsule because the order of the rows does not change yes or no and skip is not used.

The table below is that derived fifteen-row ledger.

| Step | Name | Description |
|------|------|-------------|
| 0 | Task scope | Action within subtask scope |
| 1 | Session state | Session active and valid |
| 2 | Who may act | This agent is written as allowed to do this action |
| 3 | System rate limit | Planetwide cap not exceeded |
| 4 | Session rate limit | Per-session cap not exceeded |
| 5 | Intent drift | Action aligns with baseline behaviour |
| 6 | Escalation | Higher authority required |
| 7 | Covenant evaluation | Permit, forbid and require rules |
| 8 | Rego check | Environment forbidden patterns |
| 9 | Capability | Written capabilities. A numeric trust score does not skip the check |
| 10-14 | Scanners + lattice + perception | Content scanners, dynAEP lattice, perception bounds |
