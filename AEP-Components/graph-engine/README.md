# Graph Engine

GraphEngine is the workflow runner with checkpoints on the AEP scene graph, meaning the map of what exists in the product. Before a node runs, execute must pass a gate that defaults to deny so a missing gate never starts the node. A local vector clock, meaning a per-graph step counter, ticks only after that gate allows. That counter is not the kernel check because Base Node still judges clock drift, age, future time, sequence and capsule-hash replay. TypeScript dynAEP remains a standalone component and GraphEngine does not replace Base Node as the kernel.

- **Component ID:** `graph-engine`
- **Path:** `AEP-Components/graph-engine/`
- **Module:** `lib/graph/index.ts`
- **Manifest:** `AEP-Base-Node/registry/components/graph-engine`

## API

- `GraphEngine.addNode()` / `validate()` / `detectCycles()` / `execute()`
- `admitGate` on `GraphEngineOptions` defaults to deny
- Node types: `action`, `decision`, `wait`, `parallel`, `loop`
- Retry policies: linear, exponential, fibonacci backoff
- Decision branching via `policyEvaluator` + `branches` map. That evaluator is not Admit.

Tests: `./AEP-Components/conformance/runner/run.sh`
