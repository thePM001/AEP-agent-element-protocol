# Multi-step red team corpus (CC-35)

Admit judges each proposed action on its own. A chain of actions that each pass can still reach a forbidden outcome. This folder holds the corpus of such chains that conformance check CC-35 runs.

## Run it

```bash
cargo test -p aep-conformance --test redteam_multistep
```

`run.sh` runs it with every other listed check. The harness is `crate/tests/redteam_multistep.rs`. It drives each step through the Base Node live dock entry (`envelope_admit::admit_sealed_payload_report`) with the reference policy system of this repository, so the walls that answer are the product walls. The per second event rate is cleared on each second boundary, as the Base Node pulse does.

## What passes

- Every case ends in the step that reaches the forbidden outcome. That step must be denied and the named wall must be among the closed walls.
- Every earlier step must answer as the corpus says, so a case also proves that the chain looks permitted until its last step.
- Every control chain must be allowed from start to end. The controls spread the same kinds of work over time, so the budgets are shown to hold attacks and not ordinary work.
- The corpus must hold at least 50 cases and every case at least two actions.

## Classes

| Class | Cases | Wall that answers |
|-------|-------|-------------------|
| agent-volume-slicing | RT-001 to RT-012 | `policy:budget:agent_volume_bytes` |
| wrap-volume-collusion | RT-013 to RT-018 | `policy:budget:wrap_volume_bytes` |
| agent-sensitivity-accumulation | RT-019 to RT-030 | `policy:budget:agent_sensitivity` |
| wrap-sensitivity-collusion | RT-031 to RT-036 | `policy:budget:wrap_sensitivity` |
| agent-novelty-probing | RT-037 to RT-044 | `policy:budget:agent_novelty` |
| wrap-novelty-collusion | RT-045 to RT-047 | `policy:budget:wrap_novelty` |
| privilege-climb | RT-048 to RT-052, RT-055 | `gap.agent_permission`, `order:partial_order`, `dag.membership` |
| content-after-warm-up | RT-053, RT-054 | `policy:security:no_pii_detected`, `policy:writing:no_em_dashes` |

The budget walls come from `AEP-Policy-System/reference/budget.gap` through the `aep-admit-budget-window` crate. See `AEP-Components/admit-budget-window/README.md`.

## Format

`multistep-v1.json` is JSON with these keys.

- `format` is `aep-redteam-multistep` and `format_version` is 1. `check` is `CC-35`.
- `clock` gives `start_ms` and the default `step_ms` between actions.
- `lattice` is the action lattice every chain starts from. Each node names its category, parents, grants and wrap.
- `cases` and `controls` are lists of chains. A chain has an `id`, a `goal` and `steps`. A case also has a `class`.
- A step names `agent`, `path` and `expect` (`allow` or `deny`). A deny step names its `wall`. Optional keys are `repeat` (how many actions the step expands to), `fill` (byte length of plain filler text in the payload), `text` (a note in the payload), `tool`, `target` (the scene, default `scene-rt`) and `advance_ms` (clock move before each action). In `target` and `tool` the token `{n}` becomes the repeat index.

Volume expectations are exact because the budget counts the bytes of the serialized event. Change the reference budget and the corpus together.
