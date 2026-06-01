# AEP-Graph Orchestration Engine

Stateful persistent cyclic workflow engine built on AEP scene graph + dynAEP vector clocks.

## Features

- Stateful persistent workflows (lattice memory fabric)
- Cyclic execution with loop detection
- Checkpoints at every node
- Human-in-the-loop branch points
- Native retry with exponential backoff
- Conditional branching via GAP policy evaluation

## Architecture

```
AEP Scene Graph (elements, z-bands, topology)
        +
dynAEP Vector Clocks (causal ordering, temporal authority)
        =
AEP-Graph (executable state machines with persistence)
```

## Node Types

- Action nodes: execute agent tools
- Decision nodes: evaluate GAP policies
- Wait nodes: human-in-the-loop gates
- Parallel nodes: concurrent execution with join
- Loop nodes: cyclic execution with iteration bounds

## Persistence

All state persisted to lattice memory fabric.
Recovery from checkpoints after restart.
Vector clocks ensure causal consistency across distributed execution.
