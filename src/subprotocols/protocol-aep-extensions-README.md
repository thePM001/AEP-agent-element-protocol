# AEP Protocol Extensions
# The AI Agent Anti-Hallucination Subprotocols

AEP is a universal containment protocol for AI agent hallucinations. Every domain with rigid, predefined schemas can be made hallucination-proof using the same pattern: precompile ground truth into a deterministic registry, validate every agent output against it, reject violations with specific errors, let the agent self-correct.
# AEP Protocol Extensions
# The AI Agent Anti-Hallucination Subprotocols

AEP is a universal containment protocol for AI agent hallucinations. Every domain with rigid, predefined schemas can be made hallucination-proof using the same pattern: precompile ground truth into a deterministic registry, validate every agent output against it, reject violations with specific errors, let the agent self-correct.

## Subprotocols

AEP defines four subprotocols beyond the core UI protocol. All four are implemented in a single unified SDK file:

**`sdk/sdk-aep-protocols.py`**

| Subprotocol | Registry Class | What It Validates |
|-------------|----------------|-------------------|
| **UI** | Core AEP + dynAEP (separate files) | Element IDs, z-bands, parent-child topology, skin bindings, spatial rules |
| **Workflows** | `WorkflowRegistry` | Actions, state transitions, payload schemas, approval gates |
| **REST APIs** | `APIRegistry` | HTTP methods, endpoint paths, request bodies, query params, headers |
| **Events / Pub-Sub** | `EventRegistry` | Topics, payload schemas, producer permissions, correlation IDs, size limits |
| **Infrastructure as Code** | `IaCRegistry` | Resource kinds, required fields, forbidden fields, type and value constraints |

There are no separate files per subprotocol. One file, four registries, one import.

## The Pattern

Every subprotocol follows the same architecture:

```
1. REGISTRY:   Define all valid operations, types, fields and constraints
2. VALIDATOR:  Check every agent-proposed action against the registry
3. REJECTION:  Return specific errors so the agent can self-correct
4. EXECUTION:  Apply only validated actions
```

The agent provides the semantic intelligence. The registry provides the physical laws. The validator is the enforcement layer.

## Architecture: Stateless Registries

All registries are **stateless, immutable blueprints**. Execution state (e.g., current workflow step) is passed in by the caller, never stored in the registry. This prevents race conditions when multiple agents share the same registry in multi-agent environments.

## Usage

```python
from sdk_aep_protocols import (
    WorkflowRegistry,
    APIRegistry,
    EventRegistry,
    IaCRegistry,
    create_task_management_registry,
    create_task_api_registry,
    create_task_event_registry,
    create_k8s_registry,
)

# --- Workflows ---
wf = create_task_management_registry()
result = wf.validate_step(
    action="approve",
    payload={"task_id": "T-001"},
    current_state="complete_task",       # caller owns the state
)

# --- REST APIs ---
api = create_task_api_registry()
result = api.validate_call(
    method="POST",
    path="/api/tasks",
    body={"title": "Fix bug"},
    headers={"Content-Type": "application/json"},
)

# --- Events ---
events = create_task_event_registry()
result = events.validate_event(
    event_id="task.created",
    payload={"task_id": "T-001", "title": "Fix bug", "created_by": "agent-1"},
    correlation_id="corr-123",
)

# --- Infrastructure as Code ---
k8s = create_k8s_registry()
result = k8s.validate_resource(
    kind="Deployment",
    spec={
        "metadata": {"name": "web"},
        "spec": {
            "replicas": 3,
            "selector": {"matchLabels": {"app": "web"}},
            "template": {"spec": {"containers": [{"name": "web"}]}},
        },
    },
)
```

Every call returns a `ValidationResult` with `valid`, `errors` and `detail`. If `valid` is `False`, the `errors` list tells the agent exactly what went wrong so it can self-correct.

## Pre-built Registries

| Function | Domain |
|----------|--------|
| `create_task_management_registry()` | Task workflows (create, assign, complete, approve, reject, escalate, archive, notify) |
| `create_task_api_registry()` | REST API for tasks (CRUD with full body/header/query validation) |
| `create_task_event_registry()` | Event-driven task system (created, assigned, completed, approved, notification) |
| `create_k8s_registry()` | Kubernetes resources (Deployment, Service, ConfigMap, Ingress) |

