# Microsoft Azure Connector

**Registry id:** `connector-azure`  
**UCB-only:** all traffic via `/ucb/v1/egress/azure/**`

## Auth

Set `AEP_AZURE_ACCESS_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://management.azure.com`

Override in CCA plan `connectors.azure` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
