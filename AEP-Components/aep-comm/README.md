# AEP Communication

AEP-Comm is the agent-to-agent orchestration layer. Agents use it to find each other, send work and hand a task to another agent with retry. TypeScript dynAEP remains a standalone component and this layer does not replace Base Node as the kernel.

- **Component ID:** `aep-comm`
- **Path:** `AEP-Components/aep-comm/`
- **Manifest:** `AEP-Base-Node/registry/components/aep-comm.json`
- **Harness:** `AEP-User-Experience/aep-comm-harness.ts`

## Find other agents

Each agent publishes a card that names what it can do. A registry holds those cards. A distributed hash table (an in-memory lookup that expires stale entries) plus a periodic health exchange keep the set of live peers current.

## Send work

Messages travel as a JSON-LD envelope, meaning a typed JSON document with linked-data fields, through a router that uses the lattice action path. Each agent has a priority inbox. Live sockets use WebSocket. When a socket cannot stay open, a server-sent-events path with a POST fallback carries the same envelope.

## Hand off a task

A task moves through eight states and can push a notification when the state changes. Sensitive steps can wait for a human. Delegation picks another agent by a named capability and retries if that agent fails. Isolated code execution sits behind written policy. The sandbox can run python, javascript, typescript and bash with timeout, output caps, path-escape refusal and optional network isolation.

Tests: `./AEP-Components/conformance/runner/run.sh`
