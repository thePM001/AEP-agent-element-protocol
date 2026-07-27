# n8n Connector

**Registry id:** `connector-n8n`  
**UCB-only:** all traffic via `/ucb/v1/egress/n8n/**`

## Auth

Set `AEP_N8N_API_KEY` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://your-instance.app.n8n.cloud/api/v1`

Override in CCA plan `connectors.n8n` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
