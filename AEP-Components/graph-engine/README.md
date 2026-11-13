# 05 / Graph Engine

Status: normative. Stability: evolving.

## What it is

The Graph Engine is the workflow state machine and runner of AEP. A workflow is a graph of nodes and the engine moves a run from node to node. After each node it saves a checkpoint, so a run stopped by a failure or by a waiting human resumes from the last checkpoint.

## Place among the 18

A workflow author hands a graph to the engine. Before each node the engine asks its admit function, which a deployment connects to the Admit Gate (04). The engine reads the scene graph owned by dynAEP (07) and it can persist run data to Lattice Memory (15). Its result is the finished or paused run with its checkpoints.

## What ships in 2.9

- `GraphEngine` with five node types: action, decision, wait, parallel and loop.
- A node starts only after the admit function allows it. The function defaults to deny and an engine without one runs no node.
- Checkpoints per node with `getCheckpoints` and `restoreCheckpoint`.
- Cycle detection, bounded loops and retry with linear, exponential or Fibonacci backoff.
- A wait node for human approval with a timeout.
- The page draws a run of 15 steps with three checkpoints. This is one example. The engine accepts any valid graph.

## Layout

| Path | Role |
|------|------|
| `lib/graph/engine.ts` | The engine |
| `lib/graph/types.ts` | Node, context and checkpoint types |
| `lib/graph/index.ts` | The public module |
| `tests/engine.test.ts` | vitest suite |
| `AEP-Components/graph-engine-admit-gate/` | Source check: the engine calls no node without the admit function |
| `AEP-Components/decomposition/` | Task tree decomposition with completion checks |
| `AEP-Components/session/` | Session lifecycle and kill switch |
| `AEP-Components/recovery/` | Violation detection and governed retry |

## Interfaces

- `GraphEngine.addNode()`, `validate()`, `detectCycles()` and `execute()`
- `admitGate` on `GraphEngineOptions`, default deny
- `policyEvaluator` with a `branches` map for decision nodes. This evaluator is not Admit.
- `createGraphEngine(options)` as a factory
- Component id `graph-engine` with the manifest `AEP-Base-Node/AEP-Registry/components/graph-engine.json`

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

## Limits

- The engine owns no graph state. The live graph belongs to dynAEP (07).
- Its local step counter is not the kernel check. The AEP Base Node (01) still judges drift, age, sequence and replay.
- It does not replace the Admit Gate (04).

## Run and test

```bash
npx vitest run AEP-Components/graph-engine AEP-Components/decomposition AEP-Components/session AEP-Components/recovery
cargo test -p aep-graph-engine-admit-gate
```

## Related documents

- `AEP-Components/graph-engine/lib/graph/README.md` for the module notes
- `AEP-Components/dynAEP/README.md` for the owner of the live graph
- `AEP-Components/README.md` for the rule on graph state
