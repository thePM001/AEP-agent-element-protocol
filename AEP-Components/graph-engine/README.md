# Graph Engine

Status: normative. Stability: evolving.

GraphEngine is the workflow runner with checkpoints on the AEP scene graph, meaning the map of what exists in the product. Before a node runs, execute must pass a gate that defaults to deny so a missing gate never starts the node. A local vector clock, meaning a per-graph step counter, ticks only after that gate allows. That counter is not the kernel check because Base Node still judges clock drift, age, future time, sequence and capsule-hash replay. TypeScript dynAEP remains a standalone component and GraphEngine does not replace Base Node as the kernel.

- **Component ID:** `graph-engine`
- **Path:** `AEP-Components/graph-engine/`
- **Module:** `lib/graph/index.ts`
- **Manifest:** `AEP-Base-Node/AEP-Registry/components/graph-engine`

## API

- `GraphEngine.addNode()` / `validate()` / `detectCycles()` / `execute()`
- `admitGate` on `GraphEngineOptions` defaults to deny
- Node types: `action`, `decision`, `wait`, `parallel`, `loop`
- Retry policies: linear, exponential, fibonacci backoff
- Decision branching via `policyEvaluator` + `branches` map. That evaluator is not Admit.

GraphEngine is a projection helper and a workflow runner over the live graph. It owns no graph state, because the live graph state is owned by the dynamic engine at `AEP-Components/dynAEP/`.

Tests: `./AEP-Components/conformance/runner/run.sh`

## AEP-Graph Orchestration

GraphEngine is the workflow runner on the AEP scene graph, meaning the map of what exists in the product. It keeps work in progress so a run can stop and later resume from a checkpoint.

### Gate before a node runs

Before a node runs, execute must pass a gate that defaults to deny so a missing gate never starts the node.

### Local step counter is not the kernel check

A local vector clock, meaning a per-graph step counter, ticks only after that gate allows. That counter is not the kernel check because Base Node still judges clock drift, age, future time, sequence and capsule-hash replay. TypeScript dynAEP remains a standalone component and GraphEngine does not replace Base Node as the kernel.

### Node types

| Type | Purpose |
|------|---------|
| Action | Execute agent tools or operations |
| Decision | Evaluate written policy for branching |
| Wait | Human-in-the-loop approval gates |
| Parallel | Concurrent execution with join synchronization |
| Loop | Cyclic execution with iteration bounds and exit conditions |

### Features

The engine can loop with bounded cycle detection and checkpoint every node so work can resume after a failure. It can wait for a human with timeout escalation, retry with configurable backoff and branch on written policy while it persists to lattice memory.

The local step counter still ticks only after the gate allows because the kernel check remains clock drift, age, future time, sequence and capsule-hash replay.

```typescript
import { GraphEngine } from "./AEP-Components/graph-engine/lib/graph/index.js";

const graph = new GraphEngine({
  entryNodeId: "start",
  admitGate: async () => true,
});
graph.addNode({ id: "start", type: "action", next: ["review"] });
graph.addNode({ id: "review", type: "decision", next: [], branches: { approve: "deploy", reject: "stop" } });
graph.addNode({ id: "deploy", type: "action", next: [] });
graph.addNode({ id: "stop", type: "action", next: [] });
graph.validate();
await graph.execute({ input: context });
```

With no gate, execute refuses to run the node and does not tick the local clock.
