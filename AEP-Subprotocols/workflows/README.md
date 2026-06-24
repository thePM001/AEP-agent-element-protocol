# Workflows Subprotocol

Hallucination-proof workflow step validation. Stateless: caller passes `current_state`.

## Rust crate

- **Crate:** `aep-subprotocol-workflows`
- **Type:** `WorkflowRegistry`

## Reference registry

`reference-registry.json` - default task workflow (`create_task`, `assign_task`, `complete_task`).

## Schema per step

```json
{
  "action": "create_task",
  "payload_schema": { "type": "object", "required": ["title"], "properties": { "title": { "type": "string" } } },
  "allowed_transitions": ["assign_task", "complete_task"],
  "requires_approval": false
}
```

## CLI

```bash
aep-subprotocol workflows \
  --action assign_task \
  --payload '{"task_id":"T-1","assignee":"agent-1"}' \
  --state create_task
```

## Load custom registry

```rust
let reg = WorkflowRegistry::load_reference("path/to/registry.json")?;
let result = reg.validate_step("my_action", &payload, Some("prev_state"));
```