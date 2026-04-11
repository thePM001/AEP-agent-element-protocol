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
