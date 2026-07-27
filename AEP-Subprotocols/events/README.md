# Events Subprotocol

Validates pub/sub event emissions: topic, payload schema, producer permissions, correlation ID, size limits.

## Rust crate

- **Crate:** `aep-subprotocol-events`
- **Type:** `EventRegistry`

## Reference registry

`reference-registry.json` - `task.created` event example.

## Event schema

```json
{
  "topic": "tasks.created",
  "payload_schema": { "type": "object", "required": ["task_id", "title", "created_by"], "properties": { ... } },
  "allowed_producers": ["agent-1", "conductor"],
  "max_payload_bytes": 65536,
  "requires_correlation_id": true
}
```

## CLI

```bash
aep-subprotocol events \
  --event-id task.created \
  --payload '{"task_id":"T-1","title":"x","created_by":"agent-1"}' \
  --producer agent-1 \
  --correlation-id corr-123
```