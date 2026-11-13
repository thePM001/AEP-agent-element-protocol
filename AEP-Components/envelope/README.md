# 03 / One Validation Envelope

Status: reference. Stability: evolving. The Rust crate `aep-envelope` is the specification; `lib/admit.mjs` mirrors its walls in JavaScript.

## What it is

The One Validation Envelope is the single container for everything the kernel checks about one action. The action, the agent, the scene, the time and the channel travel in one record and every wall reads the same frozen snapshot. All walls are evaluated in one pass, so the result never depends on the order of the rules.

## Place among the 18

The AEP Base Node (01) fills the envelope after the Base Node Pulse (10) released the capsule. The envelope hands its walls to the Admit Gate (04), which judges them together with the walls from GAP (06) and the result of the Scanners (12). An open result returns to the Base Node, which applies the action.

## What ships in 2.9

- `admit(action, snapshot)` in the crate `aep-envelope` evaluates 15 walls: `dag.membership`, `dag.parents`, `gap.agent_permission`, `gap.writing`, `scene.membership`, `time.authority`, `channel.dock`, `rate.session`, `scanner.bundle`, `rego.restricted`, `rego.forbidden_seq`, `rego.output_ceiling`, `covenant.tools`, `causal.sequence` and `forecast.anomaly`.
- A missing scene, timestamp, channel or sequence number closes its wall. An empty action lattice closes the membership wall.
- `plan_apply` and `apply` turn an open result into the next snapshot. Evaluation changes nothing.
- The crate `aep-evaluation-chain` derives a record of 15 named rows from the same evaluation.
- A JavaScript mirror of the walls with vitest suites for every wall family.

## Layout

| Path | Role |
|------|------|
| `crate/` | The crate `aep-envelope` with the walls, the lattice file reader and the program `aep-envelope` |
| `lib/admit.mjs` | The JavaScript form of the envelope walls |
| `tests/` | vitest suites for every wall family |
| `AEP-Components/envelope-walls/` | Compiles the lattice policy file into walls |
| `AEP-Components/evaluation-chain/` | The derived record of 15 rows |
| `AEP-Components/unbound-field-close/` | Source check: an unbound scene, channel, time or sequence closes |

## Interfaces

- Rust: `admit`, `admit_with_extra`, `plan_apply`, `apply`, `load_lattice_file` and `snapshot_from_nodes`.
- JavaScript: `admit(action, snap)`, `planApply` and `applySnapshot` in `lib/admit.mjs`.
- Program: `aep-envelope admit` reads one request as JSON on standard input.
- File formats: the action lattice as YAML or as a GAP document of kind `aep.lattice`.
- The writing wall asks the kernel program `aep-lattice-log`. Without that program the wall closes.

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

## Limits

- The envelope decides nothing alone. The Admit Gate (04) is the judgement.
- It does not hold the capsule. The Base Node Pulse (10) does.
- The derived record of 15 rows is no second pass and it is not the runtime ledger of the Base Node (01).

## Run and test

```bash
cargo test -p aep-envelope -p aep-evaluation-chain -p aep-envelope-walls -p aep-unbound-field-close
npx vitest run AEP-Components/envelope AEP-Components/evaluation-chain
```

## Related documents

- `AEP-Components/evaluation-chain/README.md` for the derived record
- `AEP-Components/admit/README.md` for the judgement
- `AEP-Components/tla/README.md` for the model AdmitConjunction
