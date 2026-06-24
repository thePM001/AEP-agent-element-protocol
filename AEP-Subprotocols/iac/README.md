# Infrastructure as Code Subprotocol

Validates agent-generated infrastructure resources (Kubernetes, Terraform, etc.) against registered schemas.

## Rust crate

- **Crate:** `aep-subprotocol-iac`
- **Type:** `IacRegistry`

## Reference registry

`reference-registry.json` - Kubernetes `Deployment` example.

## Resource schema

```json
{
  "kind": "Deployment",
  "api_version": "apps/v1",
  "required_fields": ["metadata.name", "spec.replicas", "spec.template"],
  "forbidden_fields": ["spec.hostNetwork"],
  "properties": {
    "spec.replicas": { "type": "integer", "minimum": 1, "maximum": 100 }
  }
}
```

Field paths use dot notation (`metadata.name`).

## CLI

```bash
aep-subprotocol iac \
  --kind Deployment \
  --spec '{"metadata":{"name":"api"},"spec":{"replicas":2,"template":{}}}'
```