# AEP-Graph Orchestration Engine

This engine runs cyclic workflows on the AEP scene graph, meaning the map of what exists in the product. Before a node runs, execute must pass a gate that defaults to deny so a missing gate never starts the node. A local vector clock, meaning a per-graph step counter, ticks only after that gate allows. That counter is not the kernel check because Base Node still judges clock drift, age, future time, sequence and capsule-hash replay. TypeScript dynAEP remains a standalone component and GraphEngine does not replace Base Node as the kernel.

## Features

- Stateful persistent workflows on the lattice memory fabric
- Cyclic execution with loop detection
- Checkpoints at every node
- Human-in-the-loop branch points
- Native retry with exponential backoff
- Conditional branching via GAP policy evaluation
- admitGate default deny before nodeExecutor

## Architecture

```
AEP Scene Graph (elements, z-bands, topology)
 +
Kernel Admit (drift, age, future, sequence, digest replay)
 =
AEP-Graph (executable state machines with persistence)
```

The GraphEngine local vector clock is metadata after allow. It is not live Admit.

## Node Types

- Action nodes: execute agent tools
- Decision nodes: evaluate GAP policies
- Wait nodes: human-in-the-loop gates
- Parallel nodes: concurrent execution with join
- Loop nodes: cyclic execution with iteration bounds

## Persistence

State is persisted to the lattice memory fabric so a run can resume from checkpoints after restart. The local vector clock ticks only after admitGate allow.
