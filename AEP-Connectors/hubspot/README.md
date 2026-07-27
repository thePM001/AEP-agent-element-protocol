# HubSpot Connector

**Registry id:** `connector-hubspot`  
**UCB-only:** all traffic via `/ucb/v1/egress/hubspot/**`

## Auth

Set `AEP_HUBSPOT_TOKEN` in the environment. UCB injects it as Bearer on egress proxy.

## Default upstream

`https://api.hubapi.com`

Override in CCA plan `connectors.hubspot` or task manifest egress routes.

## MCP / Nango

Optional MCP servers from [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) or self-hosted [Nango](https://github.com/nangohq/nango) may sit upstream - still reached only through UCB egress.
