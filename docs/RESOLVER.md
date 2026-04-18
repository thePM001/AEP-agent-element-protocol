# Basic Resolver

## What the Basic Resolver Does

The Basic Resolver routes agent proposals to the correct validator pipeline. Given a proposal (UI element, workflow step, API call, event or IaC resource), the resolver determines:

1. **Which domain** handles this proposal (ui, workflow, api, event, iac).
2. **What constraints** apply from the AEP registry.
3. **Whether Rego policies** permit this route.
4. **What actions** are available from the current state (for workflows).
5. **Whether a memory attractor** matches this proposal (fast-path signal).

The resolver is **read-only and stateless**. It never modifies the scene graph, registry, theme or memory. All state comes from inputs.

## Routing Logic

The resolver maps `proposal_type` to a domain:

| proposal_type | Route | Registry Consulted |
|--------------|-------|-------------------|
| `ui_element` | `ui` | AEP scene + registry (prefix, z-band, constraints) |
| `workflow_step` | `workflow` | WorkflowRegistry (transitions, payload schema) |
| `api_call` | `api` | APIRegistry (endpoints, methods, body schema) |
| `event` | `event` | EventRegistry (topics, producers, correlation IDs) |
| `iac_resource` | `iac` | IaCRegistry (resource kinds, required fields) |

### UI Element Routing

For UI proposals, the resolver:

1. Extracts the prefix from `element_id` (e.g., `CP` from `CP-00003`).
2. Looks up the z-band for that prefix.
3. Checks whether the element exists in the AEP registry.
4. Collects constraints from the registry entry.
5. Returns all of this in the `ResolveResult`.

### Workflow Routing

For workflow proposals, the resolver:

1. Checks whether the action is registered in the `WorkflowRegistry`.
2. Gets available transitions from `current_state`.
3. Returns available actions and any constraint violations.

## Integration with Protocol Registries

The resolver delegates domain-specific validation to the existing AEP protocol registries from `sdk-aep-protocols.py`:

- `WorkflowRegistry` - validates actions and state transitions
- `APIRegistry` - validates HTTP methods, paths, bodies
- `EventRegistry` - validates topics, payloads, producer permissions
- `IaCRegistry` - validates resource kinds and field constraints

If a registry is not provided for a domain, the resolver returns an empty constraint list and notes that the registry is unavailable. This enables incremental adoption.

## Integration with Lattice Memory

When a `MemoryFabric` is provided to the resolver, it queries memory during routing:

1. If the proposal has an `embedding`, call `get_fast_path_hit()`.
2. If similarity exceeds the threshold (default 0.95), set `fast_path = True` and attach the matching `MemoryEntry` as `nearest_attractor`.
3. Downstream systems can use this signal to skip expensive advisory computations.

Memory integration is optional. If no `MemoryFabric` is provided, the resolver works identically minus the attractor lookup.

## API Reference

### ResolveRequest

| Field | Type | Description |
|-------|------|-------------|
| `proposal_type` | `str` | One of: `ui_element`, `workflow_step`, `api_call`, `event`, `iac_resource` |
| `element_id` | `str` or `None` | AEP element ID (for UI proposals) |
| `action` | `str` or `None` | Workflow action name |
| `payload` | `dict` | The proposal data |
| `current_state` | `str` or `None` | Current workflow or system state |
| `agent_id` | `str` or `None` | Which agent is proposing |

### ResolveResult

| Field | Type | Description |
|-------|------|-------------|
| `route` | `str` | One of: `ui`, `workflow`, `api`, `event`, `iac` |
| `constraints` | `list[str]` | Constraints the proposal must satisfy |
| `policy_pass` | `bool` | Whether Rego policies allow this route |
| `policy_errors` | `list[str]` | Rego denial messages if any |
| `available_actions` | `list[str]` | Valid next actions from current state |
| `nearest_attractor` | `MemoryEntry` or `None` | From memory if available |
| `fast_path` | `bool` | True if attractor match found above threshold |

### BasicResolver

| Method | Returns | Description |
|--------|---------|-------------|
| `resolve(request)` | `ResolveResult` | Main routing method |
| `get_available_routes()` | `list[str]` | Domains with loaded registries |
| `get_ui_constraints(element_id)` | `list[str]` | Constraints from registry for a specific element |

## What the Hyper-Resolver Adds

The Basic Resolver ships with AEP v2.0 open source. The proprietary Hyper-Resolver (available under commercial license) adds:

- Multi-agent conflict detection and resolution
- Cross-domain dependency graph analysis
- Probabilistic routing based on historical success rates
- Real-time constraint propagation across the scene graph
- Distributed memory fabric with CRDT-based merging

The Basic Resolver is fully functional for single-agent and small team scenarios. The Hyper-Resolver is designed for production environments with many concurrent agents.

## Example Usage

### Python

```python
from sdk_aep_resolver import BasicResolver, ResolveRequest

# Create resolver with AEP config
resolver = BasicResolver(config=aep_config, memory=fabric)

# Route a UI element proposal
request = ResolveRequest(
    proposal_type="ui_element",
    element_id="CP-00003",
    payload={"z": 20, "parent": "PN-00001", "skin_binding": "button_primary"},
)
result = resolver.resolve(request)
print(f"Route: {result.route}")
print(f"Constraints: {result.constraints}")
print(f"Fast path: {result.fast_path}")

# Route a workflow step
request = ResolveRequest(
    proposal_type="workflow_step",
    action="assign",
    payload={"task_id": "T-001", "assignee": "agent-1"},
    current_state="create_task",
)
result = resolver.resolve(request)
print(f"Available actions: {result.available_actions}")
```

### TypeScript

```typescript
import { BasicResolver } from "./sdk-aep-resolver";

const resolver = new BasicResolver(config, fabric);

const result = resolver.resolve({
  proposalType: "ui_element",
  elementId: "CP-00003",
  payload: { z: 20, parent: "PN-00001" },
});

console.log(`Route: ${result.route}`);
console.log(`Constraints: ${result.constraints}`);
```
