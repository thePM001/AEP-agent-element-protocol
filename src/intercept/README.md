# AEP Intercept Proxy

One-command MCP proxy mode for policy-based tool blocking.

## Usage

```bash
aep intercept --policy-dir ./policies --upstream mcp://localhost:8080
```

## Features

- Policy-based tool blocking at proxy level
- Rate limiting per tool
- Approval gates for high-risk operations
- Audit logging of all proxied requests

## Architecture

```
Agent -> aep intercept -> MCP Server
              |
         Policy Lattice
         (policies/reference/)
```

Every tool call passes through the policy lattice before reaching the MCP server.
