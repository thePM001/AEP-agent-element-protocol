# Graph Engine

Stateful persistent workflow engine with checkpoints and vector-clock metadata.

- **Component ID:** `graph-engine`
- **Path:** `AEP-Components/graph-engine/`
- **Module:** `lib/graph/index.ts`
- **Manifest:** `AEP-Base-Node/registry/components/graph-engine.json`

## API

- `GraphEngine.addNode()` / `validate()` / `detectCycles()` / `execute()`
- Node types: `action`, `decision`, `wait`, `parallel`, `loop`
- Retry policies: linear, exponential, fibonacci backoff
- Decision branching via `policyEvaluator` + `branches` map

Tests: `./AEP-Components/conformance/runner/run.sh`
