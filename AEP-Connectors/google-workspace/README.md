# Google Workspace Connector

**Registry id:** `connector-google-workspace`  
**UCB-only:** all traffic via `/ucb/v1/egress/google-workspace/**`

## Auth

Set `AEP_GWS_ACCESS_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://www.googleapis.com`

Override in CCA plan `connectors.google-workspace` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
