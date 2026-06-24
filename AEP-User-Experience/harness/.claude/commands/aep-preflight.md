# /aep-preflight

## AEP 2.8 Preflight Check

Before making ANY code changes, complete this preflight:

### Step 0: Base Node and Registry

```bash
node harness/aep-base-node-preflight.mjs
```

Confirm Base Node health is `ok` and docking ports are listening. If using Docker and not yet activated:

```bash
docker compose -f docker-compose.public.yml exec aep aep-setup-agent
```

Read `AEP-Base-Node/registry/catalog.json` when enabling optional protocol or compliance modules.

### Step 1: Load AEP Configuration (UI work)

1. `aep-scene.json` - element hierarchy
2. `aep-registry.yaml` - element definitions
3. `aep-theme.yaml` - visual rules

### Step 2: AgentGateway Policy Check

Verify planned mutations pass AgentGateway policy evaluation.

### Step 3: Declare

State: "AEP 2.8 preflight complete. Base Node ok. {N} elements in scope. AgentGateway passed."