# AEP Protocol Extensions
# The Agent Anti-Hallucination Protocol Family

AEP is not just a UI framework. It is a universal containment protocol for AI agent hallucinations. Every domain with rigid, predefined schemas can be made hallucination-proof using the same pattern: precompile ground truth into a deterministic registry, validate every agent output against it, reject violations with specific errors, let the agent self-correct.

This folder contains protocol extensions that apply AEP's topological matrix validation to domains beyond the frontend.

## The Pattern

Every extension follows the same architecture:

```
1. REGISTRY:   Define all valid operations, types, fields and constraints
2. VALIDATOR:  Check every agent-proposed action against the registry
3. REJECTION:  Return specific errors so the agent can self-correct
4. EXECUTION:  Apply only validated actions
```

The agent provides the semantic intelligence. The registry provides the physical laws. The validator is the enforcement layer.

## Protocol Extensions

| Extension | File | What It Validates |
|-----------|------|-------------------|
| **UI** | Core AEP + dynAEP | Element IDs, z-bands, parent-child topology, skin bindings, spatial rules |
| **Workflows** | `aep-workflow.py` | Workflow actions, state transitions, payload schemas, approval gates |
| **APIs** | `aep-api.py` | HTTP methods, endpoint paths, request bodies, query params, headers |
| **Events** | `aep-event.py` | Event topics, payload schemas, producer permissions, correlation IDs, size limits |
| **Infrastructure** | `aep-iac.py` | Resource kinds, required fields, forbidden fields, type constraints, value ranges |

## Usage

Every extension exposes the same interface:

```python
# 1. Create a registry
registry = create_task_management_registry()

# 2. Validate agent output
result = registry.validate_step(
    action="approve",
    payload={"task_id": "T-001", "approver": "agent-7"}
)

# 3. Check result
if result["valid"]:
    # Execute the action
    pass
else:
    # Feed errors back to agent for self-correction
    print(result["errors"])
```

## Pre-built Registries

Each extension ships with a ready-to-use registry for common use cases:

| Function | Domain |
|----------|--------|
| `create_task_management_registry()` | Task workflows (create, assign, complete, approve, reject, escalate, archive) |
| `create_task_api_registry()` | REST API for tasks (CRUD with full schema validation) |
| `create_task_event_registry()` | Event-driven task system (created, assigned, completed, approved, notification) |
| `create_k8s_registry()` | Kubernetes resources (Deployment, Service, ConfigMap, Ingress) |

## Extending

To add a new domain:

1. Define your `Schema` model (what fields, types, constraints, transitions)
2. Build a `Registry` class with `register()` and `validate()` methods
3. Ship pre-built registries for common use cases
4. Add it to the demo server as an MCP tool

The agent never touches raw code or unstructured output. It operates exclusively within the validated registry. Hallucination becomes structurally impossible.

## The Thesis

The existence of AEP proves that AI hallucination is not a fundamental limitation. It is an engineering problem. In any domain where ground truth can be precompiled into a deterministic registry, hallucination is eliminable by architecture. The question is not "can we fix hallucination" but "how much of reality can we map into verified registries."

These protocol extensions answer that question domain by domain.