## Extending

To add a new domain:

1. Define your `Schema` model (what fields, types, constraints, transitions)
2. Add a `Registry` class with `register()` and a `validate_*()` method to `sdk-aep-protocols.py`
3. Ship a pre-built `create_*_registry()` function for common use cases
4. Add it to the demo server as an MCP tool

The agent never touches raw code or unstructured output. It operates exclusively within the validated registry. Hallucination becomes structurally impossible.

## The Thesis

The existence of AEP proves that AI hallucination is not a fundamental limitation. It is an engineering problem. In any domain where ground truth can be precompiled into a deterministic registry, hallucination is eliminable by architecture. The question is not "can we fix hallucination" but "how much of reality can we map into verified registries."

These subprotocols answer that question domain by domain.

## Resolver Integration (v2.0)

The Basic Resolver (`sdk/sdk-aep-resolver.py`, `sdk/sdk-aep-resolver.ts`) automatically routes agent proposals to the correct protocol registry. Agents no longer need to manually select which registry to validate against. The resolver handles routing based on proposal type.

| Proposal Type | Routed To | Registry Class |
|---------------|-----------|----------------|
| `ui_element` | UI validator (core AEP) | Core AEP scene + registry |
| `workflow_step` | Workflow validator | `WorkflowRegistry` |
| `api_call` | API validator | `APIRegistry` |
| `event` | Event validator | `EventRegistry` |
| `iac_resource` | IaC validator | `IaCRegistry` |

### Architecture

| Component | Role |
|-----------|------|
| Basic Resolver | Routes proposals to the correct registry |
| WorkflowRegistry | Validates workflow actions and transitions |
| APIRegistry | Validates HTTP methods, paths and bodies |
| EventRegistry | Validates topics, payloads and correlation IDs |
| IaCRegistry | Validates resource kinds, fields and constraints |

### Usage with All Four Protocol Registries

```python
from sdk_aep_resolver import BasicResolver, ResolveRequest
from sdk_aep_protocols import (
    create_task_management_registry,
    create_task_api_registry,
    create_task_event_registry,
    create_k8s_registry,
)

resolver = BasicResolver(
    config=aep_config,
    workflow_registry=create_task_management_registry(),
    api_registry=create_task_api_registry(),
    event_registry=create_task_event_registry(),
    iac_registry=create_k8s_registry(),
)

result = resolver.resolve(ResolveRequest(
    proposal_type="workflow_step",
    action="create_task",
    payload={"title": "Deploy v2"},
))
```

The resolver is stateless and read-only. It never modifies the scene graph, registries or memory. If a `MemoryFabric` is provided, the resolver also queries for fast-path attractor hits to short-circuit validation of near-identical proposals.


## AEP 2.2 Governance Integration

As of AEP 2.2, all subprotocol registries can be used in conjunction with the core governance features:

- **Trust-Gated Operations** -- workflow steps, API calls and IaC mutations can require a minimum trust tier via `min_trust_tier` on capabilities.
- **Ring-Based Access** -- execution rings restrict which subprotocol operations an agent can perform. Ring 3 agents can only query registries. Ring 1+ is required for mutating operations.
- **Covenant Integration** -- behavioural covenants can reference subprotocol actions (e.g., `forbid api:delete;` blocks DELETE API calls regardless of capability configuration).
- **Intent Drift Detection** -- the drift detector monitors subprotocol action patterns alongside core AEP operations, detecting when an agent shifts from workflow steps to API calls unexpectedly.

### Example: Trust-Gated Workflow Step

```yaml
capabilities:
  - tool: "workflow:approve"
    min_trust_tier: "trusted"
  - tool: "workflow:create_task"
    min_trust_tier: "standard"
  - tool: "api:delete"
    min_trust_tier: "privileged"
```

### Example: Covenant with Subprotocol Rules

```
covenant WorkflowSafety {
  permit workflow:create_task;
  permit workflow:assign;
  forbid workflow:approve;
  require trustTier >= "standard";
}
```
