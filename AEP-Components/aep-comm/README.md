# AEP Communication

Universal orchestration layer (Google A2A, Anthropic MCP, AutoGen parity targets).

- **Component ID:** `aep-comm`
- **Path:** `AEP-Components/aep-comm/`
- **Manifest:** `AEP-Base-Node/registry/components/aep-comm.json`
- **Harness:** `AEP-User-Experience/aep-comm-harness.ts`

## Layout

```
lib/
  agent-card.ts
  task-lifecycle.ts
  human-in-the-loop.ts
  resource-protocol.ts
  prompt-templates.ts
  code-sandbox.ts
  discovery/     dht, registry, gossip
  messaging/     envelope, inbox, router, transports/
  delegate/      resolver.ts
```

Tests: `./AEP-Components/conformance/runner/run.sh`
