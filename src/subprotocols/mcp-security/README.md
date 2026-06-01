# AEP MCP Security Gateway

Detects and blocks MCP tool attacks before they reach the agent.

## Detection Categories

### Tool Typosquatting
Detects MCP tool names that are typo-variants of known tools.
Example: 'filesystem' vs 'filesytem', 'terminal' vs 'termnal'

### Tool Schema Drift
Detects when a tool's input/output schema changes unexpectedly.
Monitors schema hash and alerts on modification.

### Tool Poisoning
Detects malicious patterns in tool output:
- Embedded executables in text output
- Command injection in string parameters
- Data exfiltration patterns (curl/wget in tool output)
- Credential harvesting (regex for API keys, tokens in output)

## Integration

```bash
aep intercept --mcp --policy-dir ./policies
```

This starts an MCP proxy that:
1. Validates all tool names against typosquatting database
2. Checks schema integrity on every tool call
3. Scans tool output for poisoning patterns
4. Blocks malicious tools before they execute
