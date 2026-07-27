# MCP Security Subprotocol

Validates MCP tool invocations against an allowlist. Detects typosquatting and schema drift.

## Rust crate

- **Crate:** `aep-subprotocol-mcp-security`
- **Type:** `McpSecurityRegistry`

## Checks

- Tool name matches blocked patterns (`eval`, `exec`, `system`, `__proto__`, `child_process`)
- Tool is in the registered allowlist (when non-empty)
- Typosquat detection (Levenshtein distance <= 2 from known tools)
- Input schema: required fields present, no unexpected fields
- Schema hash drift detection per registered tool

## CLI

```bash
aep-subprotocol mcp --tool read_file --input '{"path":"/tmp/example.txt"}'
```

Register tools programmatically via `McpSecurityRegistry::register_tool()` before validation in embedded callers.