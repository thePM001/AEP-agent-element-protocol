# Admit Budget Window

Status: normative. Stability: evolving.

Admit judges each proposed action on its own. A chain of actions that each pass can still reach a forbidden outcome: data leaving in small slices, several agents of one wrap each sending a share, sensitive reads summed past what any one task needs and an agent reaching for one new capability after another. This crate keeps a sliding window of what every agent and every wrap already spent and closes a budget wall on the action that would push a budget past its limit.

- **Component ID:** `admit-budget-window`
- **Crate:** `aep-admit-budget-window` at `AEP-Components/admit-budget-window/crate`
- **Policy:** `AEP-Policy-System/reference/budget.gap`
- **Conformance:** CC-35, the multi-step red team corpus at `AEP-Components/conformance/redteam/`

## The policy

The budget is a GAP policy. Each constraint names one scope and one dimension and becomes one wall:

| Constraint | Wall |
|------------|------|
| `hard: agent.volume_bytes <= budget.agent.volume_bytes` | `policy:budget:agent_volume_bytes` |
| `hard: agent.sensitivity <= budget.agent.sensitivity` | `policy:budget:agent_sensitivity` |
| `hard: agent.novelty <= budget.agent.novelty` | `policy:budget:agent_novelty` |
| `hard: wrap.volume_bytes <= budget.wrap.volume_bytes` | `policy:budget:wrap_volume_bytes` |
| `hard: wrap.sensitivity <= budget.wrap.sensitivity` | `policy:budget:wrap_sensitivity` |
| `hard: wrap.novelty <= budget.wrap.novelty` | `policy:budget:wrap_novelty` |

The limits live under `extensions.aep.budget`, the place the GAP meta schema v1.3 keeps for host data, so `gapc check` passes the file unchanged:

- `window_ms`: the width of the sliding window.
- `agent` and `wrap`: `volume_bytes`, `sensitivity` and `novelty` limits per scope.
- `sensitivity_paths`: weights per action path prefix. The largest matching prefix counts.
- `sensitivity_classes`: weights per class of the shared scan rule table `AEP-Components/scanners/rules/scan-rule-table.json`. Every class found in the event adds its weight. A class that the table does not hold is refused.
- `known_targets_max`: how many known targets each scope remembers for novelty.

## What is counted

- **volume_bytes** is the byte length of the serialized event, so every field counts and not only the payload.
- **sensitivity** is the weight of the action path plus the weights of the content classes found in every string of the event.
- **novelty** counts targets the scope had not touched before. A target is the action path, the tool and the scene together.
- The wrap is the wrap of the lattice node of the action path. The event cannot choose it. Actions on a node without a wrap share the `unwrapped` bucket.

## How it joins Admit

`aep-admit-live-dock` compiles the budget walls beside every other product wall crate and they join the one collect-all AND. Admit semantics do not change: the budget adds walls and the AND of all walls decides. Evaluation is pure. The walls read the ledger and the measured charge of the proposed action. The live entry holds the charge until Admit answers and records it beside Apply only when Admit allowed the action, so a denied action spends nothing.

`aep-policy-system-admit` lists `budget` among the required stems. A missing `budget.gap` closes `policy:budget:loaded`. A budget file whose parameters cannot be read closes `policy:budget:parameters`. The loader leaves the budget constraints to this crate because they hold state across actions.

## Tuning

The reference limits are a starting point. Raise them for agents whose ordinary work moves more data. Keep the corpus of CC-35 in step: its volume expectations are exact for the reference limits. An action that adds nothing to a dimension is never held by that dimension, so an agent that spent its sensitivity budget can still take plain actions.
