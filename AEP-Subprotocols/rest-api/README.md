# REST API Subprotocol

Validates agent-proposed HTTP calls against registered endpoint schemas.

## Rust crate

- **Crate:** `aep-subprotocol-rest-api`
- **Type:** `ApiRegistry`

## Reference registry

`reference-registry.json` - example task API (`GET /api/tasks`, `POST /api/tasks`, `GET /api/tasks/{task_id}`).

## Endpoint schema

```json
{
  "method": "POST",
  "path": "/api/tasks",
  "required_headers": ["Authorization", "Content-Type"],
  "request_body": {
    "type": "object",
    "required": ["title"],
    "properties": { "title": { "type": "string" } }
  }
}
```

Path params use `{name}` segments. Matching is regex-based.

## CLI

```bash
aep-subprotocol rest-api \
  --method POST \
  --path /api/tasks \
  --body '{"title":"Fix bug"}'
```